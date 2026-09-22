const { dbGet } = require('../db');
const { verifyToken, signToken } = require('../lib/auth');
const { getOrCreateSessionSecret } = require('../lib/settings');

const COOKIE_NAME = 'tm_session';
const SESSION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days - the hard cap on a session's total age

// Auto-logout after inactivity (Keeley's request, 2026-09-22) - separate from the 7-day cap
// above, which just bounds how old a still-active session can get. Enforced server-side by
// carrying `lastActivity` inside the signed token itself (see routes/auth.js's
// issueSessionCookie and the refresh below) rather than in a database, so it works without any
// schema change and can't be bypassed by editing anything client-side - the signature covers it.
const IDLE_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  });
  return out;
}

// Reads the session cookie if present and attaches req.user when it's valid. Never blocks
// the request itself - routes that require login use requireAuth below to enforce that.
async function attachUser(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    const secret = await getOrCreateSessionSecret();
    const payload = verifyToken(token, secret);
    if (payload && payload.sub) {
      // Idle timeout (see IDLE_TIMEOUT_MS above) - a token that's otherwise still validly signed
      // and within its 7-day cap is nonetheless treated as logged-out once it's gone quiet too
      // long. `lastActivity` is missing on a token issued before this feature shipped; treat
      // those as already-idle rather than trusting them indefinitely, so nobody's existing
      // session silently skips the new check.
      const idleSince = Date.now() - (payload.lastActivity || 0);
      if (idleSince > IDLE_TIMEOUT_MS) {
        res.clearCookie(COOKIE_NAME);
      } else {
        const user = await dbGet('SELECT user_id, username, role, full_name FROM app_users WHERE user_id = ?', [payload.sub]);
        if (user) {
          req.user = user;
          // Slide the idle window forward on every authenticated request, without extending the
          // token's own absolute expiry (`payload.exp`, the original 7-day cap from login) - so
          // an actively-used session stays logged in indefinitely up to that cap, but a merely
          // still-valid, unused one still times out at IDLE_TIMEOUT_MS.
          const remainingMs = payload.exp - Date.now();
          if (remainingMs > 0) {
            const refreshed = signToken(
              { sub: payload.sub, username: payload.username, lastActivity: Date.now() },
              secret,
              remainingMs
            );
            const cookieOptions = {
              httpOnly: true,
              sameSite: 'lax',
              secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
            };
            // Only a "remember me" login gets a persistent cookie in the first place (see
            // issueSessionCookie) - refreshing must preserve that, or every session would quietly
            // become a browser-session-only cookie the moment it's used once.
            if (payload.rememberMe) cookieOptions.maxAge = remainingMs;
            res.cookie(COOKIE_NAME, refreshed, cookieOptions);
          }
        }
      }
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  next();
}

// Three roles: "user" (view only), "admin" (full access), "super_admin" (full access, plus
// account/security administration - who can grant super_admin, and the login audit log).
// super_admin is a strict superset of admin: isAdminRole() is what regular admin-gated routes
// should check, so a super_admin never loses ordinary admin capability.
function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

// Admin/User roles: a plain "user" can view everything but can't add/edit/delete anything.
// Apply this to individual mutating routes (POST/PUT/DELETE), not whole routers, so GET
// routes on the same router stay open to read-only users.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'This action requires an admin account.' });
  next();
}

// Super Admin only: account/security administration - granting super_admin itself, and the
// login audit log (server/routes/audit.js). A regular admin never sees or reaches these.
function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'This action requires a Super Admin account.' });
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin, requireSuperAdmin, isAdminRole, COOKIE_NAME, SESSION_MS };
