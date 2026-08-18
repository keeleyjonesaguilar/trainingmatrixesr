const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'training_matrix.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Run statement-by-statement (not one db.exec(sql) for the whole file) so that a migration
    // adding columns via ALTER TABLE can run safely on every boot: SQLite has no
    // "ADD COLUMN IF NOT EXISTS", so on the second+ boot the column already exists and that one
    // statement errors - we skip just that error and keep going, instead of the whole file
    // (and therefore server startup) failing every restart after the first successful deploy.
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        db.exec(statement);
      } catch (err) {
        if (/duplicate column name/i.test(err.message)) continue;
        throw err;
      }
    }
  }
}

runMigrations();

module.exports = db;
