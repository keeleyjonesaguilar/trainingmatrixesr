-- Category was never useful data to Keeley (2026-09-17: "you can remove categories as well,
-- those aren't necessary") - dropped from the catalog entirely rather than just hidden in the
-- UI, so nothing (validation, the Master Trainings summary's category breakdown, the derived
-- "High-risk" stat) can silently depend on it going forward.
ALTER TABLE master_trainings DROP COLUMN category;
