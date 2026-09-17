const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { hashPassword } = require('../lib/auth');
const { requireAdmin, isAdminRole } = require('../middleware/auth');
const { logAdminAction } = require('../lib/adminAudit');
const { issuePasswordLink } = require('../lib/passwordReset');

const VALID_ROLES = ['user', 'admin', 'super_admin'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A brand-new invited account has no real username yet (the person picks their own when they
// claim the invite link) - this placeholder just satisfies app_users.username's NOT NULL UNIQUE
// constraint until then. Never shown to the invitee or usable to log in (password_hash is an
// unguessable random value until claimed too).
function makePendingUsername() {
  return `pending-${crypto.randomBytes(8).toString('hex')}`;
}
function isPendingUsername(username) {
  return /^pending-[0-9a-f]{16}$/.test(username || '');
}

// Mounted with requireAuth in server/index.js - every route below already requires a
// logged-in session. Managing accounts/roles is admin-only; viewing the list is fine for
// anyone logged in (so a read-only user can at least see who has access).

router.get('/', async (req, res) => {
  const users = await dbAll('SELECT user_id, username, email, role, created_at, mfa_enabled FROM app_users ORDER BY created_at ASC', []);
  res.json(users.map((u) => ({ ...u, pending: isPendingUsername(u.username) })));
});

router.post('/', requireAdmin, async (req, res) => {
  const { role = 'user', email } = req.body || {};
  const cleanEmail = (email || '').trim();
  if (!cleanEmail) return res.status(400).json({ error: 'Email is required.' });
  if (!EMAIL_PATTERN.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'user', 'admin', or 'super_admin'." });
  // Granting super_admin is itself a super_admin-only action - a regular admin can create other
  // admins, but can never create (or promote anyone to) a Super Admin account.
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin account.' });
  }

  const existingEmail = await dbGet('SELECT 1 FROM app_users WHERE email = ?', [cleanEmail]);
  if (existingEmail) return res.status(409).json({ error: 'That email address is already in use by another account.' });

  const user = {
    user_id: uuidv4(),
    // Both replaced the moment the invite link is claimed (server/routes/auth.js POST
    // /reset-password with an 'invite'-purpose token) - nobody ever sees or types either value
    // before then. This just satisfies username/password_hash's NOT NULL constraints at insert time.
    username: makePendingUsername(),
    email: cleanEmail,
    password_hash: hashPassword(crypto.randomBytes(32).toString('hex')),
    role,
    created_at: new Date().toISOString(),
  };
  await dbRun('INSERT INTO app_users (user_id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [user.user_id, user.username, user.email, user.password_hash, user.role, user.created_at]);

  await logAdminAction({
    actor: req.user, action: 'user_created', targetUserId: user.user_id, targetUsername: user.email,
    details: `role=${user.role}, pending invite claim`, req,
  });

  let inviteSent = true;
  let inviteError = null;
  try {
    await issuePasswordLink({ user, req, mode: 'invite' });
  } catch (err) {
    // The account itself is created either way - surfaced here (unlike forgot-password) since
    // there's no anti-enumeration reason to hide it from the admin who just created this account.
    console.error(`Invite email failed for "${user.username}":`, err.message);
    inviteSent = false;
    inviteError = err.message;
  }

  res.status(201).json({
    user_id: user.user_id, username: user.username, email: user.email, role: user.role, created_at: user.created_at,
    inviteSent, inviteError,
  });
});

// Re-sends the "set your password" invite link - for when the first one was lost, expired (7
// days), or never arrived because email wasn't configured yet at creation time.
router.post('/:userId/resend-invite', requireAdmin, async (req, res) => {
  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.email) return res.status(400).json({ error: 'This account has no email on file yet - add one first.' });
  if (!isPendingUsername(user.username)) {
    return res.status(400).json({ error: 'This account has already been claimed - use "Reset Password" instead.' });
  }
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: "Only a Super Admin can resend a Super Admin account's invite." });
  }

  try {
    await issuePasswordLink({ user, req, mode: 'invite' });
  } catch (err) {
    return res.status(502).json({ error: `Could not send the invite email: ${err.message}` });
  }

  await logAdminAction({
    actor: req.user, action: 'invite_resent', targetUserId: user.user_id, targetUsername: user.username, req,
  });
  res.json({ ok: true });
});

