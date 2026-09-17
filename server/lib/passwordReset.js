// Shared token-issuing logic behind both "forgot password" (server/routes/auth.js) and the
// "set up your new account" invite sent when an admin creates a user (server/routes/users.js) -
// both just need a single-use, expiring link into the same /reset-password page, so one function
// generates the token/row and sends the appropriately-worded email for either case.
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { dbRun } = require('../db');
const { sendEmail } = require('./email');

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour - an active "I forgot my password" request
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - a new account isn't urgent the same way

async function issuePasswordLink({ user, req, mode }) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const ttlMs = mode === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  await dbRun(
    'INSERT INTO password_reset_tokens (token_id, user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), user.user_id, tokenHash, expiresAt, req?.ip || null]
  );

  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:4000').replace(/\/$/, '');
  const resetUrl = `${base}/reset-password?token=${rawToken}`;

  const subject = mode === 'invite'
    ? 'Set up your Safety Training Matrix account'
    : 'Reset your Safety Training Matrix password';
  const html = mode === 'invite'
    ? `
      <p>An account has been created for you on the Safety Training Matrix, username <strong>${user.username}</strong>.</p>
      <p><a href="${resetUrl}">Click here to set your password</a> and finish setting up your account. This link expires in 7 days.</p>
      <p>If you weren't expecting this, you can ignore this email.</p>
    `
    : `
      <p>Someone requested a password reset for the account <strong>${user.username}</strong>.</p>
      <p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email - your password won't change.</p>
    `;

  await sendEmail({ to: user.email, subject, html });
}

module.exports = { issuePasswordLink };
