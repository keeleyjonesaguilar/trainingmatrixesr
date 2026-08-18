-- Gap-fix migration: reconciles the schema with Keeley's master prompt.
--
-- This intentionally does NOT carry forward the earlier "UI expansion" columns (client
-- industry, employee work_location/safety_clearance/last_audit_date, training record
-- certificate_id/verified_by/accredited_provider/evidence_*) - none of that ever shipped
-- to production, and the master prompt doesn't call for it, so it's dropped rather than
-- migrated. Can be re-added later if Keeley wants it back.
--
-- What this adds instead - real gaps found comparing the app against the master prompt:
--   1. Effective Date on Client Training Settings, so overriding a client's requirement
--      doesn't retroactively rewrite records that were already resolved under the prior
--      rule (Rule 9: "client setting changes must not automatically rewrite historical
--      employee records").
--   2. Duplicate-record detection/resolution on Employee Training Records - flagged, never
--      deleted (Rule 15), with one record markable as the active/current one per employee+
--      training pair.
--   3. Created/Modified Date on Employee Training Records, and Imported By + persisted
--      counts on Import Batches (spec sections 6, 32).

-- 1. Client Training Settings: Effective Date.
-- NULL means "no explicit effective date" (legacy rows, or an immediate-effect change) -
-- recompute treats that the same as before (touches every record for that client+training).
ALTER TABLE client_training_requirements ADD COLUMN effective_date TEXT;

-- 2. Employee Training Records: duplicate flag + which record is the active/current one,
-- plus created/modified timestamps.
ALTER TABLE employee_training_records ADD COLUMN duplicate_status TEXT NOT NULL DEFAULT 'none' CHECK (duplicate_status IN ('none','flagged','resolved'));
ALTER TABLE employee_training_records ADD COLUMN is_active_record INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employee_training_records ADD COLUMN created_at TEXT;
ALTER TABLE employee_training_records ADD COLUMN updated_at TEXT;

-- 3. Import Batches: who ran it, and persisted counts for the batch summary (rather than
-- only being derivable from staging tables that may be pruned later).
ALTER TABLE import_batches ADD COLUMN imported_by TEXT;
ALTER TABLE import_batches ADD COLUMN records_imported INTEGER;
ALTER TABLE import_batches ADD COLUMN records_needing_review INTEGER;
