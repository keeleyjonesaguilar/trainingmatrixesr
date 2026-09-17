const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const { dbGet, dbRun } = require('../db');
const { verifyPassword, hashPassword, signToken, verifyToken } = require('../lib/auth');
const { generateSecret, verifyTotp, otpauthUri, generateBackupCode } = require('../lib/totp');
const { getOrCreateSessionSecret } = require('../lib/settings');
const { COOKIE_NAME, SESSION_MS, requireAuth } = require('../middleware/auth');
const { checkLockout, recordAttempt } = require('../lib/loginSecurity');
const { issuePasswordLink } = require('../lib/passwordReset');
const { logAdminAction } = require('../lib/adminAudit');

// How long a user has to enter their MFA code after a correct password, and to finish scanning
// a QR code during setup, before that in-flight token expires and they have to start over.
const MFA_LOGIN_TTL_MS = 5 * 60 * 1000;
const MFA_SETUP_TTL_MS = 10 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// rememberMe controls only the cookie's persistence, not the session's actual validity window -
// the signed token itself is always good for SESSION_MS either way, so a "remembered" browser
// session never unexpectedly logs out early. Omitting `maxAge` makes it a browser session cookie
// (cleared when the browser fully closes); defaults to true so existing behavior (always
// persistent) doesn't change for anyone who doesn't interact with the new checkbox.
function issueSessionCookie(req, res, user, rememberMe = true) {
  return getOrCreateSessionSecret().then((secret) => {
    const token = signToken({ sub: user.user_id, username: user.username }, secret, SESSION_MS);
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    };
    if (rememberMe) cookieOptions.maxAge = SESSION_MS;
    res.cookie(COOKIE_NAME, token, cookieOptions);
    res.json({ ok: true, username: user.username, role: user.role, full_name: user.full_name });
  });
}

router.post('/login', async (req, res) => {
  const { username, password, rememberMe = true } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  // Per-username lockout (not per-IP - a shared office network should never lock everyone out
  // together). The blocked attempt itself is still logged, so a lockout shows up in the audit
  // trail the same as any other attempt.
  if (await checkLockout(username)) {
    await recordAttempt({ username, req, success: false, blocked: true });
    return res.status(429).json({ error: `Too many failed login attempts. Please wait 15 minutes and try again.` });
  }

  const user = await dbGet('SELECT * FROM app_users WHERE username = ?', [username]);
  const valid = Boolean(user && verifyPassword(password, user.password_hash));
  await recordAttempt({ username, req, success: valid });
  if (!valid) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  // Password alone isn't enough for an account with MFA turned on - hand back a short-lived
  // token identifying who passed the password check, and require /mfa/verify-login before a
  // real session cookie is issued. Accounts without MFA enabled are unaffected (existing flow).
  if (user.mfa_enabled) {
    const secret = await getOrCreateSessionSecret();
    // rememberMe travels inside this signed token (rather than being re-collected on the MFA
    // screen) so the eventual session cookie still respects the choice made on the password step.
    const mfaToken = signToken({ sub: user.user_id, username: user.username, stage: 'mfa', rememberMe: Boolean(rememberMe) }, secret, MFA_LOGIN_TTL_MS);
    return res.json({ mfaRequired: true, mfaToken });
  }

  await issueSessionCookie(req, res, user, rememberMe);
});

