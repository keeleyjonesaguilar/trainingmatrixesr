-- Lets one session (one sign-in code, one roster) cover 2+ trainings taught together in the
-- same class (e.g. Fall Protection + CPR) - Keeley's request, 2026-09-17. The session's existing
-- master_training_id/training_type_label columns stay exactly as-is and now mean "the first/
-- primary training" - a single-training session (the overwhelming majority) has zero rows here
-- and behaves completely unchanged. Each extra training gets its own row instead of trying to
-- cram a list into the session's singular columns, keeping every existing single-training code
-- path untouched.
CREATE TABLE session_additional_trainings (
  id                   TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  master_training_id   TEXT REFERENCES master_trainings(training_id),
  training_type_label  TEXT NOT NULL,
  display_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_session_additional_trainings_session ON session_additional_trainings(session_id);

-- One attendee's certificate/training-record for one *additional* training. The primary
-- training's certificate/record stays on session_attendees exactly as before (certificate_path,
-- training_record_id, processing_status) - this table only ever holds rows for training #2+, so
-- an ordinary single-training session never touches it at all.
CREATE TABLE attendee_certificates (
  id                              TEXT PRIMARY KEY,
  attendee_id                     TEXT NOT NULL REFERENCES session_attendees(attendee_id) ON DELETE CASCADE,
  session_additional_training_id  TEXT NOT NULL REFERENCES session_additional_trainings(id) ON DELETE CASCADE,
  employee_id                     TEXT REFERENCES employees(employee_id),
  training_record_id              TEXT REFERENCES employee_training_records(record_id),
  certificate_path                TEXT,
  certificate_filename            TEXT,
  processing_status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'linked', 'no_catalog_match', 'failed')),
  processing_error                TEXT
);
CREATE INDEX idx_attendee_certificates_attendee ON attendee_certificates(attendee_id);
CREATE INDEX idx_attendee_certificates_training ON attendee_certificates(session_additional_training_id);
