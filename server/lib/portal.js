// Employee/trainer portal (Keeley's request, 2026-09-30) - /portal, separate from the office
// login. Only invited profiles (employees.portal_invited_at) can sign in: they enter the email on
// their profile, get a 6-digit code by email, and are signed in with a cookie backed by
// portal_sessions (migration 072). Everything here is scoped to the profiles that share the
// signed-in email - a person can have more than one (e.g. employee at two clients).
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { getOrCreateSessionSecret } = require('./settings');
const { sendEmail } = require('./email');
const { displayFirstLast } = require('./names');
const { easternToday } = require('./dates');
const { latestTrainings } = require('./employeeRecordCard');
const { INTERNAL_CLIENT_ID } = require('./repo');
const { TAUGHT_SESSIONS_SQL, trainerRatingSummary } = require('./sessionFeedback');

const COOKIE_NAME = 'tm_portal';
const SESSION_DAYS = 14;
const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GREEN = '#026754';
const GOLD = '#c49b0d';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return EMAIL_PATTERN.test(e) ? e : null;
}

function utcText(msFromNow = 0) {
  return new Date(Date.now() + msFromNow).toISOString().replace('T', ' ').slice(0, 19);
}

async function hashValue(value) {
  const secret = await getOrCreateSessionSecret();
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f5f7f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #d9e0dd;">
      <tr><td style="padding:18px 24px;border-bottom:4px solid ${GOLD};">
        <img src="${publicBaseUrl()}/email-logo.png" alt="Evolution Safety Resources" width="150" style="display:block;width:150px;height:auto;border:0;">
      </td></tr>
      <tr><td style="background:${GREEN};padding:16px 24px;${FONT}font-size:18px;font-weight:700;color:#ffffff;">${esc(title)}</td></tr>
      <tr><td style="padding:22px 24px;${FONT}font-size:15px;line-height:1.55;color:#2d3330;">${bodyHtml}</td></tr>
      <tr><td style="padding:0 24px 20px;${FONT}font-size:12px;color:#5f6b67;">
        <div style="border-top:1px solid #d9e0dd;padding-top:12px;"><strong style="color:${GREEN};">Evolution Safety Resources</strong> · ESR Training Portal<br>This mailbox isn't monitored.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function codeBlock(code) {
  return `<div style="${FONT}font-size:30px;font-weight:700;letter-spacing:.3em;color:${GREEN};background:#eaf2ef;padding:14px 18px;text-align:center;margin:14px 0;">${esc(code)}</div>`;
}

// Invited profiles for an email - the only ones that may sign in with it.
async function invitedProfiles(email) {
  const e = normalizeEmail(email);
  if (!e) return [];
  return dbAll('SELECT * FROM employees WHERE LOWER(email) = ? AND portal_invited_at IS NOT NULL ORDER BY employee_type DESC, full_name', [e]);
}

// ---- Sign-in ----
async function requestLoginCode(email) {
  const e = normalizeEmail(email);
  if (!e) return;
  const profiles = await invitedProfiles(e);
  if (!profiles.length) return; // same response either way - never reveals who is invited
  const recent = await dbGet(
    'SELECT COUNT(*) AS n FROM portal_login_codes WHERE email = ? AND created_at > ?',
    [e, utcText(-60 * 60 * 1000)]
  );
  if (Number(recent.n) >= MAX_CODES_PER_HOUR) return;
  const code = newCode();
  await dbRun('UPDATE portal_login_codes SET used_at = now_utc_text() WHERE email = ? AND used_at IS NULL', [e]);
  await dbRun(
    'INSERT INTO portal_login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)',
    [uuidv4(), e, await hashValue(`${e}:${code}`), utcText(CODE_MINUTES * 60 * 1000)]
  );
  const first = profiles[0].first_name || displayFirstLast(profiles[0]).split(' ')[0];
  await sendEmail({
    to: e,
    subject: `Your ESR Training Portal sign-in code: ${code}`,
    html: emailShell('Your sign-in code', `<p style="margin:0 0 6px;">Hi ${esc(first)},</p>
      <p style="margin:0;">Enter this code on the ESR Training Portal to sign in. It works for ${CODE_MINUTES} minutes.</p>${codeBlock(code)}
      <p style="margin:0;font-size:13px;color:#5f6b67;">Didn't try to sign in? You can ignore this email.</p>`),
  });
}

