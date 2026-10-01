-- Office-marked attendance on a multi-day session (Keeley's request, 2026-10-01: "mark a person
-- as present on an OSHA day from behind the scenes in case they forget" to sign in). Those days
-- have no signature, and marked_by records which office user marked them. Trainee sign-ins keep
-- their signature and leave marked_by NULL.
ALTER TABLE session_attendance_days ALTER COLUMN signature DROP NOT NULL;
ALTER TABLE session_attendance_days ADD COLUMN IF NOT EXISTS marked_by TEXT;
