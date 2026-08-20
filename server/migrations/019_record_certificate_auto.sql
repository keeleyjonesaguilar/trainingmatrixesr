-- Tracks whether a record's certificate was generated automatically by the app (vs a real file
-- an admin uploaded by hand) - Keeley's request to auto-generate certificates for manually
-- entered/imported training completions. Auto-generated ones are safe to regenerate later, e.g.
-- once a trainer gets added to the record - an admin's own upload never gets silently replaced.
ALTER TABLE employee_training_records ADD COLUMN certificate_auto_generated INTEGER NOT NULL DEFAULT 0;
