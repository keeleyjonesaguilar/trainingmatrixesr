// One-off cutover script: copies every row out of the existing production SQLite database
// (data/training_matrix.db) into the new Render PostgreSQL database ("Training-Matrix-db"),
// preserving every column and existing TEXT/UUID primary key exactly.
//
// NOT part of the running app - run manually, once, from Render's Shell tab on the currently
// live service (it has both the disk with the SQLite file AND network access to Postgres via
// DATABASE_URL), BEFORE switching the deployed code over to the Postgres-backed version.
//
// Usage (from the repo root, with DATABASE_URL pointed at Training-Matrix-db):
//   MIGRATE_CONFIRM=yes node server/scripts/migrate-sqlite-to-postgres.js
//
// Safe to re-run: every insert uses ON CONFLICT DO NOTHING (or DO UPDATE for the two settings
// tables, so real edits there always win), so running it twice never duplicates data. It does
// NOT touch the SQLite file except to checkpoint its WAL log (folds pending writes into the
// main .db file so nothing recent gets missed) - the SQLite file and disk are left in place
// afterward as an untouched rollback safety net.
const path = require('path');
const Database = require('better-sqlite3');
const { dbRun, pool } = require('../db');

if (process.env.MIGRATE_CONFIRM !== 'yes') {
  console.error('Refusing to run without MIGRATE_CONFIRM=yes (this writes into the target DATABASE_URL).');
  console.error('Usage: MIGRATE_CONFIRM=yes node server/scripts/migrate-sqlite-to-postgres.js');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'training_matrix.db');

// Dependency order (referenced tables before the tables that reference them), so foreign keys
// never fail partway through. employee_training_records is handled separately below (it needs
// the extra insert_seq column populated from SQLite's rowid).
const PLAIN_TABLES_IN_ORDER = [
  'master_trainings',
  'clients',
  'employees',
  'client_training_requirements',
  'duplicate_ignores',
  'ignored_compliance_gaps',
  'import_batches',
  'import_column_map',
  'import_staged_rows',
  'training_sessions',
  'session_attendees',
  'session_feedback',
  'app_users',
];

// These two are seeded with default rows by the migrations themselves (session_secret,
// feedback_form_settings.default) - upsert (DO UPDATE) so real production values always win
// over whatever the fresh Postgres migrations just seeded, instead of DO NOTHING silently
// keeping the seeded default.
const UPSERT_TABLES = {
  app_settings: 'key',
  feedback_form_settings: 'id',
};

async function copyPlainTable(sqliteDb, tableName) {
  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    await dbRun(
      `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      columns.map((c) => row[c])
    );
  }
  return rows.length;
}

async function copyUpsertTable(sqliteDb, tableName, conflictColumn) {
  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const updateClause = columns.filter((c) => c !== conflictColumn).map((c) => `${c} = excluded.${c}`).join(', ');
    await dbRun(
      `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updateClause}`,
      columns.map((c) => row[c])
    );
  }
  return rows.length;
}

// These two tables got a Postgres-only insert_seq column (027/028_pg_*.sql) replacing SQLite's
// implicit rowid, which repo.getLatestRecord/Dashboard and masterTrainings' "recently mapped
// aliases" query relied on as an insertion-order tiebreaker. Preserving the exact original
// rowid value keeps that ordering identical after the migration.
async function copyTablePreservingInsertOrder(sqliteDb, tableName) {
  const rows = sqliteDb.prepare(`SELECT rowid AS insert_seq, * FROM ${tableName} ORDER BY rowid`).all();
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    await dbRun(
      `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      columns.map((c) => row[c])
    );
  }
  if (rows.length) {
    await dbRun(
      `SELECT setval(pg_get_serial_sequence('${tableName}', 'insert_seq'), (SELECT MAX(insert_seq) FROM ${tableName}))`
    );
  }
  return rows.length;
}

async function countRows(sqliteDb, postgresQuery, tableName) {
  const { n: sqliteCount } = sqliteDb.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get();
  const pgResult = await pool.query(`SELECT COUNT(*) AS n FROM ${tableName}`);
  return { sqliteCount, postgresCount: Number(pgResult.rows[0].n) };
}

async function main() {
  console.log(`SQLite source: ${SQLITE_PATH}`);
  console.log(`Postgres target: ${(process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':****@')}`);

  const sqliteDb = new Database(SQLITE_PATH, { fileMustExist: true });
  // Folds any pending WAL log into the main .db file so nothing recently written is missed -
  // the .db-wal file can otherwise be larger than the .db file itself under WAL mode.
  sqliteDb.pragma('wal_checkpoint(TRUNCATE)');

  console.log('\nWaiting for Postgres migrations to finish running...');
  const db = require('../db');
  await db.ready;

  const results = [];

  for (const table of PLAIN_TABLES_IN_ORDER) {
    console.log(`Copying ${table}...`);
    const count = await copyPlainTable(sqliteDb, table);
    results.push({ table, copied: count });
  }

  for (const table of ['training_aliases', 'employee_training_records']) {
    console.log(`Copying ${table} (preserving insertion order)...`);
    const count = await copyTablePreservingInsertOrder(sqliteDb, table);
    results.push({ table, copied: count });
  }

  for (const [table, conflictColumn] of Object.entries(UPSERT_TABLES)) {
    console.log(`Copying ${table} (upsert)...`);
    const count = await copyUpsertTable(sqliteDb, table, conflictColumn);
    results.push({ table, copied: count });
  }

  console.log('\nVerifying row counts (SQLite source vs. Postgres target)...\n');
  let allMatch = true;
  const allTables = [...PLAIN_TABLES_IN_ORDER, 'training_aliases', 'employee_training_records', ...Object.keys(UPSERT_TABLES)];
  for (const table of allTables) {
    const { sqliteCount, postgresCount } = await countRows(sqliteDb, null, table);
    const match = sqliteCount === postgresCount;
    if (!match) allMatch = false;
    console.log(`  ${table.padEnd(32)} sqlite=${sqliteCount}  postgres=${postgresCount}  ${match ? 'OK' : '*** MISMATCH ***'}`);
  }

  sqliteDb.close();
  await pool.end();

  if (!allMatch) {
    console.error('\nRow count mismatch on at least one table - investigate before cutting over. Nothing was rolled back.');
    process.exit(1);
  }
  console.log('\nAll row counts match. Safe to deploy the Postgres-backed code and set DATABASE_URL on Render.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