// Second step of login for accounts with MFA enabled. Not behind requireAuth (there's no real
// session yet) - protected instead by the signed, short-lived mfaToken from /login plus the same
// per-username lockout used for password attempts, so this can't be brute-forced either.
router.post('/mfa/verify-login', async (req, res) => {
  const { mfaToken, code } = req.body || {};
  if (!mfaToken || !code) return res.status(400).json({ error: 'Your 6-digit code is required.' });

  const secret = await getOrCreateSessionSecret();
  const payload = verifyToken(mfaToken, secret);
  if (!payload || payload.stage !== 'mfa' || !payload.sub) {
    return res.status(401).json({ error: 'Your login session expired. Please sign in again.' });
  }

  const username = payload.username;
  if (await checkLockout(username)) {
    await recordAttempt({ username, req, success: false, blocked: true });
    return res.status(429).json({ error: 'Too many failed attempts. Please wait 15 minutes and try again.' });
  }

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [payload.sub]);
  if (!user || !user.mfa_enabled) {
    return res.status(401).json({ error: 'MFA is not active for this account. Please sign in again.' });
  }

  let ok = verifyTotp(user.mfa_secret, String(code).trim());
  let usedBackupCode = null;
  if (!ok) {
    // Fall back to a one-time recovery code (for a lost/reset authenticator app).
    usedBackupCode = (user.mfa_backup_codes || []).find((hash) => verifyPassword(String(code).trim(), hash));
    if (usedBackupCode) ok = true;
  }

  await recordAttempt({ username, req, success: ok });
  if (!ok) return res.status(401).json({ error: 'Incorrect code.' });

  if (usedBackupCode) {
    const remaining = user.mfa_backup_codes.filter((hash) => hash !== usedBackupCode);
    await dbRun('UPDATE app_users SET mfa_backup_codes = ? WHERE user_id = ?', [remaining, user.user_id]);
  }

  await issueSessionCookie(req, res, user, payload.rememberMe);
});

router.post('/logout', async (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ username: req.user.username, role: req.user.role, full_name: req.user.full_name });
});

// --- Self-service MFA enrollment (any logged-in user, for their own account only) ---

router.get('/mfa/status', requireAuth, async (req, res) => {
  const user = await dbGet('SELECT mfa_enabled FROM app_users WHERE user_id = ?', [req.user.user_id]);
  res.json({ mfaEnabled: Boolean(user && user.mfa_enabled) });
});

// Generates a new candidate secret and returns it as a QR code (+ manual-entry text), but does
// NOT save anything yet - /mfa/enable below has to prove the user actually scanned it correctly
// first. The secret travels to the client embedded in a signed, 10-minute setupToken rather than
// being written to the database here, so an abandoned setup never leaves a half-configured secret
// behind.
router.post('/mfa/setup', requireAuth, async (req, res) => {
  const secret = generateSecret();
  const signingKey = await getOrCreateSessionSecret();
  const setupToken = signToken({ sub: req.user.user_id, secret }, signingKey, MFA_SETUP_TTL_MS);
  const uri = otpauthUri({ secret, username: req.user.username });
  const qrDataUrl = await QRCode.toDataURL(uri);
  res.json({ setupToken, secret, qrDataUrl });
});

router.post('/mfa/enable', requireAuth, async (req, res) => {
  const { setupToken, code } = req.body || {};
  if (!setupToken || !code) return res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app.' });

  const signingKey = await getOrCreateSessionSecret();
  const payload = verifyToken(setupToken, signingKey);
  if (!payload || payload.sub !== req.user.user_id || !payload.secret) {
    return res.status(400).json({ error: 'Setup session expired. Please restart MFA setup.' });
  }
  if (!verifyTotp(payload.secret, String(code).trim())) {
    return res.status(400).json({ error: 'Incorrect code. Check your authenticator app and try again.' });
  }

  const backupCodes = Array.from({ length: 10 }, () => generateBackupCode());
  const hashedCodes = backupCodes.map((c) => hashPassword(c));
  await dbRun('UPDATE app_users SET mfa_secret = ?, mfa_enabled = true, mfa_backup_codes = ? WHERE user_id = ?', [
    payload.secret,
    hashedCodes,
    req.user.user_id,
  ]);
  await logAdminAction({ actor: req.user, action: 'mfa_enabled', targetUserId: req.user.user_id, targetUsername: req.user.username, req });
  // Shown to the user exactly once - only the hashes are kept from here on.
  res.json({ ok: true, backupCodes });
});

router.post('/mfa/disable', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.user.user_id]);
  if (!password || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  await dbRun('UPDATE app_users SET mfa_secret = NULL, mfa_enabled = false, mfa_backup_codes = ? WHERE user_id = ?', [[], req.user.user_id]);
  await logAdminAction({ actor: req.user, action: 'mfa_disabled', targetUserId: req.user.user_id, targetUsername: req.user.username, req });
  res.json({ ok: true });
});

