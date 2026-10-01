// Reminders to trainers who haven't finished a session (Keeley's requests, 2026-09-29/30): at
// 9:00 PM Eastern on the day of training, and again at 7:00 AM the next morning if it's still
// open - one email each to its trainer - "close out your session" for a single-day (or final-day) session, "sign off Day N"
// for a day of a multi-day course (lib/sessionDays.js), sent to that day's trainer. Each session/
// day is reminded once, and only for the last few days, so old sessions never left open don't
// all get emailed at once.
//
// Runs only on the live server (Render sets RENDER=true) unless SESSION_REMINDERS=on is set - a
// local copy of the app shares the live database, and must not email trainers while it's being
// tested. The reminder is marked as sent in the database *before* the email goes out, so two
// running copies can never both send it.
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { sendEmail } = require('./email');
const { notifyAllUsers } = require('./notifications');
const { publicSignInUrl } = require('./qr');
const { easternToday, EASTERN_TZ } = require('./dates');
const { getSessionDays, getCoTrainers } = require('./sessionDays');
const { stripTrainingIdPrefix } = require('./certificateFilename');

const REMINDER_WINDOW_DAYS = 3;
const GREEN = '#026754';
const GOLD = '#c49b0d';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function longDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function buildReminderEmail({ session, trainerName, action, dayLabel, date, url }) {
  const training = stripTrainingIdPrefix(session.training_type_label);
  const subject = `Reminder: ${action} – ${training} – ${session.client_name}`;
  const first = String(trainerName || '').split(' ')[0];
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e5e9;overflow:hidden;">
      <tr><td style="background:${GREEN};padding:20px 26px;border-bottom:4px solid ${GOLD};">
        <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">Action Needed</div>
        <div style="${FONT}font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">${esc(action.charAt(0).toUpperCase() + action.slice(1))}</div>
      </td></tr>
      <tr><td style="padding:22px 26px;${FONT}font-size:15px;line-height:1.55;color:#1a1d21;">
        <p style="margin:0 0 12px;">Hi ${esc(first)},</p>
        <p style="margin:0 0 12px;">${esc(dayLabel)} of <strong>${esc(training)}</strong> for <strong>${esc(session.client_name)}</strong> was scheduled for ${esc(longDate(date))}, but it hasn't been ${action.startsWith('close') ? 'closed out' : 'signed off'} yet.</p>
        <p style="margin:0 0 18px;">Open the session's sign-in page, choose the trainer tab, and ${action.startsWith('close') ? 'close the session so the certificates and roster are generated' : 'sign off your day'}.</p>
        <a href="${esc(url)}" style="display:inline-block;background:${GREEN};color:#ffffff;${FONT}font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">Open the Session</a>
        <p style="margin:18px 0 0;font-size:12px;color:#62676f;">You'll need your trainer PIN. If this was already handled, you can ignore this email.</p>
      </td></tr>
      <tr><td style="padding:0 26px 22px;${FONT}font-size:12px;color:#62676f;">
        <div style="border-top:1px solid #e2e5e9;padding-top:14px;"><strong style="color:${GREEN};">Evolution Safety Resources</strong><br>Sent automatically by the ESR Safety Training Matrix. This mailbox isn't monitored.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, html };
}

async function trainerEmail(employeeId, fallback) {
  const employee = employeeId ? await dbGet('SELECT email FROM employees WHERE employee_id = ?', [employeeId]) : null;
  return (employee?.email || fallback || '').trim().toLowerCase() || null;
}

// Any listed trainer can close out (Keeley's call, 2026-10-01), so co-trainers with an email get
// the same reminder - skipping an address that already got it.
async function remindCoTrainers({ session, alreadySent, action, dayLabel, date }) {
  const sent = new Set([alreadySent].filter(Boolean));
  for (const co of await getCoTrainers(session.session_id)) {
    // eslint-disable-next-line no-await-in-loop
    const to = await trainerEmail(co.trainer_employee_id, null);
    if (!to || sent.has(to)) continue; // eslint-disable-line no-continue
    sent.add(to);
    // eslint-disable-next-line no-await-in-loop
    await sendEmail({ to, ...buildReminderEmail({ session, trainerName: co.trainer_name, action, dayLabel, date, url: publicSignInUrl(session.qr_token) }) });
  }
}

async function remind({ session, to, trainerName, action, dayLabel, date }) {
  const label = `${stripTrainingIdPrefix(session.training_type_label)} · ${session.client_name}`;
  if (!to) {
    await notifyAllUsers({
      type: 'session_reminder',
      title: `${label}: ${dayLabel} still needs to be ${action.startsWith('close') ? 'closed out' : 'signed off'}`,
      body: `${trainerName || 'The trainer'} has no email on file, so no reminder could be sent.`,
      link_path: `/sessions/${session.session_id}`,
      email: false,
    });
    return;
  }
  const email = buildReminderEmail({ session, trainerName, action, dayLabel, date, url: publicSignInUrl(session.qr_token) });
  await sendEmail({ to, ...email });
  console.log(`[${new Date().toISOString()}] Session reminder sent to ${to}: ${label} (${dayLabel})`);
}

