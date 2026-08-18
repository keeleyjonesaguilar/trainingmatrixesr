const db = require('../db');
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
function attachUser(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    const secret = getOrCreateSessionSecret();
    const payload = verifyToken(token, secret);
    if (payload && payload.sub) {
      const user = db.prepare('SELECT user_id, username FROM app_users WHERE user_id = ?').get(payload.sub);
      if (user) req.user = user;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  next();
}

module.exports = { attachUser, requireAuth, COOKIE_NAME, SESSION_MS };
