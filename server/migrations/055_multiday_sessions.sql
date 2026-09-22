-- Multi-day training sessions (Keeley's request, 2026-09-21/22): one training_sessions row and
-- one QR code covers a whole multi-day course (e.g. OSHA 30 over 4 days), instead of needing a
-- separate session/QR per day. total_days is NULL for every existing/normal single-day session,
-- so none of that behavior changes. current_day is the day new sign-ins/check-ins attach to; the
-- trainer advances it manually between days (see POST /training-sessions/:id/advance-day) -
-- deliberately not calendar-date-based, since a real course can slip a day (weather, a holiday)
-- without that meaning attendance should be judged against the wrong date.
ALTER TABLE training_sessions ADD COLUMN total_days INTEGER;
ALTER TABLE training_sessions ADD COLUMN current_day INTEGER NOT NULL DEFAULT 1;

-- One row per attendee per day they actually signed in, fresh signature each day (Keeley's
-- call). Lets a multi-day session's close-out tell who made every day (gets a certificate) from
-- who missed one (doesn't, flagged 'incomplete_attendance' below) by counting distinct
-- day_number per attendee, without touching session_attendees' own signed_at/signature columns,
-- which stay that attendee's very first sign-in on this session regardless of which day it was.
CREATE TABLE IF NOT EXISTS session_attendance_days (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  attendee_id  TEXT NOT NULL REFERENCES session_attendees(attendee_id) ON DELETE CASCADE,
  day_number   INTEGER NOT NULL,
  signature    TEXT NOT NULL,                -- base64 PNG
  signed_at    TEXT NOT NULL DEFAULT now_utc_text(),
  UNIQUE(session_id, attendee_id, day_number)
);
CREATE INDEX IF NOT EXISTS idx_attendance_days_session ON session_attendance_days(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_days_attendee ON session_attendance_days(attendee_id);

-- New status: an attendee on a multi-day session who didn't attend every required day - no
-- certificate/training record gets generated for them at close (Keeley's call: missing a day
-- means it just doesn't count from this session), but they still show up on the roster so it's
-- obvious who needs to redo it.
ALTER TABLE session_attendees DROP CONSTRAINT session_attendees_processing_status_check;
ALTER TABLE session_attendees ADD CONSTRAINT session_attendees_processing_status_check
  CHECK (processing_status IN ('pending', 'linked', 'no_catalog_match', 'failed', 'incomplete_attendance'));
