-- Performance fix (Keeley's report: Employees page "taking forever" to load once real client
-- data grew). The Matrix/Dashboard/Employee Detail pages all call repo.getLatestRecord for
-- every (employee, training) cell, which filters on employee_id + training_id together -
-- employee_training_records only had separate single-column indexes on each, so SQLite could
-- use at most one of them and had to scan/filter the rest per lookup. A composite index lets it
-- seek directly to the matching rows instead.
CREATE INDEX IF NOT EXISTS idx_etr_employee_training ON employee_training_records(employee_id, training_id, is_active_record, is_inactive);
