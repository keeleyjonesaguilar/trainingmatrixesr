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

const BRAND_GREEN = '#026754';

// Shared branded shell for every email this app sends (Keeley's request, 2026-09-17: "make that
// email look nicer") - inline styles throughout, since email clients strip <style> blocks and
// external stylesheets unpredictably. No hosted logo image (the client's build output uses
// content-hashed filenames, not a stable URL to link to) - the brand green bar + name reads
// clearly on its own without depending on an image loading.
function emailShell({ heading, bodyHtml, ctaUrl, ctaLabel, footnote }) {
  return `
    <div style="background:#f6f7f9;padding:32px 16px;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#1a1d21;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e5e9;">
        <div style="background:${BRAND_GREEN};padding:20px 28px;">
          <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.2px;">Safety Training Matrix</span>
        </div>
        <div style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:19px;color:#1a1d21;">${heading}</h1>
          <div style="font-size:14px;line-height:1.6;color:#333333;">${bodyHtml}</div>
          ${ctaUrl ? `
            <div style="margin:26px 0 10px;">
              <a href="${ctaUrl}" style="display:inline-block;background:${BRAND_GREEN};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">${ctaLabel}</a>
            </div>
            <p style="font-size:12px;color:#8a8f98;word-break:break-all;">Or paste this link into your browser: ${ctaUrl}</p>
          ` : ''}
        </div>
        ${footnote ? `<div style="padding:16px 28px;border-top:1px solid #e2e5e9;font-size:12px;color:#8a8f98;">${footnote}</div>` : ''}
      </div>
    </div>
  `;
}

async function issuePasswordLink({ user, req, mode }) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const ttlMs = mode === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  await dbRun(
    'INSERT INTO password_reset_tokens (token_id, user_id, token_hash, expires_at, requested_ip, purpose) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), user.user_id, tokenHash, expiresAt, req?.ip || null, mode === 'invite' ? 'invite' : 'reset']
  );

  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:4000').replace(/\/$/, '');
  const resetUrl = `${base}/reset-password?token=${rawToken}`;
  const greetingName = user.full_name ? user.full_name.split(' ')[0] : null;

  let subject;
  let html;
  if (mode === 'invite') {
    subject = 'Set up your Safety Training Matrix account';
    html = emailShell({
      heading: greetingName ? `Welcome, ${greetingName}` : 'Welcome',
      bodyHtml: `
        <p style="margin:0 0 14px;">An account has been created for you on the Safety Training Matrix.</p>
        ${user.full_name ? `
          <p style="margin:0 0 14px;padding:12px 14px;background:#f6f7f9;border-radius:8px;">
            This invite is for <strong>${user.full_name}</strong> at <strong>${user.email}</strong>.
            If that's not you, you can safely ignore this email.
          </p>
        ` : ''}
        <p style="margin:0;">Click below to choose your own username and password and finish setting up your account.</p>
      `,
      ctaUrl: resetUrl,
      ctaLabel: 'Set Up My Account',
      footnote: "This link expires in 7 days. If you weren't expecting this invite, no action is needed.",
    });
  } else {
    subject = 'Reset your Safety Training Matrix password';
    html = emailShell({
      heading: 'Reset your password',
      bodyHtml: `<p style="margin:0;">Someone requested a password reset for the account <strong>${user.username}</strong>${user.full_name ? ` (${user.full_name})` : ''}.</p>`,
      ctaUrl: resetUrl,
      ctaLabel: 'Choose a New Password',
      footnote: "This link expires in 1 hour. If you didn't request this, you can safely ignore this email - your password won't change.",
    });
  }

  await sendEmail({ to: user.email, subject, html });
}

module.exports = { issuePasswordLink };
