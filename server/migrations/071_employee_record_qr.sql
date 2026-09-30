-- Each employee's (and trainer's) own QR code (Keeley's request, 2026-09-30): scanning it opens a
-- read-only page with their current trainings, e.g. for a site supervisor checking a badge or
-- hard-hat sticker. The secret in the link is this token - separate from the employee's ID so it
-- can be reset (a lost badge) without touching anything else. Created the first time it's needed.
ALTER TABLE employees ADD COLUMN record_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_record_token ON employees(record_token);
