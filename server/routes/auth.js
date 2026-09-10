const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { dbGet, dbRun } = require('../db');
const { verifyPassword, hashPassword, signToken, verifyToken } = require('../lib/auth');
const { generateSecret, verifyTotp, otpauthUri, generateBackupCode } = require('../lib/totp');
const { getOrCreateSessionSecret } = require('../lib/settings');
const { COOKIE_NAME, SESSION_MS, requireAuth } = require('../middleware/auth');
const { checkLockout, recordAttempt } = require('../lib/loginSecurity');

// How long a user has to enter their MFA code after a correct password, and to finish scanning
// a QR code during setup, before that in-flight token expires and they have to start over.
const MFA_LOGIN_TTL_MS = 5 * 60 * 1000;
const MFA_SETUP_TTL_MS = 10 * 60 * 1000;

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
  res.json({ ok: true });
});

module.exports = router;
