require('dotenv').config({ quiet: true });
require('express-async-errors');

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

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

  const { attachUser, requireAuth } = require('./middleware/auth');

  const app = express();
  // Render sits in front of this app behind a proxy that terminates TLS - trust it so
  // req.secure and the client's real protocol are reported correctly (needed for secure cookies).
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(attachUser);

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

  // Training Sign-In (merged in 2026-08-19): admin/staff session management requires the same
  // login as everything else above. /api/public is the trainee-facing side and is deliberately
  // NOT behind requireAuth - a trainee scanning a QR code never has a login.
  app.use('/api/training-sessions', requireAuth, require('./routes/trainingSessions'));
  app.use('/api/public', require('./routes/publicSessions'));

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
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
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
