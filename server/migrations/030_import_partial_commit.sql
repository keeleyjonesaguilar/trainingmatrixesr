-- Lets an import be committed in stages: training columns/names that are already resolved
-- can be committed right away while the rest stay queued for review, instead of blocking the
-- whole batch on every last ambiguous training (Keeley's request, 2026-09-01 - "make it so
-- unmatched trainings can be edited later, so the big part of the import can be committed").
ALTER TABLE import_batches DROP CONSTRAINT import_batches_status_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_status_check
  CHECK (status IN ('pending_review', 'partially_committed', 'committed', 'cancelled'));

-- Tracks which column/training-name mappings have already had their records created, so
-- committing a batch a second (or third) time only processes newly-resolved mappings instead
-- of recreating records for ones a prior commit already handled.
ALTER TABLE import_column_map ADD COLUMN committed_at TEXT;
