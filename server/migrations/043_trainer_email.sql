-- Trainer sign-off now also captures a phone number (server/routes/publicSessions.js POST
-- /:token/close), auto-populating a new-or-existing trainer's own profile via the same
-- find-or-create-by-phone match repo.findOrCreateTrainerEmployee already used at session
-- creation time (013_trainer_phone.sql). Phone reuses employees.employee_number like every
-- other trainer/employee phone already does - email has no existing column to reuse, so this
-- adds one. Generic on the shared employees table (not trainer-only) since a trainee's contact
-- info is just as reasonable to have here, even though only trainers populate it for now.
ALTER TABLE employees ADD COLUMN email TEXT;
