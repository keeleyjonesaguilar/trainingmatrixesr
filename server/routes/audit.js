// Super Admin login audit view (Keeley's request, 2026-09-09 - security hardening pass). Reads
// the login_attempts table server/lib/loginSecurity.js has been writing to since that same
// pass; nothing here writes anything. Mounted with requireSuperAdmin in server/index.js, so a
// regular admin account never sees this - only whoever holds the super_admin role.
const express = require('express');
const router = express.Router();
const { dbAll, dbGet } = require('../db');
const { MAX_FAILED_ATTEMPTS, LOCKOUT_WINDOW_MS } = require('../lib/loginSecurity');

router.get('/login-attempts', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const clauses = [];
  const params = [];

  if (req.query.username) {
    clauses.push('username_attempted = ?');
    params.push(String(req.query.username).trim().toLowerCase());
  }
  if (req.query.outcome === 'success') clauses.push('success = 1');
  else if (req.query.outcome === 'failed') clauses.push('success = 0 AND blocked = 0');
  else if (req.query.outcome === 'blocked') clauses.push('blocked = 1');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const attempts = await dbAll(
    `SELECT * FROM login_attempts ${where} ORDER BY attempted_at DESC LIMIT ?`,
    [...params, limit]
  );

  // Usernames currently inside an active lockout window - same threshold/window
  // loginSecurity.checkLockout() itself uses, so this always matches what the login route
  // would actually enforce right now, not an approximation of it.
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
  const lockedRows = await dbAll(
    `SELECT username_attempted FROM login_attempts
     WHERE success = 0 AND attempted_at >= ?
     GROUP BY username_attempted
     HAVING COUNT(*) >= ?`,
    [windowStart, MAX_FAILED_ATTEMPTS]
  );

  const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const summary = await dbGet(
    `SELECT
       COUNT(*) FILTER (WHERE success = 1) AS success_24h,
       COUNT(*) FILTER (WHERE success = 0) AS failed_24h,
       COUNT(DISTINCT ip_address) AS distinct_ips_24h
     FROM login_attempts WHERE attempted_at >= ?`,
    [dayStart]
  );

  res.json({
    attempts,
    currently_locked: lockedRows.map((r) => r.username_attempted),
    summary,
  });
});

module.exports = router;
