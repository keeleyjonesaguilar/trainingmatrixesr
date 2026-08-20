-- Trainers are now linked to their profile by phone number (more reliable than matching on
-- name alone - two trainers could share a name, but not a phone). trainer_name stays the
-- frozen display fallback exactly as before - trainer_phone is the new match key captured at
-- session creation/edit time, mirroring that same "frozen at the time" convention.
ALTER TABLE training_sessions ADD COLUMN trainer_phone TEXT;
