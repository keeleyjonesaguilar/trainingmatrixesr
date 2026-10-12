// The class summary email to the trainer(s) (Keeley's request, 2026-10-12): when a training session
// is created, every trainer on it (lead, each day's trainer on a multi-day course, co-trainers) is
// emailed the class details and every link they need - the sign-in page (QR attached), the
// feedback form (QR attached), the WeTransfer files, and the Training Portal's live roster.
// Trainers added on a later edit get it then; the session page can re-send it to everyone after a
// change. Toolbox talks don't get one. Trainers with no email on file are flagged on the bell.
const { dbGet, dbAll } = require('../db');
const { sendEmail } = require('./email');
const { notifyAllUsers } = require('./notifications');
const { qrPngBuffer, publicSignInUrl, feedbackQrPngBuffer, publicFeedbackUrl } = require('./qr');
const { sessionTrainers, getSessionDays } = require('./sessionDays');
const { trainingParts, isMultiTrainingDay } = require('./sessionParts');
const { stripTrainingIdPrefix, buildQrFilename } = require('./certificateFilename');

const GREEN = '#026754';
const GOLD = '#c49b0d';
const MUTED = '#62676f';
const BORDER = '#e2e5e9';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const LANGUAGES = { english: 'English', spanish: 'Spanish', both: 'English and Spanish' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

function longDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function sessionDatesText(session) {
  const dates = parseJson(session.day_dates);
  if (dates && dates.length > 1) return `${longDate(dates[0])} – ${longDate(dates[dates.length - 1])} (${dates.length} days)`;
  return longDate(session.session_date);
}

function link(url) {
  return `<a href="${esc(url)}" style="color:${GREEN};word-break:break-all;">${esc(url)}</a>`;
}

function note(text) {
  return `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${text}</div>`;
}

function rowsTable(rows) {
  return rows.filter(Boolean).map(([k, v]) => `
              <tr>
                <td style="${FONT}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;padding:6px 12px 6px 0;width:130px;vertical-align:top;">${esc(k)}</td>
                <td style="${FONT}font-size:14px;color:#1a1d21;padding:6px 0;">${v}</td>
              </tr>`).join('');
}

function panel(heading, rows) {
  return `<tr><td style="padding:10px 26px 4px;">
        <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${GREEN};margin-bottom:6px;">${esc(heading)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-left:4px solid ${GREEN};border-radius:8px;">
          <tr><td style="padding:10px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsTable(rows)}</table></td></tr>
        </table>
      </td></tr>`;
}

function emailShell({ kicker, title, intro, panels, button }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${BORDER};overflow:hidden;">
      <tr><td style="padding:20px 26px;border-bottom:4px solid ${GOLD};">
        <img src="${publicBaseUrl()}/email-logo.png" alt="Evolution Safety Resources" width="160" style="display:block;width:160px;height:auto;border:0;">
      </td></tr>
      <tr><td style="background:${GREEN};padding:20px 26px;">
        <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">${esc(kicker)}</div>
        <div style="${FONT}font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">${esc(title)}</div>
      </td></tr>
      <tr><td style="padding:22px 26px 6px;${FONT}font-size:15px;line-height:1.55;color:#1a1d21;">${intro}</td></tr>
      ${button ? `<tr><td style="padding:8px 26px 6px;"><a href="${esc(button.url)}" style="display:inline-block;background:${GREEN};color:#ffffff;${FONT}font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">${esc(button.label)}</a></td></tr>` : ''}
      ${panels.join('')}
      <tr><td style="padding:16px 26px 22px;${FONT}font-size:12px;color:${MUTED};">
        <div style="border-top:1px solid ${BORDER};padding-top:12px;">Questions about this class? Contact the ESR office.<br><strong style="color:${GREEN};">Evolution Safety Resources</strong> · Sent automatically by the ESR Safety Training Matrix. This mailbox isn't monitored.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

// Every trainer on the session with the email on their profile (the lead falls back to the email
// they last closed out with). `missing` = trainers with no email anywhere.
async function trainerRecipients(session, onlyEmployeeIds = null) {
  const out = new Map();
  const missing = [];
  for (const t of await sessionTrainers(session)) {
    if (onlyEmployeeIds && !onlyEmployeeIds.includes(t.employee_id)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const profile = t.employee_id ? await dbGet('SELECT email, portal_invited_at FROM employees WHERE employee_id = ?', [t.employee_id]) : null;
    const isLead = t.employee_id ? t.employee_id === session.trainer_employee_id : t.name === session.trainer_name;
    const email = String(profile?.email || (isLead ? session.trainer_email : '') || '').trim().toLowerCase();
    if (!email) missing.push(t.name);
    else if (!out.has(email)) out.set(email, { email, name: t.name, portal: Boolean(profile?.portal_invited_at) });
  }
  return { recipients: [...out.values()], missing };
}

async function summaryDetails(sessionId) {
  const session = await dbGet(
    'SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?',
    [sessionId]
  );
  if (!session) return null;
  const extras = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const trainings = extras.length || isMultiTrainingDay(session)
    ? (await trainingParts(session, extras)).map((p) => ({ label: stripTrainingIdPrefix(p.label), duration: p.duration }))
    : [{ label: stripTrainingIdPrefix(session.training_type_label), duration: session.duration }];
  return { session, trainings, trainers: await sessionTrainers(session), days: await getSessionDays(session) };
}

function buildEmail(d, r, { added }) {
  const s = d.session;
  const signInUrl = publicSignInUrl(s.qr_token);
  const feedbackUrl = publicFeedbackUrl(s.qr_token);
  const title = d.trainings.map((t) => t.label).join(' + ');
  const first = String(r.name || '').trim().split(/\s+/)[0];
  const dayOutlines = parseJson(s.day_outlines) || [];

  const classRows = [
    [d.trainings.length > 1 ? 'Trainings' : 'Training', d.trainings.map((t) => `${esc(t.label)}${t.duration ? ` <span style="color:${MUTED};">· ${esc(t.duration)}</span>` : ''}`).join('<br>')],
    ['Client', esc(s.client_name)],
    ['Date', esc(sessionDatesText(s))],
    d.days.length ? ['Days', d.days.map((day) => `<strong>Day ${day.day_number}</strong> · ${esc(longDate(day.date) || 'Date to be set')} · ${esc(day.assigned_trainer_name || '')}${dayOutlines[day.day_number - 1] ? note(esc(dayOutlines[day.day_number - 1]).replace(/\n/g, '<br>')) : ''}`).join('<br>')] : null,
    s.location ? ['Location', esc(s.location)] : null,
    ['Trainer(s)', esc(d.trainers.map((t) => t.name).join(', '))],
    s.duration ? [d.trainings.length > 1 ? 'Total duration' : 'Duration', esc(s.duration)] : null,
    s.language && LANGUAGES[s.language] ? ['Language', esc(LANGUAGES[s.language])] : null,
    s.outline && !d.days.length ? ['Outline', esc(s.outline).replace(/\n/g, '<br>')] : null,
  ];
  const linkRows = [
    ['Sign-in page', `${link(signInUrl)}${note('Attendees scan the attached Sign-In QR code (or open this link) to sign in. Use the Trainer tab on the same page, with the trainer PIN, to see who has signed in and to close out the session at the end of class.')}`],
    ['Feedback form', `${link(feedbackUrl)}${note('Attendees can rate the class here - the Feedback QR code is attached too.')}`],
    s.wetransfer_link ? ['Class files', `${link(s.wetransfer_link)}${note('WeTransfer - download these before class.')}`] : null,
    r.portal ? ['Live roster', `${link(`${publicBaseUrl()}/portal`)}${note('On class day, sign in to the ESR Training Portal and click View roster to see who has signed in.')}`] : null,
  ];

  return {
    subject: `${added ? "You've been added to" : 'Your upcoming class'}: ${title} – ${s.client_name} – ${sessionDatesText(s)}`,
    html: emailShell({
      kicker: 'Class Summary',
      title,
      intro: `<p style="margin:0;">Hi ${esc(first)},</p>
        <p style="margin:8px 0 0;">${added ? "You've been added as a trainer on this class" : "You're scheduled to teach this class"}. Here's everything you need. The sign-in and feedback QR codes are attached - show the sign-in code at the start of class.</p>`,
      button: { label: 'Open the Sign-In Page', url: signInUrl },
      panels: [panel('Class details', classRows), panel('Links', linkRows)],
    }),
  };
}

// Emails the summary. `onlyEmployeeIds` limits it to those trainers (the ones just added on an
// edit). Returns who it went to, who has no email, and any that failed.
async function sendTrainerSummary(sessionId, { onlyEmployeeIds = null, added = false } = {}) {
  const d = await summaryDetails(sessionId);
  if (!d) return { error: 'Session not found.' };
  const s = d.session;
  if (s.session_kind === 'toolbox_talk') return { skipped: 'toolbox_talk', sent_to: [], missing: [], failed: [] };
  if (s.status === 'closed') return { error: 'This session is already closed.' };
  const { recipients, missing } = await trainerRecipients(s, onlyEmployeeIds);
  const attachments = recipients.length ? [
    { filename: buildQrFilename(s, 'Sign-In QR'), content: (await qrPngBuffer(s.qr_token)).toString('base64') },
    { filename: buildQrFilename(s, 'Feedback QR'), content: (await feedbackQrPngBuffer(s.qr_token)).toString('base64') },
  ] : [];
  const failed = [];
  for (const r of recipients) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail({ to: r.email, ...buildEmail(d, r, { added }), attachments });
    } catch (err) {
      failed.push(r.email);
      console.error(`Class summary email to ${r.email} failed:`, err.message); // eslint-disable-line no-console
    }
  }
  if (missing.length) {
    await notifyAllUsers({
      type: 'trainer_summary_missing_email',
      title: `No email for ${missing.join(', ')} - class summary not sent`,
      body: `${d.trainings.map((t) => t.label).join(' + ')} – ${s.client_name} – ${sessionDatesText(s)}. Add an email to their profile, then use "Email Class Summary" on the session.`,
      link_path: `/sessions/${s.session_id}`,
      email: false,
    });
  }
  return {
    sent_to: recipients.filter((r) => !failed.includes(r.email)).map((r) => `${r.name} (${r.email})`),
    missing,
    failed,
  };
}

// For create/edit: never lets an email problem fail the save itself.
async function sendTrainerSummarySafely(sessionId, options) {
  try {
    return await sendTrainerSummary(sessionId, options);
  } catch (err) {
    console.error('Class summary email failed:', err.message); // eslint-disable-line no-console
    return { error: 'The class summary email could not be sent.', sent_to: [], missing: [], failed: [] };
  }
}

module.exports = { sendTrainerSummary, sendTrainerSummarySafely };
