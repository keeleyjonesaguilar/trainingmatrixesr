-- "Trainers" feature: trainers are employees, but they must never appear in a real client's
-- roster and must never be counted in cross-client dashboard/matrix/report aggregates. Rather
-- than allow employees.client_id to be NULL (it's NOT NULL by design elsewhere in the app),
-- this flags certain clients as internal/administrative and seeds exactly one such pseudo-
-- client to hold every trainer employee.
ALTER TABLE clients ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;

-- Seed the one pseudo-client that houses all Trainer-type employees. Fixed, well-known
-- client_id (not a uuid) so server code (repo.js) can reference it as a constant without a
-- name lookup. INSERT OR IGNORE makes this safe to re-run on every boot.
INSERT OR IGNORE INTO clients (client_id, client_name, active, notes, is_internal)
VALUES (
  'internal-trainers',
  'Internal / Trainers',
  1,
  'System-managed pseudo-client holding Trainer-type employee profiles. Excluded from all dashboard/matrix/report aggregates.',
  1
);
