-- The first training's own duration on a session with 2+ trainings (Keeley's report, 2026-10-07:
-- it used to share training_sessions.duration with the session total, so changing one training's
-- hours changed the total at the top). From now on `duration` is the session total - worked out by
-- adding up every training's duration (server/lib/durations.js) - and the first training's own
-- duration lives here, next to session_additional_trainings.duration for the others. NULL on every
-- single-training session and on older multi-training sessions without per-training durations.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS first_training_duration TEXT;

UPDATE training_sessions ts SET first_training_duration = ts.duration
WHERE ts.first_training_duration IS NULL
  AND EXISTS (SELECT 1 FROM session_additional_trainings s WHERE s.session_id = ts.session_id AND s.duration IS NOT NULL AND s.duration <> '');
