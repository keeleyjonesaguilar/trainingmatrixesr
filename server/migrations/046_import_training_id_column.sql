-- Optional "Training ID" column for a long-format import (Keeley's request, 2026-09-17): when a
-- row already names its exact master_trainings.training_id, that should win outright over fuzzy-
-- matching the Certification text - stored raw here (nothing from the source file is ever
-- discarded, same principle as every other *_raw column) and validated/applied at commit time.
ALTER TABLE import_staged_rows ADD COLUMN training_id_raw TEXT;
