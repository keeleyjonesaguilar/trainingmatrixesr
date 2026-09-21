-- Tracks whether a completed session's roster/certs were sent to the client and/or saved to the
-- server (Keeley's request, 2026-09-21) - two independent manual checkboxes on the session's own
-- page, shown as a status in the Training Sessions list too.
ALTER TABLE training_sessions ADD COLUMN sent_to_client INTEGER NOT NULL DEFAULT 0;
ALTER TABLE training_sessions ADD COLUMN saved_to_server INTEGER NOT NULL DEFAULT 0;
