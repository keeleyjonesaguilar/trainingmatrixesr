const { dbGet, dbRun } = require('../db');
const crypto = require('crypto');

async function getSetting(key) {
  const row = await dbGet('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await dbRun(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

// The secret that signs session cookies. Generated once and stored on the persistent disk
// (same DB as everything else), so sessions survive restarts/redeploys instead of forcing
// everyone to log in again every time the server restarts.
async function getOrCreateSessionSecret() {
  let secret = await getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await setSetting('session_secret', secret);
  }
  return secret;
}

module.exports = { getSetting, setSetting, getOrCreateSessionSecret };
