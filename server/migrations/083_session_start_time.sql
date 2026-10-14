-- Keeley's review notes (2026-10-14).

-- When class starts, "HH:MM" 24-hour Eastern wall-clock time (each day, on a multi-day course) -
-- shown in the trainer's class summary email and on the session page. Optional; NULL = not set.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS start_time TEXT;

-- When the class summary last went to the trainer(s), shown under "Email Class Summary" so it isn't
-- re-sent by mistake right after the session is created.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS trainer_summary_sent_at TEXT;
