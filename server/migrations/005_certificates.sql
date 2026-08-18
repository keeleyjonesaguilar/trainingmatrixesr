-- Certificate of completion upload (Keeley's request): optional file attached to a training
-- record, either when the record is created or added later from the completed-trainings list.
-- Only the filename/path/upload-time live in the database - the file itself is written to
-- DATA_DIR/certificates, the same persisted disk the SQLite file already lives on (see
-- server/db.js), so it survives redeploys just like the rest of the data.
ALTER TABLE employee_training_records ADD COLUMN certificate_filename TEXT;
ALTER TABLE employee_training_records ADD COLUMN certificate_path TEXT;
ALTER TABLE employee_training_records ADD COLUMN certificate_uploaded_at TEXT;
