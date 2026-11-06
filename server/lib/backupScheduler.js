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
//
// Also pushes the same backup to a private GitHub repo, off Render entirely (Keeley's request,
// 2026-09-16 - OSHA compliance data, "I can't lose data from this application") - see
// server/lib/githubBackup.js for that half.
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const { pool } = require('../db');
const { DATA_DIR } = require('./paths');
const { TABLES_IN_DEPENDENCY_ORDER } = require('./backupTables');
const { pushBackupFileToGitHub } = require('./githubBackup');

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

const IN_PROGRESS_PATH = path.join(BACKUP_DIR, 'backup-in-progress.tmp');

// Rows fetched from the database per round trip. Sign-in signatures are base64 PNGs of ~40-50 KB
// each, so 100 rows is at most a few MB in memory at once.
const ROWS_PER_FETCH = 100;

// Streams every table straight into `filePath`, ROWS_PER_FETCH rows at a time, so memory stays
// flat no matter how big the database gets.
//
// 2026-11-06: the service ran out of memory (512 MB) at exactly 2:00 AM. The old version loaded
// every row of every table into memory, built the whole backup as one string, and then made three
// more full-size copies of it for the GitHub upload (a Buffer, the base64 text, and the JSON
// request body), all at the same time. The backup had grown from ~25 MB (10/01) to ~36 MB (10/06)
// and kept growing with every sign-in signature, so that peak passed 512 MB.
//
// The file written is the same compact JSON as before ({"dumped_at":..,"tables":{"name":[rows]}}),
// so server/scripts/restore-db.js reads it unchanged. One read-only REPEATABLE READ transaction
// covers every table, so the backup is also a consistent snapshot (rows added mid-backup can't
// show up in one table and be missing from the table that references them).
async function writeDumpFile(filePath, dumpedAt) {
  const out = fs.createWriteStream(filePath);
  const write = async (text) => {
    if (!out.write(text)) await once(out, 'drain');
  };
  const client = await pool.connect();
  let totalRows = 0;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await write(`{"dumped_at":${JSON.stringify(dumpedAt)},"tables":{`);
    for (let t = 0; t < TABLES_IN_DEPENDENCY_ORDER.length; t += 1) {
      const table = TABLES_IN_DEPENDENCY_ORDER[t];
      await write(`${t ? ',' : ''}${JSON.stringify(table)}:[`);
      await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT * FROM "${table}"`);
      let first = true;
      for (;;) {
        const { rows } = await client.query(`FETCH ${ROWS_PER_FETCH} FROM backup_rows`);
        if (!rows.length) break;
        await write((first ? '' : ',') + rows.map((row) => JSON.stringify(row)).join(','));
        first = false;
        totalRows += rows.length;
      }
      await client.query('CLOSE backup_rows');
      await write(']');
    }
    await write('}}');
    await client.query('COMMIT');
    out.end();
    await once(out, 'close');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    out.destroy();
    fs.rmSync(filePath, { force: true });
    throw err;
  } finally {
    client.release();
  }
  return totalRows;
}

let running = false;

async function runBackup() {
  // A run that somehow takes longer than a day must never overlap the next one.
  if (running) {
    log('Backup skipped - the previous run is still going.');
    return;
  }
  running = true;
  try {
    await runBackupOnce();
  } finally {
    running = false;
  }
}

async function runBackupOnce() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const dumpedAt = new Date().toISOString();
  // Written under a temporary name first, so "latest" is never a half-written file if the run
  // fails part way - it only replaces "latest" once it's complete.
  const totalRows = await writeDumpFile(IN_PROGRESS_PATH, dumpedAt);

  if (fs.existsSync(LATEST_PATH)) {
    fs.copyFileSync(LATEST_PATH, PREVIOUS_PATH);
  }
  fs.renameSync(IN_PROGRESS_PATH, LATEST_PATH);

  const sizeMb = (fs.statSync(LATEST_PATH).size / (1024 * 1024)).toFixed(2);
  log(`Backup complete: ${TABLES_IN_DEPENDENCY_ORDER.length} tables, ${totalRows} rows, ${sizeMb} MB -> ${LATEST_PATH}`);

  // Off-Render copy, independent of this app's own infrastructure - see server/lib/
  // githubBackup.js. Failure here is logged loudly (this is the whole point of the exercise) but
  // doesn't undo the local backup above, which already succeeded. It streams from the file just
  // written, so it doesn't hold the backup in memory either.
  try {
    const result = await pushBackupFileToGitHub(LATEST_PATH, dumpedAt);
    if (result.skipped) {
      log('GitHub off-Render backup skipped (GITHUB_BACKUP_TOKEN/GITHUB_BACKUP_REPO not set).');
    } else {
      log(`GitHub off-Render backup pushed to ${process.env.GITHUB_BACKUP_REPO}.`);
    }
  } catch (err) {
    log(`GITHUB BACKUP PUSH FAILED: ${err.message}`);
  }
}

function start() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
