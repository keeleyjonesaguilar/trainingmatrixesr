const { dbGet } = require('../db');
const { verifyToken } = require('../lib/auth');
const { getOrCreateSessionSecret } = require('../lib/settings');

const COOKIE_NAME = 'tm_session';
const SESSION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

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
      const user = await dbGet('SELECT user_id, username, role, full_name FROM app_users WHERE user_id = ?', [payload.sub]);
      if (user) req.user = user;
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
