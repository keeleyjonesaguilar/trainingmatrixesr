-- Per-day trainers and sign-offs for multi-day sessions (Keeley's request, 2026-09-29: e.g. Bob
-- teaches Day 1 of an OSHA 10, Kasey teaches Day 2, and each signs off their own day). One row
-- per day of a multi-day session: who's assigned to teach it, and - once they sign it off at the
-- end of that day - who actually signed (a substitute is allowed and recorded as such), with
-- their signature. Certificates still only generate at the final day's close-out; these rows are
-- what the employee's training record shows day by day. Single-day sessions never get rows here.
CREATE TABLE IF NOT EXISTS session_days (
  id                             TEXT PRIMARY KEY,
  session_id                     TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  day_number                     INTEGER NOT NULL,
  assigned_trainer_name          TEXT,
  assigned_trainer_employee_id   TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  signed_trainer_name            TEXT,
  signed_trainer_employee_id     TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  signed_trainer_email           TEXT,
  signed_trainer_phone           TEXT,
  signature                      TEXT,
  signed_at                      TEXT,
  -- When the "you haven't signed off/closed this day yet" reminder email went out (see
  -- server/lib/sessionReminderScheduler.js) - so each day is only ever reminded once.
  reminder_sent_at               TEXT,
  UNIQUE(session_id, day_number)
);
CREATE INDEX IF NOT EXISTS idx_session_days_session ON session_days(session_id);
CREATE INDEX IF NOT EXISTS idx_session_days_assigned ON session_days(assigned_trainer_employee_id);
CREATE INDEX IF NOT EXISTS idx_session_days_signed ON session_days(signed_trainer_employee_id);

-- Same once-only reminder marker for a normal single-day session that's still open the morning
-- after it was scheduled.
ALTER TABLE training_sessions ADD COLUMN close_reminder_sent_at TEXT;
