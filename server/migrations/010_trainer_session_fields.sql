-- Links a session to the specific Trainer employee who taught it (see
-- repo.findOrCreateTrainerEmployee), so "Trainings Taught" can be listed on that trainer's own
-- page. trainer_name is untouched and stays the frozen display/free-text fallback.
-- ON DELETE SET NULL (not CASCADE): there is no employees DELETE route today, but if one is
-- ever added, deleting a trainer employee must not delete the training_sessions rows they
-- taught - it should just fall back to the frozen trainer_name text.
ALTER TABLE training_sessions ADD COLUMN trainer_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL;

-- Free-text site/address where the training was held.
ALTER TABLE training_sessions ADD COLUMN location TEXT;

-- Free-text duration (e.g. "4 hours", "Half day") - consistent with this schema's existing
-- convention of free-text fields (trainer_name, outline) for anything without a pre-existing
-- structured format.
ALTER TABLE training_sessions ADD COLUMN duration TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_trainer_employee ON training_sessions(trainer_employee_id);
