-- Recognizes an "Employee Status" column during import (Keeley's request, 2026-09-01) so a row
-- that names an employee as inactive/terminated creates them already marked inactive, instead of
-- silently ignoring that column. Scoped to employee creation only - if the row matches an
-- employee who already exists, their active flag is left alone, same as every other identity
-- field (job title, department) the import already refuses to overwrite on an existing employee.
ALTER TABLE import_staged_rows ADD COLUMN employee_status_raw TEXT;