// --- Self-service email (needed on file before "forgot password" can work for an account) ---

router.get('/email', requireAuth, async (req, res) => {
  const user = await dbGet('SELECT email FROM app_users WHERE user_id = ?', [req.user.user_id]);
  res.json({ email: (user && user.email) || '' });
});

router.put('/email', requireAuth, async (req, res) => {
  const { email } = req.body || {};
  const clean = (email || '').trim();
  if (!clean || !EMAIL_PATTERN.test(clean)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const existing = await dbGet('SELECT 1 FROM app_users WHERE email = ? AND user_id != ?', [clean, req.user.user_id]);
  if (existing) return res.status(409).json({ error: 'That email address is already in use by another account.' });

  await dbRun('UPDATE app_users SET email = ? WHERE user_id = ?', [clean, req.user.user_id]);
  await logAdminAction({
    actor: req.user, action: 'email_changed', targetUserId: req.user.user_id, targetUsername: req.user.username,
    details: `new email=${clean}`, req,
  });
  res.json({ ok: true, email: clean });
});

// --- Forgot / reset password ---

// Always responds with the same generic message regardless of whether the username exists or
// has an email on file, so this can't be used to enumerate valid accounts.
const GENERIC_FORGOT_PASSWORD_RESPONSE = {
  ok: true,
  message: 'If that username exists and has an email address on file, a password reset link has been sent to it.',
};

router.post('/forgot-password', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username is required.' });

  const user = await dbGet('SELECT * FROM app_users WHERE username = ?', [username]);
  if (!user || !user.email) {
    return res.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
  }

  try {
    await issuePasswordLink({ user, req, mode: 'reset' });
  } catch (err) {
    // Logged, not surfaced - the response is deliberately identical either way (see above).
    console.error(`Password reset email failed for "${user.username}":`, err.message);
  }

  res.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
});

// Looks up a token without consuming it, so the claim page knows whether to also ask for a
// username (an 'invite' token - a brand-new account with no real username yet) or just a new
// password (a plain 'reset' token) before the person fills anything in.
router.get('/reset-password/check', async (req, res) => {
  const token = req.query?.token;
  if (!token) return res.json({ valid: false });

  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const row = await dbGet(
    'SELECT purpose FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()',
    [tokenHash]
  );
  if (!row) return res.json({ valid: false });
  res.json({ valid: true, purpose: row.purpose });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword, username } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Missing reset token or new password.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await dbGet(
    'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()',
    [tokenHash]
  );
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [row.user_id]);

  // An 'invite' token's account was created with a placeholder username nobody was ever told -
  // this is the one point where the person claiming it picks their real one. A plain 'reset'
  // token never touches the username, only the password.
  let finalUsername = user.username;
  if (row.purpose === 'invite') {
    const cleanUsername = (username || '').trim();
    if (!cleanUsername) return res.status(400).json({ error: 'Choose a username.' });
    const existingUsername = await dbGet('SELECT 1 FROM app_users WHERE username = ? AND user_id != ?', [cleanUsername, user.user_id]);
    if (existingUsername) return res.status(409).json({ error: 'That username is already in use.' });
    finalUsername = cleanUsername;
  }

  await dbRun('UPDATE app_users SET password_hash = ?, username = ? WHERE user_id = ?', [hashPassword(newPassword), finalUsername, row.user_id]);
  await dbRun('UPDATE password_reset_tokens SET used_at = now() WHERE token_id = ?', [row.token_id]);
  // No req.user here (this happens before any login) - the account itself is both actor and
  // target, which is exactly the useful signal: a password changed itself via an emailed link,
  // from this IP, at this time.
  await logAdminAction({
    actor: { ...user, username: finalUsername },
    action: row.purpose === 'invite' ? 'account_claimed_via_invite' : 'password_reset_via_email_link',
    targetUserId: user.user_id, targetUsername: finalUsername, req,
  });
  res.json({ ok: true, username: finalUsername });
});

module.exports = router;
