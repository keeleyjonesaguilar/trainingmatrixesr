-- Keeley's trainer updates list (2026-10-14).

-- A training type can be set up as a multi-day course (OSHA 10 = 2 days, OSHA 30 = 4 days): picking
-- it on the New Session form turns on multi-day with that many days and fills in each day's
-- outline. default_day_outlines is a JSON array of strings, one per day (same convention as
-- training_sessions.day_outlines, migration 057).
ALTER TABLE master_trainings ADD COLUMN IF NOT EXISTS default_total_days INTEGER;
ALTER TABLE master_trainings ADD COLUMN IF NOT EXISTS default_day_outlines TEXT;

-- Each day of a multi-day session has its own PowerPoint (WeTransfer link), so each day's trainer
-- is sent only their day's. JSON array, one link (or "") per day; training_sessions.wetransfer_link
-- stays the single link for a one-day session.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS day_wetransfer_links TEXT;

-- Notes the trainer types when closing out ("Were there any issues during this class?"), and a
-- day's notes on a multi-day course's day sign-off.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS trainer_close_notes TEXT;
ALTER TABLE session_days ADD COLUMN IF NOT EXISTS trainer_notes TEXT;

-- The class summary emailed to each trainer at 5:00 AM Eastern on the day they teach
-- (lib/trainerSummaryScheduler.js). One row per session/day/date, inserted before the email goes
-- out, so it's only ever sent once. day_number is 0 for a one-day session.
CREATE TABLE IF NOT EXISTS trainer_summary_morning_sends (
  session_id  TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  day_number  INTEGER NOT NULL,
  send_date   TEXT NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT now_utc_text(),
  PRIMARY KEY (session_id, day_number, send_date)
);

-- TEMPORARY (Keeley, 2026-10-14: "we will take it out after I am done"): class summary emails the
-- office schedules for a set time. send_at is UTC "YYYY-MM-DD HH:MM:SS", like now_utc_text().
CREATE TABLE IF NOT EXISTS scheduled_trainer_summaries (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  send_at       TEXT NOT NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT now_utc_text(),
  sent_at       TEXT,
  result        TEXT,
  cancelled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_scheduled_trainer_summaries_due ON scheduled_trainer_summaries(send_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- OSHA 10 and OSHA 30 set up as 2- and 4-day courses. The Construction day outlines are copied
-- from the most recent sessions the office set up by hand (OSHA 10: 10/19/2026, OSHA 30:
-- 10/22/2026); General Industry has none on file, so its days start blank. Durations only fill in
-- where none is set.
UPDATE master_trainings SET default_total_days = 2 WHERE training_id IN ('TRN-060', 'TRN-061') AND default_total_days IS NULL;
UPDATE master_trainings SET default_total_days = 4 WHERE training_id IN ('TRN-062', 'TRN-063') AND default_total_days IS NULL;
UPDATE master_trainings SET default_duration = '10 Hours' WHERE training_id IN ('TRN-060', 'TRN-061') AND (default_duration IS NULL OR default_duration = '');
UPDATE master_trainings SET default_duration = '30 Hours' WHERE training_id IN ('TRN-062', 'TRN-063') AND (default_duration IS NULL OR default_duration = '');
UPDATE master_trainings
   SET default_day_outlines = (SELECT day_outlines FROM training_sessions WHERE session_id = '42f58f69-29d2-4c43-825a-c1e9fc05c4df')
 WHERE training_id = 'TRN-060' AND default_day_outlines IS NULL;
UPDATE master_trainings
   SET default_day_outlines = (SELECT day_outlines FROM training_sessions WHERE session_id = '9b20f902-9047-4dc1-8413-a020bbfec74f')
 WHERE training_id = 'TRN-062' AND default_day_outlines IS NULL;
