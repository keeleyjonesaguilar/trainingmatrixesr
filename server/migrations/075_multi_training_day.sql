-- Multi Training Day (Keeley's request, 2026-10-05): several trainings taught back to back on one
-- day (e.g. Fall Protection, then Spotter, then Flagger), with attendees scanning the same QR code
-- again to check in at the start of each one - the way a multi-day course checks in each day. It
-- reuses the multi-day attendance machinery: total_days = how many trainings, current_day = the
-- training open for check-in now, session_attendance_days.day_number = which training (1 = the
-- session's own training, 2+ = session_additional_trainings in display_order). Every multi-day-
-- only step (per-day trainers and sign-offs, reminders, the all-days-or-no-certificate rule)
-- checks this flag first. 0 for every existing session - including ones that already cover 2+
-- trainings with one sign-in, which keep working that way (Keeley's call).
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS multi_training_day INTEGER NOT NULL DEFAULT 0;

-- Each training's own duration on a Multi Training Day (the first training keeps using
-- training_sessions.duration).
ALTER TABLE session_additional_trainings ADD COLUMN IF NOT EXISTS duration TEXT;

-- A trainee who answers "Yes" to needing additional training gives their name so the office can
-- reach out (Keeley's request, 2026-10-05). Feedback stays anonymous otherwise.
ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS contact_name TEXT;
