-- Flags a likely-but-not-exact employee name match during import for a human to confirm, rather
-- than silently creating a second profile for someone already on file (Keeley's request,
-- 2026-09-21: "Cesar Flores Rojas" in a new import and "Rojas, Cesar Flores" already in the
-- system are the same words in a different order, and the exact-string employee match used at
-- commit time has no way to know that on its own). Same "queue it, don't guess" discipline as
-- import_column_map already applies to unmatched training names.
CREATE TABLE IF NOT EXISTS import_employee_matches (
  id                    TEXT PRIMARY KEY,
  batch_id              TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  client_id             TEXT NOT NULL REFERENCES clients(client_id),
  full_name_raw         TEXT NOT NULL,           -- exact name text as it appears in the sheet
  candidate_employee_id TEXT NOT NULL REFERENCES employees(employee_id),
  status                TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review', 'confirmed_existing', 'confirmed_new')),
  created_at            TEXT NOT NULL,
  UNIQUE(batch_id, client_id, full_name_raw)
);
CREATE INDEX IF NOT EXISTS idx_import_employee_matches_batch ON import_employee_matches(batch_id);
