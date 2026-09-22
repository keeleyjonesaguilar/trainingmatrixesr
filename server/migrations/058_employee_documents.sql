-- Lets an admin attach general supporting documents to an employee's own record - an existing
-- OSHA/CPR card, a medical evaluation, etc. - that aren't tied to one specific training
-- completion the way a certificate-of-completion upload is (employee_training_records'
-- certificate_* columns, see 005_certificates.sql). Deliberately its own table rather than more
-- columns on employees, since there can be any number of these per employee.
CREATE TABLE IF NOT EXISTS employee_documents (
  document_id  TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  label        TEXT NOT NULL,              -- admin-typed, e.g. "OSHA 10 Card", "CPR Card", "Medical Eval" - free text, not a fixed list, since real documents vary too widely to enumerate
  filename     TEXT NOT NULL,              -- original filename, used on download
  file_path    TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL DEFAULT now_utc_text(),
  uploaded_by  TEXT                        -- username of the admin who uploaded it
);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
