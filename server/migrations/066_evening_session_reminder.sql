-- A second trainer reminder at 9 PM on the day of training (Keeley's request, 2026-09-30), on
-- top of the 7 AM next-morning one from migration 064 - each has its own once-only marker so
-- sending one never suppresses the other (server/lib/sessionReminderScheduler.js).
ALTER TABLE training_sessions ADD COLUMN evening_reminder_sent_at TEXT;
ALTER TABLE session_days ADD COLUMN evening_reminder_sent_at TEXT;
