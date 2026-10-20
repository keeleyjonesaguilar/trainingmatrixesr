-- Feedback comments written in Spanish are saved in English (Keeley's request, 2026-10-20): the
-- comment columns hold the English, and the trainee's own words are kept here. NULL means the
-- comment was already English (or hasn't been checked).
ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS trainer_comment_original TEXT;
ALTER TABLE session_feedback_trainers ADD COLUMN IF NOT EXISTS comment_original TEXT;
