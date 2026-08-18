const db = require('../db');
const crypto = require('crypto');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// The secret that signs session cookies. Generated once and stored on the persistent disk
// (same DB as everything else), so sessions survive restarts/redeploys instead of forcing
// everyone to log in again every time the server restarts.
function getOrCreateSessionSecret() {
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

module.exports = { getSetting, setSetting, getOrCreateSessionSecret };
