// "Send this training to the client" (Keeley's request, 2026-10-21): 24 hours after a session is
// closed, if Sent to Client still isn't ticked, a Needs attention bell alert goes to the office.
// Ticking Sent to Client (or emailing the certificates to the company, which ticks it) clears it -
// see clearSendToClientAlert below.
//
// Checked every hour. Only sessions closed in the last few days are looked at, so the hundreds of
// older sessions never ticked don't all alert at once. Runs only on the live server, like the
// other schedulers - a local copy shares the live database.
const cron = require('node-cron');
const { dbAll, dbRun } = require('../db');
const { notifyAllUsers } = require('./notifications');
const { stripTrainingIdPrefix } = require('./certificateFilename');

const ALERT_AFTER_HOURS = 24;
const LOOKBACK_HOURS = 72;

// UTC text cutoff, the same form closed_at is stored in.
const hoursAgoSql = (hours) => `to_char((now() AT TIME ZONE 'utc') - interval '${hours} hours', 'YYYY-MM-DD HH24:MI:SS')`;

async function runSendToClientAlerts() {
  const sessions = await dbAll(
    `SELECT ts.session_id, ts.training_type_label, c.client_name FROM training_sessions ts
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

module.exports = { start, runSendToClientAlerts, clearSendToClientAlert };
