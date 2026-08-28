const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool, types } = require('pg');

// pg returns BIGINT/COUNT(*) (OID 20) as strings by default, to avoid silent precision loss on
// huge values - but better-sqlite3 always returned plain JS numbers, and this app's counts
// (rows, not ids) never approach Number.MAX_SAFE_INTEGER, so parsing them as numbers here avoids
// having to fix every `=== 0`/arithmetic call site across routes/repo.js individually.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required (Render Postgres connection string)');
}

// Render's internal connection string doesn't need TLS; anything else (external URL, other
// hosts) does, and Render's certs aren't in Node's default trust store, so we don't verify them.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// Lets db.transaction() call sites (and everything they call transitively - repo.js functions
// several layers deep) share one client/connection without threading it through every function
// signature. dbGet/dbAll/dbRun check this before falling back to the pool.
const txnContext = new AsyncLocalStorage();

function getExecutor() {
  return txnContext.getStore() || pool;
}

// Every call site was written for better-sqlite3's `?` placeholders. Converting them to
// Postgres's positional $1/$2/... here (instead of rewriting every call site) means the existing
// dynamic-clause-building code (variable-length WHERE/IN clauses) doesn't need to change at all.
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function dbAll(sql, params = []) {
  const result = await getExecutor().query(toPositional(sql), params);
  return result.rows;
}

async function dbGet(sql, params = []) {
  const rows = await dbAll(sql, params);
  return rows[0];
}

async function dbRun(sql, params = []) {
  const result = await getExecutor().query(toPositional(sql), params);
  return { changes: result.rowCount, rows: result.rows };
}

// Mirrors better-sqlite3's db.transaction(fn) - runs fn inside BEGIN/COMMIT/ROLLBACK. Unlike
// better-sqlite3, fn must be async; anything it calls (directly or via repo.js) that goes through
// dbGet/dbAll/dbRun automatically uses this transaction's connection via txnContext.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txnContext.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Tracks which migration files have already run, so 26+ files don't need to be individually
// safe to re-execute on every boot (SQLite's old db.js had to catch "duplicate column" errors
// for exactly this reason - Postgres lets us just not re-run a file at all).
async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

const ready = runMigrations();

module.exports = { pool, dbGet, dbAll, dbRun, withTransaction, ready };
