// "Send this training to the client" (Keeley's request, 2026-10-21): 24 hours after a session is
// closed, if Sent to Client still isn't ticked, a Needs attention bell alert goes to the office,
// and an email with quick links goes to Keeley and Emily.
// Ticking Sent to Client (or emailing the certificates to the company, which ticks it) clears it -
// see clearSendToClientAlert below.
//
// Checked every hour. Only sessions closed in the last few days are looked at, so the hundreds of
// older sessions never ticked don't all alert at once. Runs only on the live server, like the
// other schedulers - a local copy shares the live database.
const cron = require('node-cron');
const { dbAll, dbRun } = require('../db');
const { notifyAllUsers } = require('./notifications');
const { sendEmail } = require('./email');
const { stripTrainingIdPrefix } = require('./certificateFilename');

const ALERT_AFTER_HOURS = 24;
const LOOKBACK_HOURS = 72;
// Who gets the email (Keeley's request, 2026-10-21: "me and Emily"). SEND_TO_CLIENT_ALERT_EMAILS
// (comma-separated) replaces the list without a code change.
const ALERT_EMAILS = (process.env.SEND_TO_CLIENT_ALERT_EMAILS || 'keeley@esr-safety.com, emily@esr-safety.com')
  .split(',').map((e) => e.trim()).filter(Boolean);
const GREEN = '#026754';
const GOLD = '#c49b0d';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function longDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// The "Email Certificates to Company" link opens that pop-up on the session page straight away
// (SessionDetail reads ?send=company). Toolbox talks have no certificates, so just the class link.
function buildAlertEmail(session) {
  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:4000').replace(/\/$/, '');
  const sessionUrl = `${base}/sessions/${session.session_id}`;
  const training = stripTrainingIdPrefix(session.training_type_label);
  const subject = `Send to client: ${training} – ${session.client_name}`;
  const button = (href, label, color) => `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;${FONT}font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;margin:0 8px 8px 0;">${esc(label)}</a>`;
  const row = (label, value) => (value ? `<tr><td style="padding:3px 14px 3px 0;color:#62676f;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:3px 0;">${esc(value)}</td></tr>` : '');
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e5e9;overflow:hidden;">
      <tr><td style="background:${GREEN};padding:20px 26px;border-bottom:4px solid ${GOLD};">
        <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">Action Needed</div>
        <div style="${FONT}font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">Send this training to the client</div>
      </td></tr>
      <tr><td style="padding:22px 26px;${FONT}font-size:15px;line-height:1.55;color:#1a1d21;">
        <p style="margin:0 0 14px;">This class closed over ${ALERT_AFTER_HOURS} hours ago and hasn't been marked <strong>Sent to Client</strong> yet.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="${FONT}font-size:14px;margin:0 0 18px;">
          ${row('Training', training)}
          ${row('Client', session.client_name)}
          ${row('Class date', session.session_date ? longDate(session.session_date) : '')}
          ${row('Trainer', session.trainer_name)}
          ${row('Attendees', String(session.attendee_count ?? ''))}
          ${row('Client email', session.certificate_emails)}
        </table>
        ${session.session_kind === 'toolbox_talk' ? '' : button(`${sessionUrl}?send=company`, 'Email Certificates to Company', GREEN)}
        ${button(sessionUrl, 'Open the Class', session.session_kind === 'toolbox_talk' ? GREEN : '#62676f')}
        <p style="margin:12px 0 0;font-size:12px;color:#62676f;">Already sent another way? Tick Sent to Client on the class page.</p>
      </td></tr>
      <tr><td style="padding:0 26px 22px;${FONT}font-size:12px;color:#62676f;">
        <div style="border-top:1px solid #e2e5e9;padding-top:14px;"><strong style="color:${GREEN};">Evolution Safety Resources</strong><br>Sent automatically by the ESR Safety Training Matrix.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, html };
}

// UTC text cutoff, the same form closed_at is stored in.
const hoursAgoSql = (hours) => `to_char((now() AT TIME ZONE 'utc') - interval '${hours} hours', 'YYYY-MM-DD HH24:MI:SS')`;

async function runSendToClientAlerts() {
  const sessions = await dbAll(
    `SELECT ts.session_id, ts.training_type_label, ts.session_date, ts.session_kind, ts.trainer_name, c.client_name, c.certificate_emails,
       (SELECT COUNT(*) FROM session_attendees sa WHERE sa.session_id = ts.session_id) AS attendee_count
     FROM training_sessions ts
     JOIN clients c ON c.client_id = ts.client_id
     WHERE ts.status = 'closed' AND COALESCE(ts.sent_to_client, 0) = 0 AND ts.send_to_client_alert_at IS NULL
       AND ts.closed_at <= ${hoursAgoSql(ALERT_AFTER_HOURS)} AND ts.closed_at >= ${hoursAgoSql(LOOKBACK_HOURS)}`,
    []
  );
  let sent = 0;
  for (const session of sessions) {
    // Claimed before the alert is written, so two running copies never both send it.
    // eslint-disable-next-line no-await-in-loop
    const claimed = await dbRun(
      'UPDATE training_sessions SET send_to_client_alert_at = now_utc_text() WHERE session_id = ? AND send_to_client_alert_at IS NULL',
      [session.session_id]
    );
    if (!claimed.changes) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await notifyAllUsers({
      type: 'send_to_client',
      title: `${stripTrainingIdPrefix(session.training_type_label)} · ${session.client_name}: send the training to the client`,
      body: `Closed over ${ALERT_AFTER_HOURS} hours ago and Sent to Client isn't ticked yet.`,
      link_path: `/sessions/${session.session_id}`,
      email: false,
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail({ to: ALERT_EMAILS, ...buildAlertEmail(session) });
    } catch (err) {
      console.error(`Send-to-client alert email failed for ${session.session_id}:`, err.message);
    }
    sent += 1;
  }
  return sent;
}

// Once the session is sent, its alert is marked read so it drops off Needs attention.
async function clearSendToClientAlert(sessionId) {
  await dbRun(
    "UPDATE notifications SET read_at = now_utc_text() WHERE type = 'send_to_client' AND link_path = ? AND read_at IS NULL",
    [`/sessions/${sessionId}`]
  );
}

function enabled() {
  return process.env.SEND_TO_CLIENT_ALERTS === 'on' || (process.env.RENDER === 'true' && process.env.SEND_TO_CLIENT_ALERTS !== 'off');
}

function start() {
  if (!enabled()) {
    console.log('Send-to-client alerts are off on this server (they only run on the live site).');
    return;
  }
  const run = () => runSendToClientAlerts().catch((err) => console.error(`Send-to-client alerts FAILED: ${err.message}`));
  cron.schedule('5 * * * *', run);
  setTimeout(run, 60 * 1000);
  console.log('Send-to-client alert check started - hourly.');
}

module.exports = { start, runSendToClientAlerts, clearSendToClientAlert, buildAlertEmail };
