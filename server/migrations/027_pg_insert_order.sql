-- Postgres migration: repo.getLatestRecord and the Dashboard's "most recent record" query used
-- SQLite's implicit rowid as an insertion-order tiebreaker when completion_date ties (or is
-- null). Postgres has no equivalent implicit column, so this adds an explicit one. The data
-- migration script sets this to each row's original SQLite rowid (preserving exact prior
-- ordering) and resets the sequence afterward; BIGSERIAL only auto-generates values for rows
-- inserted from here on.
ALTER TABLE employee_training_records ADD COLUMN insert_seq BIGSERIAL;
CREATE INDEX IF NOT EXISTS idx_etr_insert_seq ON employee_training_records(insert_seq);
