const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { dbGet, dbRun } = require('../db');
const { verifyPassword, hashPassword, signToken, verifyToken } = require('../lib/auth');
const { generateSecret, verifyTotp, otpauthUri, generateBackupCode } = require('../lib/totp');
const { getOrCreateSessionSecret } = require('../lib/settings');
const { COOKIE_NAME, SESSION_MS, requireAuth } = require('../middleware/auth');
const { checkLockout, recordAttempt } = require('../lib/loginSecurity');
const { sendEmail } = require('../lib/email');
const { logAdminAction } = require('../lib/adminAudit');

// How long a user has to enter their MFA code after a correct password, and to finish scanning
// a QR code during setup, before that in-flight token expires and they have to start over.
const MFA_LOGIN_TTL_MS = 5 * 60 * 1000;
const MFA_SETUP_TTL_MS = 10 * 60 * 1000;

// How long a password reset link stays valid after being requested.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

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
    res.json({ ok: true, username: user.username, role: user.role });
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
  res.json({ username: req.user.username, role: req.user.role });
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

  // A random 256-bit token is itself the whole secret (unlike a password, nothing about it is
  // guessable or reused), so it's hashed with a fast, unsalted SHA-256 rather than the slow,
  // salted scrypt used for passwords - that also lets the lookup below match by hash directly
  // instead of having to scan and compare every outstanding token.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();

  await dbRun(
    'INSERT INTO password_reset_tokens (token_id, user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), user.user_id, tokenHash, expiresAt, req.ip]
  );

  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:4000').replace(/\/$/, '');
  const resetUrl = `${base}/reset-password?token=${rawToken}`;
  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your Safety Training Matrix password',
      html: `
        <p>Someone requested a password reset for the account <strong>${user.username}</strong>.</p>
        <p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email - your password won't change.</p>
      `,
    });
  } catch (err) {
    // Logged, not surfaced - the response is deliberately identical either way (see above).
    console.error(`Password reset email failed for "${user.username}":`, err.message);
  }

  res.json(GENERIC_FORGOT_PASSWORD_RESPONSE);
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Missing reset token or new password.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = await dbGet(
    'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()',
    [tokenHash]
  );
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [row.user_id]);
  await dbRun('UPDATE app_users SET password_hash = ? WHERE user_id = ?', [hashPassword(newPassword), row.user_id]);
  await dbRun('UPDATE password_reset_tokens SET used_at = now() WHERE token_id = ?', [row.token_id]);
  // No req.user here (this happens before any login) - the account itself is both actor and
  // target, which is exactly the useful signal: a password changed itself via an emailed link,
  // from this IP, at this time.
  await logAdminAction({
    actor: user, action: 'password_reset_via_email_link', targetUserId: user.user_id, targetUsername: user.username, req,
  });
  res.json({ ok: true });
});

module.exports = router;
