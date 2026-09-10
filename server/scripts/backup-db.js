// Data-only, on-demand backup of the production Postgres database, run manually from a local
// machine (e.g. to pull a copy down to your own hardware). The automated daily backup that
// actually runs on its own now lives in server/lib/backupScheduler.js, inside the always-on web
// service itself - see that file for why. This script shares its table list (server/lib/
// backupTables.js) and file format with that scheduler and with restore-db.js, so a file produced
// by either one restores the same way. Schema is deliberately NOT captured here - this app's
// entire schema is already fully reproducible from server/migrations/*.sql in git, so a backup
// only needs to preserve the rows. Restoring means: run this app's normal migration step against
// a fresh database (recreates the schema), then run restore-db.js against this file (reloads the
// data).
//
// Two-generation rotation, exactly as requested: at all times there is a "latest" backup and a
// "previous" one. Every run demotes the current latest to previous (overwriting whatever was
// there) before writing the new one - never more than two, never fewer than one after the first
// successful run.
//
// Usage: node server/scripts/backup-db.js
// Reads DATABASE_URL from .env - for this to work from outside Render, that must be the
// Training-Matrix-db instance's EXTERNAL Database URL, not the internal one (see .env.example).
// Backup destination defaults to C:\TrainingMatrixBackups but can be overridden with
// BACKUP_DIR=<path>.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { TABLES_IN_DEPENDENCY_ORDER } = require('../lib/backupTables');

const BACKUP_DIR = process.env.BACKUP_DIR || 'C:\\TrainingMatrixBackups';
const LATEST_PATH = path.join(BACKUP_DIR, 'training-matrix-backup-latest.json');
const PREVIOUS_PATH = path.join(BACKUP_DIR, 'training-matrix-backup-previous.json');
const LOG_PATH = path.join(BACKUP_DIR, 'backup-log.txt');

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_PATH, stamped + '\n');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set - check .env (must be the External Database URL when run outside Render).');
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });

  const dump = { dumped_at: new Date().toISOString(), tables: {} };
  let totalRows = 0;
  try {
    for (const table of TABLES_IN_DEPENDENCY_ORDER) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await pool.query(`SELECT * FROM "${table}"`);
      dump.tables[table] = rows;
      totalRows += rows.length;
    }
  } finally {
    await pool.end();
  }

  // Rotate: today's "latest" becomes "previous" (overwriting the old previous) before the new
  // dump is written - so a crash between these two steps leaves both files in a valid prior
  // state (worst case, "previous" ends up one generation older than intended) rather than ever
  // leaving zero backups on disk.
  if (fs.existsSync(LATEST_PATH)) {
    fs.copyFileSync(LATEST_PATH, PREVIOUS_PATH);
  }
  const json = JSON.stringify(dump);
  fs.writeFileSync(LATEST_PATH, json);

  const sizeMb = (Buffer.byteLength(json) / (1024 * 1024)).toFixed(2);
  log(`Backup complete: ${TABLES_IN_DEPENDENCY_ORDER.length} tables, ${totalRows} rows, ${sizeMb} MB -> ${LATEST_PATH}`);
}

main().catch((err) => {
  log(`BACKUP FAILED: ${err.message}`);
  process.exitCode = 1;
});