// Returns a new session token (for the cookie), or null for a wrong/expired code.
async function verifyLoginCode(email, code) {
  const e = normalizeEmail(email);
  const c = String(code || '').replace(/\D/g, '');
  if (!e || c.length !== 6) return null;
  const row = await dbGet(
    'SELECT * FROM portal_login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [e, utcText()]
  );
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) return null;
  if (row.code_hash !== await hashValue(`${e}:${c}`)) {
    await dbRun('UPDATE portal_login_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return null;
  }
  if (!(await invitedProfiles(e)).length) return null;
  await dbRun('UPDATE portal_login_codes SET used_at = now_utc_text() WHERE id = ?', [row.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  await dbRun(
    'INSERT INTO portal_sessions (token_hash, email, expires_at, last_seen_at) VALUES (?, ?, ?, now_utc_text())',
    [await hashValue(`session:${token}`), e, utcText(SESSION_DAYS * 24 * 60 * 60 * 1000)]
  );
  await dbRun('UPDATE employees SET portal_last_login_at = now_utc_text() WHERE LOWER(email) = ? AND portal_invited_at IS NOT NULL', [e]);
  return token;
}

async function sessionFromToken(token) {
  if (!token) return null;
  const hash = await hashValue(`session:${token}`);
  const session = await dbGet('SELECT * FROM portal_sessions WHERE token_hash = ? AND expires_at > ?', [hash, utcText()]);
  if (!session) return null;
  const profiles = await invitedProfiles(session.email);
  if (!profiles.length) return null; // invite revoked
  return { ...session, hash, profiles };
}

async function endSession(token) {
  if (token) await dbRun('DELETE FROM portal_sessions WHERE token_hash = ?', [await hashValue(`session:${token}`)]);
}

// ---- Invites (office side) ----
async function sendInvite(employee) {
  const e = normalizeEmail(employee.email);
  if (!e) throw new Error('Add an email address to this profile before inviting them.');
  await dbRun('UPDATE employees SET portal_invited_at = now_utc_text() WHERE employee_id = ?', [employee.employee_id]);
  const first = employee.first_name || displayFirstLast(employee).split(' ')[0];
  await sendEmail({
    to: e,
    subject: "You're invited to the ESR Training Portal",
    html: emailShell("You're invited", `<p style="margin:0 0 10px;">Hi ${esc(first)},</p>
      <p style="margin:0 0 10px;">Evolution Safety Resources has set you up on the ESR Training Portal, where you can see your trainings and certificates and keep your contact details up to date.</p>
      <p style="margin:0 0 16px;">Sign in with this email address (<strong>${esc(e)}</strong>) - we'll email you a one-time code each time, no password needed.</p>
      <a href="${publicBaseUrl()}/portal" style="display:inline-block;background:${GREEN};color:#ffffff;${FONT}font-size:14px;font-weight:700;text-decoration:none;padding:11px 20px;">Open the Portal</a>`),
  });
}

async function revokeInvite(employee) {
  await dbRun('UPDATE employees SET portal_invited_at = NULL WHERE employee_id = ?', [employee.employee_id]);
  const e = normalizeEmail(employee.email);
  if (e && !(await invitedProfiles(e)).length) await dbRun('DELETE FROM portal_sessions WHERE email = ?', [e]);
}

// ---- Email change (confirmed with a code sent to the new address) ----
async function requestEmailChange(session, newEmail) {
  const n = normalizeEmail(newEmail);
  if (!n) throw new Error('Enter a valid email address.');
  if (n === session.email) throw new Error("That's already your email address.");
  const code = newCode();
  await dbRun('UPDATE portal_email_changes SET used_at = now_utc_text() WHERE old_email = ? AND used_at IS NULL', [session.email]);
  await dbRun(
    'INSERT INTO portal_email_changes (id, old_email, new_email, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), session.email, n, await hashValue(`${n}:${code}`), utcText(CODE_MINUTES * 60 * 1000)]
  );
  await sendEmail({
    to: n,
    subject: `Confirm your new email for the ESR Training Portal: ${code}`,
    html: emailShell('Confirm your new email', `<p style="margin:0;">Enter this code on the ESR Training Portal to switch your email to <strong>${esc(n)}</strong>. It works for ${CODE_MINUTES} minutes.</p>${codeBlock(code)}`),
  });
}

async function confirmEmailChange(session, code) {
  const c = String(code || '').replace(/\D/g, '');
  const row = await dbGet(
    'SELECT * FROM portal_email_changes WHERE old_email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [session.email, utcText()]
  );
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) return null;
  if (row.code_hash !== await hashValue(`${row.new_email}:${c}`)) {
    await dbRun('UPDATE portal_email_changes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return null;
  }
  await dbRun('UPDATE portal_email_changes SET used_at = now_utc_text() WHERE id = ?', [row.id]);
  const ids = session.profiles.map((p) => p.employee_id);
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await dbRun('UPDATE employees SET email = ? WHERE employee_id = ?', [row.new_email, id]);
  }
  await dbRun('UPDATE portal_sessions SET email = ? WHERE email = ?', [row.new_email, session.email]);
  return row.new_email;
}

// ---- What the portal shows ----
// Lead, day trainer or co-trainer (lib/sessionFeedback.js).
const TAUGHT_SQL = TAUGHT_SESSIONS_SQL;

async function trainerView(employeeId) {
  const sessions = await dbAll(
    `SELECT ts.session_id, ts.training_type_label, ts.session_date, ts.status, ts.location, ts.total_days, ts.day_dates, c.client_name,
            (SELECT COUNT(*) FROM session_attendees a WHERE a.session_id = ts.session_id) AS attendee_count
     FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id
     WHERE ts.session_id IN (${TAUGHT_SQL})
     ORDER BY ts.session_date DESC`,
    [employeeId]
  );
  const today = easternToday();
  const shape = (s) => ({
    session_id: s.session_id, training: s.training_type_label, client: s.client_name, date: s.session_date,
    day_dates: s.day_dates ? JSON.parse(s.day_dates) : null, total_days: s.total_days, location: s.location,
    attendees: Number(s.attendee_count), status: s.status,
  });
  const upcoming = sessions.filter((s) => s.status === 'open' && (JSON.parse(s.day_dates || 'null')?.slice(-1)[0] || s.session_date) >= today)
    .map(shape).sort((a, b) => a.date.localeCompare(b.date));
  const taught = sessions.filter((s) => s.status === 'closed').map(shape);
  // Only ratings meant for this trainer (per-trainer feedback, 2026-10-01).
  const summary = await trainerRatingSummary(employeeId);
  const n = summary.response_count;
  return {
    upcoming,
    taught,
    ratings: {
      responses: n,
      trainer_avg: n ? Number(summary.avg_trainer_rating.toFixed(2)) : null,
      effectiveness_avg: summary.avg_effectiveness_rating !== null ? Number(summary.avg_effectiveness_rating.toFixed(2)) : null,
    },
  };
}

async function portalData(session) {
  const profiles = [];
  for (const e of session.profiles) {
    // eslint-disable-next-line no-await-in-loop
    const client = await dbGet('SELECT client_name, is_internal FROM clients WHERE client_id = ?', [e.client_id]);
    const isTrainer = e.employee_type === 'trainer' || Boolean(e.is_trainer);
    // eslint-disable-next-line no-await-in-loop
    const documents = await dbAll(
      `SELECT d.document_id, d.label, d.filename, d.uploaded_at, mt.training_name FROM employee_documents d
       LEFT JOIN master_trainings mt ON mt.training_id = d.training_id WHERE d.employee_id = ? ORDER BY d.uploaded_at DESC`,
      [e.employee_id]
    );
    profiles.push({
      employee_id: e.employee_id,
      name: displayFirstLast(e),
      first_name: e.first_name || displayFirstLast(e).split(' ')[0],
      company: e.client_id === INTERNAL_CLIENT_ID || client?.is_internal ? 'Evolution Safety Resources' : client?.client_name,
      job_title: e.job_title || null,
      phone: e.employee_number || '',
      email: e.email || '',
      is_trainer: isTrainer,
      // eslint-disable-next-line no-await-in-loop
      trainings: await latestTrainings(e),
      documents,
      // eslint-disable-next-line no-await-in-loop
      trainer: isTrainer ? await trainerView(e.employee_id) : null,
    });
  }
  return { email: session.email, profiles };
}

module.exports = {
  COOKIE_NAME, SESSION_DAYS, normalizeEmail,
  requestLoginCode, verifyLoginCode, sessionFromToken, endSession,
  sendInvite, revokeInvite, requestEmailChange, confirmEmailChange, portalData,
};
