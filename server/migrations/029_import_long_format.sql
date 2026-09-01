-- Support importing "long" spreadsheets - one row per training completion (Employee Full
-- Name / Client / Training Name / Completion Date / Expiration Date), as opposed to the
-- original "wide" shape (one row per employee, one column per training). Real exports from
-- other systems (e.g. a certification tracker) come out this way and can't be reshaped by
-- hand without risking transcription errors on hundreds of rows.
--
-- import_column_map already stores one row per distinct raw label needing a training match;
-- for a long-format batch, source_column_header holds a distinct raw TRAINING NAME VALUE
-- (e.g. "3M Medical Clearance for Respiratory Use") instead of a column header - the matching/
-- resolution flow (auto-match via alias dictionary, else needs_review) is identical either way.
ALTER TABLE import_batches ADD COLUMN format TEXT NOT NULL DEFAULT 'wide' CHECK (format IN ('wide', 'long'));
ALTER TABLE import_batches ADD COLUMN format_meta TEXT;

ALTER TABLE import_staged_rows ADD COLUMN training_name_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN completion_date_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN expiration_date_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN record_type_raw TEXT;