// 'evening' (9 PM): sessions scheduled for today that still aren't finished. 'morning' (7 AM): ones
// from the last few days still left open. Each mode has its own once-only marker, so the 9 PM
// email never stops the next morning's (Keeley's request, 2026-09-30: both).
const MARKERS = {
  evening: { session: 'evening_reminder_sent_at', day: 'evening_reminder_sent_at' },
  morning: { session: 'close_reminder_sent_at', day: 'reminder_sent_at' },
};

async function runReminders(mode = 'morning') {
  const today = easternToday();
  const oldest = addDays(today, -REMINDER_WINDOW_DAYS);
  const inWindow = (date) => (mode === 'evening' ? date === today : date < today && date >= oldest);
  const marker = MARKERS[mode];
  const sessions = await dbAll(
    `SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.status = 'open'`,
    []
  );
  for (const session of sessions) {
    try {
      if (!session.total_days) {
        if (!inWindow(session.session_date)) continue; // eslint-disable-line no-continue
        // eslint-disable-next-line no-await-in-loop
        const claimed = await dbRun(
          `UPDATE training_sessions SET ${marker.session} = now_utc_text() WHERE session_id = ? AND ${marker.session} IS NULL AND status = ?`,
          [session.session_id, 'open']
        );
        if (!claimed.changes) continue; // eslint-disable-line no-continue
        // eslint-disable-next-line no-await-in-loop
        const leadTo = await trainerEmail(session.trainer_employee_id, session.trainer_email);
        const args = { action: 'close out your training session', dayLabel: 'Your session', date: session.session_date };
        // eslint-disable-next-line no-await-in-loop
        await remind({ session, to: leadTo, trainerName: session.trainer_name, ...args });
        // eslint-disable-next-line no-await-in-loop
        await remindCoTrainers({ session, alreadySent: leadTo, ...args });
        continue; // eslint-disable-line no-continue
      }

      // Multi-day: the day currently open is the one still waiting on its trainer.
      // eslint-disable-next-line no-await-in-loop
      const day = (await getSessionDays(session))[session.current_day - 1];
      if (!day || day.signed_at || !day.date || !inWindow(day.date)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await dbRun(
        `INSERT INTO session_days (id, session_id, day_number, assigned_trainer_name, assigned_trainer_employee_id)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (session_id, day_number) DO NOTHING`,
        [uuidv4(), session.session_id, day.day_number, day.assigned_trainer_name, day.assigned_trainer_employee_id]
      );
      // eslint-disable-next-line no-await-in-loop
      const claimed = await dbRun(
        `UPDATE session_days SET ${marker.day} = now_utc_text() WHERE session_id = ? AND day_number = ? AND ${marker.day} IS NULL AND signed_at IS NULL`,
        [session.session_id, day.day_number]
      );
      if (!claimed.changes) continue; // eslint-disable-line no-continue
      const isFinal = day.day_number === session.total_days;
      // eslint-disable-next-line no-await-in-loop
      const dayTo = await trainerEmail(day.assigned_trainer_employee_id, day.assigned_trainer_employee_id ? null : session.trainer_email);
      const dayArgs = {
        action: isFinal ? 'close out your training session' : `sign off Day ${day.day_number}`,
        dayLabel: `Day ${day.day_number} of ${session.total_days}`,
        date: day.date,
      };
      // eslint-disable-next-line no-await-in-loop
      await remind({ session, to: dayTo, trainerName: day.assigned_trainer_name, ...dayArgs });
      // eslint-disable-next-line no-await-in-loop
      await remindCoTrainers({ session, alreadySent: dayTo, ...dayArgs });
    } catch (err) {
      console.error(`Session reminder failed for ${session.session_id}:`, err.message);
    }
  }
}

function enabled() {
  return process.env.SESSION_REMINDERS === 'on' || (process.env.RENDER === 'true' && process.env.SESSION_REMINDERS !== 'off');
}

function start() {
  if (!enabled()) {
    console.log('Session reminder emails are off on this server (they only run on the live site).');
    return;
  }
  const run = (mode) => runReminders(mode).catch((err) => console.error(`Session reminders (${mode}) FAILED: ${err.message}`));
  cron.schedule('0 7 * * *', () => run('morning'), { timezone: EASTERN_TZ });
  cron.schedule('0 21 * * *', () => run('evening'), { timezone: EASTERN_TZ });
  // Catch up if the server (re)started after 7 AM / 9 PM - already-sent reminders are skipped.
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: EASTERN_TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  setTimeout(() => {
    if (hour >= 7) run('morning');
    if (hour >= 21) run('evening');
  }, 60 * 1000);
  console.log(`Session reminder scheduler started - 9:00 PM day-of and 7:00 AM next morning (${EASTERN_TZ}).`);
}

module.exports = { start, runReminders, buildReminderEmail, remindCoTrainers };
