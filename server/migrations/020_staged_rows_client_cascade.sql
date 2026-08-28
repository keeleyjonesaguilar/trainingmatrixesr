-- Fixes "FOREIGN KEY constraint failed" when deleting a client that has any CSV import history.
-- 015_import_per_row_client.sql added import_staged_rows.resolved_client_id (a row's own
-- resolved client, since one batch can now span several clients) but never gave it ON DELETE
-- CASCADE like every other client_id reference has - so deleting a client whose id was ever
-- used as a resolved_client_id anywhere got blocked outright instead of cleaning up the staged
-- rows too. SQLite couldn't alter an existing column's foreign key in place and needed a full
-- table rebuild for this; Postgres can just swap the constraint directly. Constraint name below
-- is Postgres's default auto-generated name (<table>_<column>_fkey) for the FK 015 added inline
-- via "ADD COLUMN resolved_client_id TEXT REFERENCES clients(client_id)".
ALTER TABLE import_staged_rows DROP CONSTRAINT IF EXISTS import_staged_rows_resolved_client_id_fkey;
ALTER TABLE import_staged_rows ADD CONSTRAINT import_staged_rows_resolved_client_id_fkey
  FOREIGN KEY (resolved_client_id) REFERENCES clients(client_id) ON DELETE CASCADE;
