// Creates a permanent, labeled database snapshot tied to an app version (see client/src/
// version.js for the versioning scheme) - separate from the automated daily backup (server/lib/
// backupScheduler.js), which only ever keeps a rolling "latest"/"previous" pair. This one is cut
// deliberately, by hand, at each meaningful version bump, so a specific past version's data is
// still recoverable even after days of daily rotation would otherwise have overwritten it.
//
// Same file format as backup-db.js/backupScheduler.js, so server/scripts/restore-db.js already
// works against a version backup with no changes - just point it at the file.
//
// Usage: node server/scripts/backup-version.js v1.01.00
// Keeps only the 2 most recent version backups (deletes older ones once a 3rd is cut). Reads
// DATABASE_URL from .env like backup-db.js - for this to work from outside Render, that must be
// the EXTERNAL Database URL. Backup destination defaults to C:\TrainingMatrixBackups\versions but
// can be overridden with BACKUP_DIR=<path>.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { TABLES_IN_DEPENDENCY_ORDER } = require('../lib/backupTables');

const BACKUP_DIR = process.env.BACKUP_DIR || 'C:\\TrainingMatrixBackups';
const VERSIONS_DIR = path.join(BACKUP_DIR, 'versions');
const KEEP_COUNT = 2;

async function main() {
  const version = process.argv[2];
  if (!version) throw new Error('Usage: node server/scripts/backup-version.js <version> (e.g. v1.01.00)');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set - check .env (must be the External Database URL when run outside Render).');
  }
  fs.mkdirSync(VERSIONS_DIR, { recursive: true });

  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });

  const dump = { dumped_at: new Date().toISOString(), version, tables: {} };
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

  const filePath = path.join(VERSIONS_DIR, `training-matrix-backup-${version}.json`);
  const json = JSON.stringify(dump);
  fs.writeFileSync(filePath, json);
  const sizeMb = (Buffer.byteLength(json) / (1024 * 1024)).toFixed(2);
  console.log(`Version backup complete: ${TABLES_IN_DEPENDENCY_ORDER.length} tables, ${totalRows} rows, ${sizeMb} MB -> ${filePath}`);

  // Prune to the last KEEP_COUNT version backups, oldest first - so cutting a 3rd version backup
  // drops the oldest of the previous two, exactly mirroring the daily backup's 2-generation rule.
  const files = fs
    .readdirSync(VERSIONS_DIR)
    .filter((f) => f.startsWith('training-matrix-backup-') && f.endsWith('.json'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(VERSIONS_DIR, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);

  const toDelete = files.slice(0, Math.max(0, files.length - KEEP_COUNT));
  for (const f of toDelete) {
    fs.unlinkSync(path.join(VERSIONS_DIR, f.name));
    console.log(`Pruned older version backup: ${f.name}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
