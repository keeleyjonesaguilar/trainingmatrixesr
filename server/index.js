const path = require('path');
const fs = require('fs');
// Explicit path (not dotenv's cwd-relative default) so this still finds .env when launched from
// a different working directory (e.g. the Claude Code preview tool, which doesn't run npm/node
// from this project's root the way a manual `node server/index.js` does).
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const db = require('./db');

async function start() {
  // Ensure DB + migrations run before anything else touches the database.
  await db.ready;

  // Auto-seed the Master Training Catalog on first boot (no-op if already populated), so a
  // fresh cloud deploy works without needing shell/CLI access to run a seed command manually.
  await require('./seed/seed').seedIfEmpty();

  // Auto-seed exactly one login account on first boot (from APP_USERNAME/APP_PASSWORD if set),
  // so there's always at least one way in. Additional accounts are managed from the in-app
  // Manage Users screen from then on.
  await require('./seed/seedAdmin').seedAdminIfEmpty();

  // One-time data fixes (each runs exactly once, guarded by an app_settings flag - see
  // server/lib/oneTimeFixes.js for what they do and why).
  await require('./lib/oneTimeFixes').runOneTimeFixes();

  // Fills first_name/last_name for any employee still missing them (every row, the first time
  // after migration 061; afterwards only rows an older deploy created) - see server/lib/names.js.
  const namesFilled = await require('./lib/names').backfillEmployeeNameParts();
  if (namesFilled) console.log(`Filled first/last name for ${namesFilled} employee(s).`);

  // Daily automated database backup (Keeley's request, 2026-09-09) - runs inside this process so
  // it's always-on regardless of any local PC's power state. See server/lib/backupScheduler.js.
  require('./lib/backupScheduler').start();

  // Prunes the Security page's logs once they age past their retention window (Keeley's
  // request, 2026-09-17) - see server/lib/logRetentionScheduler.js for the specific windows.
  require('./lib/logRetentionScheduler').start();

  const { attachUser, requireAuth, requireSuperAdmin } = require('./middleware/auth');

  const app = express();
  // Render sits in front of this app behind a proxy that terminates TLS - trust it so
  // req.secure, req.ip, and the client's real protocol are reported correctly (needed for
  // secure cookies and for login_attempts.ip_address to record the real client, not Render's).
  app.set('trust proxy', 1);

  // Security headers (Keeley's request, 2026-09-09 - hardening pass ahead of a penetration
  // test). CSP is explicit rather than helmet's default: the app renders every style as an
  // inline `style={{...}}` attribute (style-src needs 'unsafe-inline' or the whole UI breaks),
  // signatures captured during Training Sign-In are rendered as data: image URIs, and QR codes
  // load from this app's own /api routes - nothing else needs to be allowed.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    })
  );

  // This app is always served same-origin (client/dist and the API are one process) - there's
  // no legitimate browser use case for a cross-origin request, so CORS is scoped to the app's
  // own public URL instead of the previous unrestricted default (which reflected any origin).
  // Requests with no Origin header (server-to-server, curl, same-origin fetches) are unaffected.
  //
  // Both the bare and "www." form of PUBLIC_APP_URL are allowed (whichever one isn't set as the
  // canonical URL still needs to work if DNS/the domain registrar ever sends a visitor there
  // before any www<->bare redirect happens) - a browser still attaches an Origin header on a
  // same-site request in some cases, and this middleware would otherwise reject it outright.
  // RENDER_EXTERNAL_URL is auto-populated by Render on every web service with the exact URL
  // it's actually being served from - unlike PUBLIC_APP_URL (a manually-set env var elsewhere
  // in this file, used for QR codes), it can't drift out of sync with reality. Included here as
  // a guaranteed-correct fallback so a missing/mistyped PUBLIC_APP_URL can never lock out the
  // app's own real origin (confirmed live, 2026-09-17: PUBLIC_APP_URL alone was rejecting the
  // production site's own requests, breaking every POST - login, saves, uploads - in real
  // browsers, since a browser attaches an Origin header those requests that curl/server-to-
  // server calls don't, so this had gone unnoticed in every terminal-based check).
  const allowedOrigins = [
    process.env.PUBLIC_APP_URL,
    process.env.RENDER_EXTERNAL_URL,
    'http://localhost:4000',
    'http://localhost:5173',
  ].filter(Boolean);
  for (const origin of [...allowedOrigins]) {
    try {
      const url = new URL(origin);
      const altHost = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
      allowedOrigins.push(`${url.protocol}//${altHost}${url.port ? `:${url.port}` : ''}`);
    } catch {
      /* not a full URL (shouldn't happen for these three) - skip */
    }
  }
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

  // Gzip every response the browser can accept compressed (Keeley's request, 2026-09-23) - the
  // matrix payload alone is ~14.5 MB of JSON, which compresses to a small fraction of that.
  app.use(compression());

  app.use(express.json({ limit: '5mb' }));
  app.use(attachUser);

  // Coarse, IP-based defense against a scripted brute-force run across many usernames from one
  // source, on top of the per-username lockout inside the login route itself (see
  // server/lib/loginSecurity.js). Generous enough not to lock out a shared office connection
  // during normal (if fumbling) use.
  const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts from this network. Please try again later.' },
  });
  app.use('/api/auth/login', loginRateLimiter);

  // Separate, tighter limit on forgot-password - this one sends an email (a real cost, and a
  // spam vector) rather than just checking a database row.
  const forgotPasswordRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset requests from this network. Please try again later.' },
  });
  app.use('/api/auth/forgot-password', forgotPasswordRateLimiter);

  // Login/logout/session-check are public; everything else below requires a session.
  app.use('/api/auth', require('./routes/auth'));
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/users', requireAuth, require('./routes/users'));
  app.use('/api/clients', requireAuth, require('./routes/clients'));
  app.use('/api/master-trainings', requireAuth, require('./routes/masterTrainings'));
  app.use('/api/employees', requireAuth, require('./routes/employees'));
  app.use('/api/trainers', requireAuth, require('./routes/trainers'));
  app.use('/api/training-requirements', requireAuth, require('./routes/trainingRequirements'));
  app.use('/api/training-records', requireAuth, require('./routes/trainingRecords'));
  app.use('/api/matrix', requireAuth, require('./routes/matrix'));
  app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
  app.use('/api/import', requireAuth, require('./routes/import'));
  app.use('/api/reports', requireAuth, require('./routes/reports'));
  app.use('/api/feedback-settings', requireAuth, require('./routes/feedbackSettings'));
  app.use('/api/trainer-close-pin-settings', requireAuth, require('./routes/trainerClosePinSettings'));
  app.use('/api/audit', requireAuth, requireSuperAdmin, require('./routes/audit'));
  app.use('/api/notifications', requireAuth, require('./routes/notifications'));

  // Training Sign-In (merged in 2026-08-19): admin/staff session management requires the same
  // login as everything else above. /api/public is the trainee-facing side and is deliberately
  // NOT behind requireAuth - a trainee scanning a QR code never has a login.
  app.use('/api/training-sessions', requireAuth, require('./routes/trainingSessions'));
  app.use('/api/public', require('./routes/publicSessions'));
  // Trainer's post-close edit link - public (trainers have no login) but PIN-gated, so it gets
  // its own limit against someone guessing PINs from a leaked link.
  const sessionEditRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts from this network. Please try again later.' },
  });
  app.use('/api/session-edit', sessionEditRateLimiter, require('./routes/sessionEdit'));

  // Serve the built React frontend in production (client/dist), so the whole app is one process.
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Centralized error handler so a thrown error returns JSON instead of crashing the process.
  // express-async-errors (required above) forwards a rejected promise from any async route
  // handler/middleware here automatically, the same as a synchronously thrown error.
  //
  // Every route that wants to surface a specific message to the client already does so itself
  // (res.status(4xx).json({error: ...})) before returning - those never reach this handler.
  // What lands here is genuinely unexpected (a DB failure, a programming bug), so the response
  // is deliberately generic - the real error (which can include raw Postgres error text, file
  // paths, etc.) is only ever logged server-side, never handed to whoever triggered it.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Training Matrix server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
