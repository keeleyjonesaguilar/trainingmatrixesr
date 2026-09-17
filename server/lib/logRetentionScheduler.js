// Automatically prunes the Security page's three logs once they're older than their retention
// window (Keeley's request, 2026-09-17) - standard practice for this kind of data: 90 days for
// security-relevant logs (login attempts, account/access changes - long enough to investigate a
// suspected breach after the fact), 30 days for the general activity log (routine usage, not a
// compliance record - the real long-term compliance record is the training records/certificates
// themselves, not who clicked what). Runs daily in-process, same always-on approach as
// server/lib/backupScheduler.js, so it doesn't depend on any specific machine being on.
const cron = require('node-cron');
const { dbRun } = require('../db');

const LOGIN_ATTEMPTS_RETENTION_DAYS = 90;
const ACCOUNT_CHANGES_RETENTION_DAYS = 90;
const ACTIVITY_LOG_RETENTION_DAYS = 30;

const CRON_TZ = process.env.BACKUP_CRON_TZ || 'America/New_York';

function cutoffIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function runCleanup() {
  const loginAttempts = await dbRun('DELETE FROM login_attempts WHERE attempted_at < ?', [cutoffIso(LOGIN_ATTEMPTS_RETENTION_DAYS)]);
  const accountChanges = await dbRun('DELETE FROM admin_actions WHERE created_at < ?', [cutoffIso(ACCOUNT_CHANGES_RETENTION_DAYS)]);
  const activityLog = await dbRun('DELETE FROM activity_log WHERE created_at < ?', [cutoffIso(ACTIVITY_LOG_RETENTION_DAYS)]);
  console.log(
    `[${new Date().toISOString()}] Log retention cleanup: ` +
      `${loginAttempts.changes} login attempt(s), ${accountChanges.changes} account change(s), ${activityLog.changes} activity log entr(ies) removed.`
  );
}

function start() {
  cron.schedule('30 2 * * *', () => { runCleanup().catch((err) => console.error(`Log retention cleanup FAILED: ${err.message}`)); }, { timezone: CRON_TZ });
  console.log(`Log retention scheduler started - daily at 2:30 AM (${CRON_TZ}).`);
}

module.exports = { start, runCleanup, LOGIN_ATTEMPTS_RETENTION_DAYS, ACCOUNT_CHANGES_RETENTION_DAYS, ACTIVITY_LOG_RETENTION_DAYS };
