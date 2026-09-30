-- Toolbox talks (Keeley's request, 2026-09-30): created and run exactly like a training session
-- (QR sign-in, trainer closes it with the PIN), but with a Topic instead of a catalog training.
-- Close-out makes no certificates; each attendee gets a "Toolbox Talk" record (catalog TRN-108,
-- never expires) on their profile with the topic and date, and the roster is emailed as usual.
ALTER TABLE training_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'training';
ALTER TABLE training_sessions ADD COLUMN toolbox_topic TEXT;
