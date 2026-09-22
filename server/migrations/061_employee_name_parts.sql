-- Separate first/last name columns (Keeley's request, 2026-09-22: names were typed as one
-- "Last, First" string, so the comma was stored as data instead of being how the system shows
-- it). employees.full_name stays - from now on always derived as "Last, First" from these two
-- (server/lib/names.js), so every existing reader of full_name keeps working. Existing rows are
-- filled in at startup by names.backfillEmployeeNameParts() rather than here, so the SQL split and
-- the app's own parsing can never disagree.
ALTER TABLE employees ADD COLUMN first_name TEXT;
ALTER TABLE employees ADD COLUMN last_name TEXT;

-- The public sign-in form already asks for first and last name separately; keep them separate
-- instead of only the combined trainee_name, so matching to an existing employee is exact.
ALTER TABLE session_attendees ADD COLUMN trainee_first_name TEXT;
ALTER TABLE session_attendees ADD COLUMN trainee_last_name TEXT;
