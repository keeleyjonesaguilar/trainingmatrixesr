-- Safety Training Matrix Management App - initial schema
-- Design principle: expiration/status logic lives in one place (server/lib/statusEngine.js),
-- not duplicated across the app. This schema stores source-of-truth data only;
-- computed status/expiration on employee_training_records is refreshed by the engine,
-- not hand-maintained by the UI.

PRAGMA foreign_keys = ON;

-- 1. MASTER TRAINING CATALOG
-- Source of truth for training names, categories, types, default expiration.
-- Never create per-client training definitions here - client variance lives in
-- client_training_requirements and training_aliases instead.
CREATE TABLE IF NOT EXISTS master_trainings (
  training_id        TEXT PRIMARY KEY,          -- e.g. 'TRN-001'
  training_name       TEXT NOT NULL,
  category            TEXT NOT NULL,
  training_type        TEXT NOT NULL,
  default_expiration   TEXT NOT NULL CHECK (default_expiration IN ('None','1 Year','2 Years','3 Years','5 Years')),
  active               INTEGER NOT NULL DEFAULT 1,
  display_order        INTEGER NOT NULL
);

-- 2. CLIENTS
CREATE TABLE IF NOT EXISTS clients (
  client_id    TEXT PRIMARY KEY,
  client_name  TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT
);

-- 3. EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
  employee_id      TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  employee_number  TEXT,
  full_name        TEXT NOT NULL,
  job_title        TEXT,
  department       TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_client ON employees(client_id);

-- 4. CLIENT TRAINING REQUIREMENTS
-- Per-client override / requirement configuration for a given Master Training.
-- Absence of a row for (client_id, training_id) means "Required, use Master default" (the implicit default).
CREATE TABLE IF NOT EXISTS client_training_requirements (
  requirement_id        TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  training_id            TEXT NOT NULL REFERENCES master_trainings(training_id) ON DELETE CASCADE,
  requirement_status     TEXT NOT NULL DEFAULT 'Required' CHECK (requirement_status IN ('Required','Not Required','Optional','Not Applicable')),
  client_expiration_unit  TEXT CHECK (client_expiration_unit IS NULL OR client_expiration_unit IN ('None','1 Year','2 Years','3 Years','5 Years')),
  client_training_name    TEXT,     -- optional display-name override for this client
  client_notes            TEXT,
  active                   INTEGER NOT NULL DEFAULT 1,
  UNIQUE(client_id, training_id)
);
CREATE INDEX IF NOT EXISTS idx_ctr_client ON client_training_requirements(client_id);

-- 5. EMPLOYEE TRAINING RECORDS
-- One row per (employee, training) instance of a completion/attempt on record.
-- original_client_training_name preserves exactly what the source spreadsheet called it.
-- original_training_name snapshots the Master Training name at the time this record was
-- created/mapped, so later renames of the catalog don't rewrite history.
-- raw_source_value preserves the literal YES/NO/N/A/date/text value from the source, untouched.
CREATE TABLE IF NOT EXISTS employee_training_records (
  record_id                     TEXT PRIMARY KEY,
  client_id                     TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  employee_id                   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  training_id                    TEXT NOT NULL REFERENCES master_trainings(training_id),
  original_training_name         TEXT,
  original_client_training_name   TEXT,
  completion_date                TEXT,     -- ISO date, nullable
  source_expiration_date          TEXT,     -- explicit expiration date preserved from source, if any
  expiration_date                 TEXT,     -- resolved/computed expiration date (see statusEngine)
  status                          TEXT NOT NULL DEFAULT 'Pending Review'
                                    CHECK (status IN ('Current','Expired','Missing','Not Applicable','No Expiration','Pending Review')),
  raw_source_value                 TEXT,     -- literal YES/NO/N/A/blank/date-range/free text from source
  source                            TEXT,     -- e.g. "Import: clientA_2026.csv" or "Manual Entry"
  notes                             TEXT
);
CREATE INDEX IF NOT EXISTS idx_etr_employee ON employee_training_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_etr_client ON employee_training_records(client_id);
CREATE INDEX IF NOT EXISTS idx_etr_training ON employee_training_records(training_id);

-- 6. TRAINING NAME ALIASES
-- Mapping dictionary: client terminology -> Training ID, used to auto-map import columns.
-- Extensible: new aliases get added as ambiguous imports are manually resolved.
CREATE TABLE IF NOT EXISTS training_aliases (
  alias_id     TEXT PRIMARY KEY,
  alias_text   TEXT NOT NULL,   -- stored normalized (lowercase, trimmed) for matching
  training_id  TEXT NOT NULL REFERENCES master_trainings(training_id),
  UNIQUE(alias_text)
);

-- 7. IMPORT BATCHES + STAGING ROWS
-- Every CSV import is recorded as a batch so nothing is silently discarded;
-- unmatched/ambiguous columns are queued for manual review rather than guessed at.
CREATE TABLE IF NOT EXISTS import_batches (
  batch_id     TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  filename     TEXT,
  imported_at  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','committed','cancelled'))
);

CREATE TABLE IF NOT EXISTS import_column_map (
  map_id             TEXT PRIMARY KEY,
  batch_id           TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  source_column_header TEXT NOT NULL,
  matched_training_id  TEXT REFERENCES master_trainings(training_id),
  match_confidence     TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_confidence IN ('exact_alias','fuzzy','unmatched','manual')),
  resolution_status    TEXT NOT NULL DEFAULT 'needs_review' CHECK (resolution_status IN ('auto_matched','needs_review','resolved','ignored'))
);
CREATE INDEX IF NOT EXISTS idx_icm_batch ON import_column_map(batch_id);

CREATE TABLE IF NOT EXISTS import_staged_rows (
  staged_row_id   TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  employee_number_raw TEXT,
  full_name_raw   TEXT,
  job_title_raw   TEXT,
  department_raw  TEXT,
  raw_row_json    TEXT NOT NULL   -- full raw row as JSON, so nothing from source is ever lost
);
CREATE INDEX IF NOT EXISTS idx_isr_batch ON import_staged_rows(batch_id);
