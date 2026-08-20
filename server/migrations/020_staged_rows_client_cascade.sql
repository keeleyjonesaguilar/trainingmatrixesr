-- Fixes "FOREIGN KEY constraint failed" when deleting a client that has any CSV import history.
-- 015_import_per_row_client.sql added import_staged_rows.resolved_client_id (a row's own
-- resolved client, since one batch can now span several clients) but never gave it ON DELETE
-- CASCADE like every other client_id reference has - so deleting a client whose id was ever
-- used as a resolved_client_id anywhere got blocked outright instead of cleaning up the staged
-- rows too. SQLite can't alter an existing column's foreign key in place, so this rebuilds the
-- table the same safe way 015 did: create the new shape, copy every row, drop, rename. Written
-- with IF NOT EXISTS / idempotent copies so re-running this on every boot never fails.
CREATE TABLE IF NOT EXISTS import_staged_rows_new (
  staged_row_id   TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  employee_number_raw TEXT,
  full_name_raw   TEXT,
  job_title_raw   TEXT,
  department_raw  TEXT,
  raw_row_json    TEXT NOT NULL,
  client_name_raw TEXT,
  resolved_client_id TEXT REFERENCES clients(client_id) ON DELETE CASCADE,
  first_name_raw  TEXT,
  last_name_raw   TEXT,
  trainer_name_raw TEXT
);

INSERT INTO import_staged_rows_new
  SELECT staged_row_id, batch_id, employee_number_raw, full_name_raw, job_title_raw, department_raw,
         raw_row_json, client_name_raw, resolved_client_id, first_name_raw, last_name_raw, trainer_name_raw
  FROM import_staged_rows;

DROP TABLE import_staged_rows;

ALTER TABLE import_staged_rows_new RENAME TO import_staged_rows;

CREATE INDEX IF NOT EXISTS idx_isr_batch ON import_staged_rows(batch_id);
