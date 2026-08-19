-- Editable training outline (Keeley's request, 2026-08-19): a free-text description of what
-- a training covers, editable from the Training page itself. NULL until an admin sets one -
-- the UI shows a "No outline yet" placeholder in that case.
ALTER TABLE master_trainings ADD COLUMN outline TEXT;
