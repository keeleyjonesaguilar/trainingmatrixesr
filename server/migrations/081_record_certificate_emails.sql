-- Emailing certificates from an employee's profile (Keeley's request, 2026-10-14) - when a
-- training record's certificate was last emailed, and to which address, shown in its Certificate
-- cell. Same idea as session_attendees.certificate_emailed_at (migration 080).
ALTER TABLE employee_training_records ADD COLUMN IF NOT EXISTS certificate_emailed_at TEXT;
ALTER TABLE employee_training_records ADD COLUMN IF NOT EXISTS certificate_emailed_to TEXT;
