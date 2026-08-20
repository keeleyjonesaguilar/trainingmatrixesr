-- Import is moving from "pick one client up front" to "the Client column in the sheet
-- decides, per row" (Keeley's request) - a batch no longer has exactly one client, so
-- import_batches.client_id has to become optional. SQLite can't drop a NOT NULL constraint
-- with a plain ALTER TABLE, so this rebuilds the table the standard safe way: create the new
-- shape, copy every existing row across, drop the old table, rename the new one into place.
-- Written with IF NOT EXISTS / idempotent copies so re-running this on every boot (per
-- server/db.js's migration runner) never fails or duplicates data.
CREATE TABLE IF NOT EXISTS import_batches_new (
  batch_id     TEXT PRIMARY KEY,
  client_id    TEXT REFERENCES clients(client_id) ON DELETE CASCADE,
  filename     TEXT,
  imported_at  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','committed','cancelled')),
  imported_by  TEXT,
  records_imported INTEGER,
  records_needing_review INTEGER
);

INSERT INTO import_batches_new
  SELECT batch_id, client_id, filename, imported_at, status, imported_by, records_imported, records_needing_review
  FROM import_batches;

DROP TABLE import_batches;

ALTER TABLE import_batches_new RENAME TO import_batches;

-- Per-row identity/client/trainer values, staged the same way full_name_raw etc already are -
-- resolved_client_id is filled in automatically when the raw client name exactly matches an
-- existing client, and stays NULL (needing manual review) otherwise.
ALTER TABLE import_staged_rows ADD COLUMN client_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN resolved_client_id TEXT REFERENCES clients(client_id);
ALTER TABLE import_staged_rows ADD COLUMN first_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN last_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN trainer_name_raw TEXT;
