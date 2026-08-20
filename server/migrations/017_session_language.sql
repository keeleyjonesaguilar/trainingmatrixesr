-- Sign-in language per session (Keeley's request): English, Spanish, or both. The Spanish
-- text is machine-translated once (via DeepL) when the session is saved with language set to
-- 'spanish' or 'both', and cached here - the public sign-in page just displays these columns,
-- it never calls the translation API itself, so attendee traffic never costs a translation call.
ALTER TABLE training_sessions ADD COLUMN language TEXT NOT NULL DEFAULT 'english' CHECK (language IN ('english','spanish','both'));
ALTER TABLE training_sessions ADD COLUMN training_type_label_es TEXT;
ALTER TABLE training_sessions ADD COLUMN outline_es TEXT;
