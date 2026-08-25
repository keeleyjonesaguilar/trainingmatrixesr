-- Post-training feedback (Keeley's request): a second QR code, shown once a session is closed,
-- linking to an anonymous feedback form. Keyed only by session_id - every question is about the
-- session/trainer as a whole and the form has no login/name field, so there's no reliable
-- identity to attach responses to, and multiple trainees submitting one each is expected.
CREATE TABLE IF NOT EXISTS session_feedback (
  feedback_id                TEXT PRIMARY KEY,
  session_id                 TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  could_ask_questions        TEXT,
  understood_material        TEXT,
  needs_additional_training  TEXT,
  effectiveness_rating       INTEGER CHECK (effectiveness_rating BETWEEN 1 AND 5),
  trainer_rating              INTEGER CHECK (trainer_rating BETWEEN 1 AND 5),
  trainer_comment             TEXT,
  submitted_at                TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON session_feedback(session_id);
