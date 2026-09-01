-- Training Sign-In merge (2026-08-19): sessions/attendees now live in this same database as
-- clients/employees/employee_training_records. Closing a session writes directly into an
-- employee's file (find-or-create the employee, create their training record, attach their
-- certificate) - no separate app, no HTTP sync step, no second login.

CREATE TABLE IF NOT EXISTS training_sessions (
  session_id           TEXT PRIMARY KEY,
  qr_token             TEXT NOT NULL UNIQUE,        -- unguessable public token for the QR code
  client_id            TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  master_training_id   TEXT REFERENCES master_trainings(training_id),  -- nullable: custom/other training
  training_type_label  TEXT NOT NULL,               -- display label used at creation time (frozen even if catalog changes)
  trainer_name         TEXT NOT NULL,
  session_date         TEXT NOT NULL,                -- YYYY-MM-DD
  outline               TEXT,
  status                TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  trainer_signature     TEXT,                        -- base64 PNG, captured at close-out
  trainer_signed_name   TEXT,
  trainer_signed_at     TEXT,
  roster_pdf_path       TEXT,
  created_by            TEXT,                        -- username of admin/user who created it
  created_at            TEXT NOT NULL DEFAULT now_utc_text(),
  closed_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_client ON training_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_training ON training_sessions(master_training_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON training_sessions(status);

CREATE TABLE IF NOT EXISTS session_attendees (
  attendee_id          TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  trainee_name         TEXT NOT NULL,
  trainee_phone        TEXT,
  signature            TEXT NOT NULL,                -- base64 PNG
  signed_at            TEXT NOT NULL DEFAULT now_utc_text(),
  certificate_path     TEXT,
  certificate_filename TEXT,
  employee_id          TEXT REFERENCES employees(employee_id),
  training_record_id   TEXT REFERENCES employee_training_records(record_id),
  -- 'pending' until the session is closed, then 'linked' (employee + training record created/
  -- matched), 'no_catalog_match' (employee found/created, but the session used a custom label
  -- with no Master Training to attach a record to), or 'failed' (an error occurred - retryable).
  processing_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'linked', 'no_catalog_match', 'failed')),
  processing_error     TEXT
);
CREATE INDEX IF NOT EXISTS idx_attendees_session ON session_attendees(session_id);
