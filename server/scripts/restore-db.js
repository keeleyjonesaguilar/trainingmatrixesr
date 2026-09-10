// Restores a backup produced by backup-db.js. DESTRUCTIVE: every row in every table listed
// below is deleted and replaced with what's in the backup file. Run this only against a
// database whose schema has already been created (the normal migration step - db.js's
// migration runner - handles that; this script only ever touches data, never schema).
//
// Safety: requires RESTORE_CONFIRM=yes as an env var, same pattern as
// server/scripts/migrate-sqlite-to-postgres.js, specifically so this can never run by accident
// (a bare `node server/scripts/restore-db.js` with no confirmation does nothing but print what
// it would have done).
//
// Usage:
//   node server/scripts/restore-db.js <path-to-backup.json>
//   RESTORE_CONFIRM=yes node server/scripts/restore-db.js <path-to-backup.json>   (actually runs it)

require('dotenv').config({ quiet: true });
const fs = require('fs');
const { Pool } = require('pg');
const { TABLES_IN_DEPENDENCY_ORDER } = require('../lib/backupTables');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error('Usage: node server/scripts/restore-db.js <path-to-backup.json>');
  if (!fs.existsSync(filePath)) throw new Error(`Backup file not found: ${filePath}`);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set - check .env.');

  const dump = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Backup file dumped_at: ${dump.dumped_at}`);
  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    console.log(`  ${table}: ${(dump.tables[table] || []).length} rows`);
  }

  if (process.env.RESTORE_CONFIRM !== 'yes') {
    console.log('\nDry run only - nothing was changed. Every row in every table above would be');
    console.log('DELETED and replaced with the counts shown. To actually restore, re-run with:');
    console.log('  RESTORE_CONFIRM=yes node server/scripts/restore-db.js ' + filePath);
    return;
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const table of [...TABLES_IN_DEPENDENCY_ORDER].reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(`DELETE FROM "${table}"`);
    }

    for (const table of TABLES_IN_DEPENDENCY_ORDER) {
      const rows = dump.tables[table] || [];
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map((c) => row[c]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const columnList = columns.map((c) => `"${c}"`).join(', ');
        // eslint-disable-next-line no-await-in-loop
        await client.query(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`, values);
      }
      console.log(`Restored ${rows.length} rows into ${table}`);
    }

    await client.query('COMMIT');
    console.log('\nRestore complete and committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nRestore FAILED - rolled back, database unchanged:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
