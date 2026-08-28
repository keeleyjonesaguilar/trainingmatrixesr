-- Import is moving from "pick one client up front" to "the Client column in the sheet
-- decides, per row" (Keeley's request) - a batch no longer has exactly one client, so
-- import_batches.client_id has to become optional. SQLite couldn't drop a NOT NULL constraint
-- with a plain ALTER TABLE and needed a full table rebuild for this; Postgres can just drop it
-- directly.
ALTER TABLE import_batches ALTER COLUMN client_id DROP NOT NULL;

-- Per-row identity/client/trainer values, staged the same way full_name_raw etc already are -
-- resolved_client_id is filled in automatically when the raw client name exactly matches an
-- existing client, and stays NULL (needing manual review) otherwise.
ALTER TABLE import_staged_rows ADD COLUMN client_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN resolved_client_id TEXT REFERENCES clients(client_id);
ALTER TABLE import_staged_rows ADD COLUMN first_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN last_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN trainer_name_raw TEXT;
