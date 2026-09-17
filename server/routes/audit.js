// Super Admin login audit view (Keeley's request, 2026-09-09 - security hardening pass). Reads
// the login_attempts table server/lib/loginSecurity.js has been writing to since that same
// pass; nothing here writes anything. Mounted with requireSuperAdmin in server/index.js, so a
// regular admin account never sees this - only whoever holds the super_admin role.
const express = require('express');
const router = express.Router();
const { dbAll, dbGet } = require('../db');
const { MAX_FAILED_ATTEMPTS, LOCKOUT_WINDOW_MS } = require('../lib/loginSecurity');

// Shared page size for every paginated table on the Security page (Keeley's request, 2026-09-17:
// the page had grown into one long continuously-scrolling list) - Prev/Next over a fixed window
// instead of an ever-growing LIMIT, plus a total count so the UI knows when it's on the last page.
const PAGE_SIZE = 25;

function pageParams(req) {
  const limit = Math.min(Number(req.query.limit) || PAGE_SIZE, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}

router.get('/login-attempts', async (req, res) => {
  const { limit, offset } = pageParams(req);
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
    `SELECT * FROM login_attempts ${where} ORDER BY attempted_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const { n: total } = await dbGet(`SELECT COUNT(*) AS n FROM login_attempts ${where}`, params);

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
    total,
    currently_locked: lockedRows.map((r) => r.username_attempted),
    summary,
  });
});

// Privileged-action audit trail (server/lib/adminAudit.js writes these) - account creation/
// deletion, role changes, password resets, MFA on/off, email changes. This is the record of
// what happened to account access itself, as distinct from login-attempts above (which only
// covers logging in).
router.get('/account-changes', async (req, res) => {
  const { limit, offset } = pageParams(req);
  const clauses = [];
  const params = [];

  if (req.query.username) {
    const needle = String(req.query.username).trim();
    clauses.push('(actor_username = ? OR target_username = ?)');
    params.push(needle, needle);
  }
  if (req.query.action) {
    clauses.push('action = ?');
    params.push(String(req.query.action));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const changes = await dbAll(
    `SELECT * FROM admin_actions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const { n: total } = await dbGet(`SELECT COUNT(*) AS n FROM admin_actions ${where}`, params);

  res.json({ changes, total });
});

// General activity log (Keeley's request, 2026-09-17: "employee 1 created a training session,
// downloaded QR code, copied link, downloaded certificates, exported roster" - not an account-
// security event, just routine usage) - server/lib/activityLog.js writes these from wherever a
// meaningful create/edit/delete/download happens across the app. Deliberately separate from
// admin_actions above: that table is schema-locked to app_users targets (role changes, password
// resets); this one describes arbitrary entities (sessions, clients, employees, certificates...)
// via a generic entity_type/entity_id pair instead.
router.get('/activity-log', async (req, res) => {
  const { limit, offset } = pageParams(req);
  const clauses = [];
  const params = [];

  if (req.query.username) {
    clauses.push('actor_username = ?');
    params.push(String(req.query.username).trim());
  }
  if (req.query.action) {
    clauses.push('action = ?');
    params.push(String(req.query.action));
  }
  if (req.query.entity_type) {
    clauses.push('entity_type = ?');
    params.push(String(req.query.entity_type));
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const activity = await dbAll(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const { n: total } = await dbGet(`SELECT COUNT(*) AS n FROM activity_log ${where}`, params);

  res.json({ activity, total });
});

// Snapshot of who currently holds privileged access and how well-protected those accounts are -
// the single most actionable thing a security review of this app would want to see at a glance:
// exactly which admin/super_admin accounts do NOT have MFA turned on.
router.get('/access-roster', async (req, res) => {
  const users = await dbAll(
    `SELECT username, role, email, mfa_enabled, created_at FROM app_users
     WHERE role IN ('admin', 'super_admin') ORDER BY role DESC, username ASC`,
    []
  );
  const totals = await dbGet('SELECT COUNT(*) AS n FROM app_users', []);

  res.json({
    total_accounts: totals.n,
    privileged_accounts: users,
    privileged_without_mfa: users.filter((u) => !u.mfa_enabled).map((u) => u.username),
    privileged_without_email: users.filter((u) => !u.email).map((u) => u.username),
  });
});

module.exports = router;
