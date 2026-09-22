-- Lets a multi-day session record the actual calendar date scheduled for each day (Keeley's
-- request, 2026-09-22), shown to attendees and the admin alongside "Day X of Y" - purely
-- informational/display. The day-advance button (server/migrations/055_multiday_sessions.sql's
-- current_day) stays the real gate on attendance, deliberately NOT calendar-driven, so a slipped
-- day (weather, a holiday) never misjudges who was actually present.
-- Stored as a JSON array of "YYYY-MM-DD" strings, one per day, e.g. ["2026-09-22","2026-09-23",
-- "2026-09-25"] for a course that skips a day - same JSON-in-TEXT convention this table already
-- uses for hs_course_options/hs_optional_topics (see 051_aha_heartsaver_roster.sql).
ALTER TABLE training_sessions ADD COLUMN day_dates TEXT;
