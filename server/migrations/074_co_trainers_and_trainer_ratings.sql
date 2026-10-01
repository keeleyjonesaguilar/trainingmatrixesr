-- More than one trainer on a session (Keeley's request, 2026-10-01). training_sessions keeps its
-- one lead trainer (trainer_name / trainer_employee_id); these are the others teaching alongside,
-- on every day of the session. Every trainer's name prints on the certificates and roster, any of
-- them can close out, and all of them get the close-out email and Trainings Taught credit.
CREATE TABLE IF NOT EXISTS session_co_trainers (
  id                   TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  trainer_name         TEXT NOT NULL,
  trainer_employee_id  TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  display_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_co_trainers_session ON session_co_trainers(session_id);
CREATE INDEX IF NOT EXISTS idx_co_trainers_employee ON session_co_trainers(trainer_employee_id);

-- Trainee feedback rates each trainer separately (stars + optional comment per trainer), so a
-- trainer's profile only counts ratings meant for them - including each day's trainer on a
-- multi-day course, which used to share one rating. session_feedback.trainer_rating keeps the
-- average of these for anything that reads the session as a whole; feedback from before this
-- has no rows here and is read the old way.
CREATE TABLE IF NOT EXISTS session_feedback_trainers (
  id                   TEXT PRIMARY KEY,
  feedback_id          TEXT NOT NULL REFERENCES session_feedback(feedback_id) ON DELETE CASCADE,
  trainer_name         TEXT NOT NULL,
  trainer_employee_id  TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  rating               INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment              TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_trainers_feedback ON session_feedback_trainers(feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_trainers_employee ON session_feedback_trainers(trainer_employee_id);