// Lets an admin put an email on file for someone else's account (e.g. onboarding a user who
// hasn't set their own yet) - "forgot password" only works for an account that has one.
router.put('/:userId/email', requireAdmin, async (req, res) => {
  const { email } = req.body || {};
  const cleanEmail = (email || '').trim();
  if (!cleanEmail || !EMAIL_PATTERN.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: "Only a Super Admin can change a Super Admin account's email." });
  }

  const existingEmail = await dbGet('SELECT 1 FROM app_users WHERE email = ? AND user_id != ?', [cleanEmail, user.user_id]);
  if (existingEmail) return res.status(409).json({ error: 'That email address is already in use by another account.' });

  await dbRun('UPDATE app_users SET email = ? WHERE user_id = ?', [cleanEmail, user.user_id]);
  await logAdminAction({
    actor: req.user, action: 'email_changed_by_admin', targetUserId: user.user_id, targetUsername: user.username,
    details: `new email=${cleanEmail}`, req,
  });
  res.json({ ok: true, email: cleanEmail });
});

router.put('/:userId/password', requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  // Resetting a Super Admin's password is itself an account-takeover path for that role, so
  // it's gated the same as actually granting/revoking Super Admin.
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: "Only a Super Admin can reset a Super Admin account's password." });
  }

  await dbRun('UPDATE app_users SET password_hash = ? WHERE user_id = ?', [hashPassword(password), user.user_id]);
  await logAdminAction({
    actor: req.user, action: 'password_reset_by_admin', targetUserId: user.user_id, targetUsername: user.username, req,
  });
  res.json({ ok: true });
});

// Change a user's role. Blocked if it would leave zero accounts able to manage users (admin or
// super_admin), or zero Super Admins once at least one exists - otherwise a mistake here could
// lock everyone out of ever managing users/roles (or Security/audit access) again.
router.put('/:userId/role', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'user', 'admin', or 'super_admin'." });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Granting OR revoking super_admin is itself a super_admin-only action.
  if ((role === 'super_admin' || user.role === 'super_admin') && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can grant or remove the Super Admin role.' });
  }

  if (isAdminRole(user.role) && !isAdminRole(role)) {
    const adminCount = (await dbGet("SELECT COUNT(*) AS n FROM app_users WHERE role IN ('admin', 'super_admin')", [])).n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot remove the last remaining admin account.' });
  }
  if (user.role === 'super_admin' && role !== 'super_admin') {
    const superAdminCount = (await dbGet("SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'", [])).n;
    if (superAdminCount <= 1) return res.status(400).json({ error: 'Cannot remove the last remaining Super Admin account.' });
  }

  await dbRun('UPDATE app_users SET role = ? WHERE user_id = ?', [role, user.user_id]);
  await logAdminAction({
    actor: req.user, action: 'role_changed', targetUserId: user.user_id, targetUsername: user.username,
    details: `${user.role} -> ${role}`, req,
  });
  res.json({ ok: true });
});

router.delete('/:userId', requireAdmin, async (req, res) => {
  const count = (await dbGet('SELECT COUNT(*) AS n FROM app_users', [])).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining login account.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can delete a Super Admin account.' });
  }
  if (isAdminRole(user.role)) {
    const adminCount = (await dbGet("SELECT COUNT(*) AS n FROM app_users WHERE role IN ('admin', 'super_admin')", [])).n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining admin account.' });
  }
  if (user.role === 'super_admin') {
    const superAdminCount = (await dbGet("SELECT COUNT(*) AS n FROM app_users WHERE role = 'super_admin'", [])).n;
    if (superAdminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining Super Admin account.' });
  }

  await dbRun('DELETE FROM app_users WHERE user_id = ?', [req.params.userId]);
  // target_user_id has no foreign key on it (unlike actor_user_id), so recording the now-deleted
  // id here is safe and still useful for cross-referencing against other tables/logs later.
  await logAdminAction({
    actor: req.user, action: 'user_deleted', targetUserId: user.user_id, targetUsername: user.username,
    details: `role=${user.role}`, req,
  });
  res.json({ ok: true });
});

// Recovery path for a lost/reset authenticator app: without this, a user who loses their device
// AND their backup codes could never pass login again (self-service disable in server/routes/
// auth.js requires already being logged in, which requires the code they no longer have). Gated
// like password reset - a Super Admin's own MFA can only be turned off by another Super Admin.
router.delete('/:userId/mfa', requireAdmin, async (req, res) => {
  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: "Only a Super Admin can disable a Super Admin account's MFA." });
  }
  await dbRun('UPDATE app_users SET mfa_secret = NULL, mfa_enabled = false, mfa_backup_codes = ? WHERE user_id = ?', [[], user.user_id]);
  await logAdminAction({
    actor: req.user, action: 'mfa_disabled_by_admin', targetUserId: user.user_id, targetUsername: user.username, req,
  });
  res.json({ ok: true });
});

module.exports = router;
