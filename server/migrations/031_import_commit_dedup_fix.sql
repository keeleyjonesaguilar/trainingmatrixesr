-- Fixes a bug in 030: import_column_map.committed_at was set as soon as commit() looked at a
-- mapping, even when every row using it was skipped for an unrelated reason (e.g. an
-- unresolved Client) - permanently locking that mapping out of ever being committed once the
-- real blocker got resolved on a later commit call.
--
-- Tracking completion per CREATED RECORD instead fixes this: each employee_training_record
-- remembers which import batch created it, so a re-commit can check - per row, per mapping -
-- whether that exact (employee, training, source label, completion date) combination already
-- has a record from this batch, and skip only those. Nothing is locked out just because it
-- didn't have eligible rows the first time around.
ALTER TABLE import_column_map DROP COLUMN committed_at;
ALTER TABLE employee_training_records ADD COLUMN import_batch_id TEXT REFERENCES import_batches(batch_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_etr_import_batch ON employee_training_records(import_batch_id);
