-- Trainee/trainer email capture (Keeley's request, 2026-09-17) - lets staff reach attendees
-- and adds a second identity point on the trainer sign-off beyond name/PIN. Nullable like
-- trainee_job_title (011) - historical rows have none, and "required going forward" is
-- enforced in the public routes' validation, not a DB constraint.
ALTER TABLE session_attendees ADD COLUMN trainee_email TEXT;
ALTER TABLE training_sessions ADD COLUMN trainer_email TEXT;
