-- Soft-delete for Employee Training Records. The existing DELETE /api/training-records/:id
-- stays as-is (real, destructive, unlinks the certificate file). is_inactive = 1 means "treat
-- this record as if it doesn't exist" everywhere compliance is computed/displayed, while
-- keeping the row (and its certificate) on file, reversible via a Reactivate action.
ALTER TABLE employee_training_records ADD COLUMN is_inactive INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_etr_is_inactive ON employee_training_records(is_inactive);
