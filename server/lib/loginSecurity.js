// Login attempt logging + account lockout (Keeley's request, 2026-09-09 - security hardening
// pass ahead of a third-party penetration test). Every attempt is recorded regardless of
// outcome, both to drive the lockout below and as the data source for a future Super Admin
// audit view. Lockout is per-username (not per-IP) so a shared office IP never locks everyone
// out together; express-rate-limit on the route itself (see server/index.js) is the separate,
// coarser IP-based defense against a distributed brute-force script.
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

// req.ip reflects the real client address because server/index.js sets `trust proxy` - Render
// terminates TLS in front of this app and forwards the original address via X-Forwarded-For.
function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

async function checkLockout(username) {
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
  const { n } = await dbGet(
    `SELECT COUNT(*) AS n FROM login_attempts
     WHERE username_attempted = ? AND success = 0 AND attempted_at >= ?`,
    [String(username || '').trim().toLowerCase(), windowStart]
  );
  return Number(n) >= MAX_FAILED_ATTEMPTS;
}

async function recordAttempt({ username, req, success, blocked = false }) {
  await dbRun(
    `INSERT INTO login_attempts (attempt_id, username_attempted, ip_address, user_agent, success, blocked, attempted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      String(username || '').trim().toLowerCase(),
      getClientIp(req),
      (req.headers['user-agent'] || '').slice(0, 255) || null,
      success ? 1 : 0,
      blocked ? 1 : 0,
      new Date().toISOString(),
    ]
  );
}

module.exports = { checkLockout, recordAttempt, getClientIp, MAX_FAILED_ATTEMPTS, LOCKOUT_WINDOW_MS };
