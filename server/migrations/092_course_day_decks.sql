-- A multi-day course's PowerPoints per day, picked straight from the Content page (Keeley's test
-- of "Training matrix features 11.6", 2026-11-06: picking training types per day made OSHA ask for
-- a main PowerPoint, and she wants each day's PowerPoints shown with that day's outline).
-- JSON: one list of deck_ids per day, in the order they're taught. Replaces default_day_topics,
-- which is still read for a course saved before this.
ALTER TABLE master_trainings ADD COLUMN IF NOT EXISTS default_day_decks TEXT;
