// Class summary emails sent on a schedule (Keeley's request, 2026-10-14; the email itself is
// lib/trainerSummary.js):
//  - 5:00 AM Eastern on the day of training, to whoever teaches that day - on a multi-day course,
//    that day's trainer (and any co-trainers), showing only that day.
//  - TEMPORARY: summaries the office schedules for a set time from the session page ("we will take
//    it out after I am done"). Checked every minute. To remove: this file's runScheduledSummaries,
//    the scheduled-summaries routes in routes/trainingSessions.js, ScheduleSummary in
//    client/src/pages/SessionDetail.jsx, and the scheduled_trainer_summaries table (migration 082).
//
// Same rule as the trainer reminders (lib/sessionReminderScheduler.js): runs only on the live server
// (Render sets RENDER=true) unless TRAINER_SUMMARY_SCHEDULE=on - a local copy shares the live
// database and must not email trainers. Each send is claimed in the database before the email goes
// out, so two running copies can never both send it.
const cron = require('node-cron');
const { dbAll, dbRun } = require('../db');
const { easternToday, EASTERN_TZ } = require('./dates');
const { getSessionDays } = require('./sessionDays');
const { isMultiDay } = require('./sessionParts');
const { sendTrainerSummarySafely } = require('./trainerSummary');

const MORNING_HOUR = 5;
// A restart after this hour doesn't catch up on the morning email - the class is well under way.
const MORNING_CATCH_UP_UNTIL = 11;

async function claimMorning(sessionId, dayNumber, today) {
  const claimed = await dbRun(
    'INSERT INTO trainer_summary_morning_sends (session_id, day_number, send_date) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    [sessionId, dayNumber, today]
  );
  return claimed.changes > 0;
}

async function runMorningSummaries(today = easternToday()) {
  const sessions = await dbAll(
    "SELECT * FROM training_sessions WHERE status = 'open' AND session_kind <> 'toolbox_talk' AND (session_date = ? OR day_dates LIKE ?)",
    [today, `%"${today}"%`]
  );
  for (const session of sessions) {
    try {
      if (isMultiDay(session)) {
        // eslint-disable-next-line no-await-in-loop
        for (const day of (await getSessionDays(session)).filter((d) => d.date === today)) {
          // eslint-disable-next-line no-await-in-loop
          if (!(await claimMorning(session.session_id, day.day_number, today))) continue; // eslint-disable-line no-continue
          // eslint-disable-next-line no-await-in-loop
          const result = await sendTrainerSummarySafely(session.session_id, { morning: true, dayNumber: day.day_number });
          console.log(`[${new Date().toISOString()}] 5 AM class summary, ${session.session_id} Day ${day.day_number}: ${(result.sent_to || []).join(', ') || result.error || 'no one to send to'}`);
        }
      } else if (session.session_date === today) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await claimMorning(session.session_id, 0, today))) continue; // eslint-disable-line no-continue
        // eslint-disable-next-line no-await-in-loop
        const result = await sendTrainerSummarySafely(session.session_id, { morning: true });
        console.log(`[${new Date().toISOString()}] 5 AM class summary, ${session.session_id}: ${(result.sent_to || []).join(', ') || result.error || 'no one to send to'}`);
      }
    } catch (err) {
      console.error(`5 AM class summary failed for ${session.session_id}:`, err.message);
    }
  }
}

// What a sent scheduled summary did, for the session page.
function resultText(result) {
  if (result.error) return result.error;
  const parts = [];
  if (result.sent_to?.length) parts.push(`Sent to ${result.sent_to.join(', ')}`);
  if (result.missing?.length) parts.push(`no email on file for ${result.missing.join(', ')}`);
  if (result.failed?.length) parts.push(`failed for ${result.failed.join(', ')}`);
  return parts.join('; ') || 'No trainers to send to';
}

// TEMPORARY - see the note at the top.
async function runScheduledSummaries() {
  const due = await dbAll(
    'SELECT * FROM scheduled_trainer_summaries WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= now_utc_text() ORDER BY send_at',
    []
  );
  for (const row of due) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await dbRun(
      'UPDATE scheduled_trainer_summaries SET sent_at = now_utc_text() WHERE id = ? AND sent_at IS NULL AND cancelled_at IS NULL',
      [row.id]
    );
    if (!claimed.changes) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const result = await sendTrainerSummarySafely(row.session_id);
    // eslint-disable-next-line no-await-in-loop
    await dbRun('UPDATE scheduled_trainer_summaries SET result = ? WHERE id = ?', [resultText(result), row.id]);
  }
}

function enabled() {
  return process.env.TRAINER_SUMMARY_SCHEDULE === 'on' || (process.env.RENDER === 'true' && process.env.TRAINER_SUMMARY_SCHEDULE !== 'off');
}

function start() {
  if (!enabled()) {
    console.log('Scheduled class summary emails are off on this server (they only run on the live site).');
    return;
  }
  const runMorning = () => runMorningSummaries().catch((err) => console.error(`5 AM class summaries FAILED: ${err.message}`));
  cron.schedule(`0 ${MORNING_HOUR} * * *`, runMorning, { timezone: EASTERN_TZ });
  cron.schedule('* * * * *', () => runScheduledSummaries().catch((err) => console.error(`Scheduled class summaries FAILED: ${err.message}`)), { timezone: EASTERN_TZ });
  // Catch up if the server (re)started after 5 AM this morning - already-sent ones are skipped.
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: EASTERN_TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (hour >= MORNING_HOUR && hour < MORNING_CATCH_UP_UNTIL) setTimeout(runMorning, 60 * 1000);
  console.log(`Class summary scheduler started - 5:00 AM day-of emails (${EASTERN_TZ}) and scheduled sends.`);
}

module.exports = { start, runMorningSummaries, runScheduledSummaries, resultText };
