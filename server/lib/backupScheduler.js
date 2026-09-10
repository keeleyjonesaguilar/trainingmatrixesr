// Automated daily database backup, running inside this always-on web service (Keeley's request,
// 2026-09-09: backups must not depend on any specific PC being powered on). Writes a data-only
// dump of every table to the SAME persistent disk this app already uses for certificate/roster
// PDFs (see server/lib/paths.js) - physically separate storage from the Postgres database itself,
// and it survives deploys/restarts since it's on the persistent disk, not the container filesystem.
//
// Two-generation rotation, exactly as requested: at all times there is a "latest" backup and a
// "previous" one. Every run demotes the current latest to previous (overwriting whatever was
// there) before writing the new one - never more than two, never fewer than one after the first
// successful run.
//
// This mirrors server/scripts/backup-db.js (kept separately for manual/local-machine backups
// against the external DB URL) but reuses this process's existing pg pool instead of opening a
// second connection, and shares the table list via server/lib/backupTables.js.
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { DATA_DIR } = require('./paths');
const { TABLES_IN_DEPENDENCY_ORDER } = require('./backupTables');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LATEST_PATH = path.join(BACKUP_DIR, 'training-matrix-backup-latest.json');
const PREVIOUS_PATH = path.join(BACKUP_DIR, 'training-matrix-backup-previous.json');
const LOG_PATH = path.join(BACKUP_DIR, 'backup-log.txt');

// Render's containers run in UTC; this lets the schedule stay "2 AM" in the business's own time
// zone regardless. Override with BACKUP_CRON_TZ if the office isn't in US Eastern.
const CRON_TZ = process.env.BACKUP_CRON_TZ || 'America/New_York';

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try {
    fs.appendFileSync(LOG_PATH, stamped + '\n');
  } catch (err) {
    console.error(`Backup log write failed: ${err.message}`);
  }
}

async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const dump = { dumped_at: new Date().toISOString(), tables: {} };
  let totalRows = 0;
  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await pool.query(`SELECT * FROM "${table}"`);
    dump.tables[table] = rows;
    totalRows += rows.length;
  }

  if (fs.existsSync(LATEST_PATH)) {
    fs.copyFileSync(LATEST_PATH, PREVIOUS_PATH);
  }
  const json = JSON.stringify(dump);
  fs.writeFileSync(LATEST_PATH, json);

  const sizeMb = (Buffer.byteLength(json) / (1024 * 1024)).toFixed(2);
  log(`Backup complete: ${TABLES_IN_DEPENDENCY_ORDER.length} tables, ${totalRows} rows, ${sizeMb} MB -> ${LATEST_PATH}`);
}

function start() {
  cron.schedule(
    '0 2 * * *',
    () => {
      runBackup().catch((err) => log(`BACKUP FAILED: ${err.message}`));
    },
    { timezone: CRON_TZ }
  );
  log(`Backup scheduler started - daily at 2:00 AM (${CRON_TZ}), writing to ${BACKUP_DIR}`);
}

module.exports = { start, runBackup, BACKUP_DIR };
