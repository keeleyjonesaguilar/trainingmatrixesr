-- Each day of a multi-day course has its own start time and its own length (Keeley's request,
-- 2026-10-14), sent to that day's trainer. JSON arrays, one entry per day ("" = not set), same
-- convention as day_dates/day_outlines/day_wetransfer_links. start_time stays the one-day session's
-- time (and Day 1's, on a multi-day course); duration stays the whole course's.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS day_start_times TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS day_durations TEXT;
