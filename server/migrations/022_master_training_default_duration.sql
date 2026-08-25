-- Default session duration per Training Type (Keeley's request) - free text, same convention
-- as outline (006_training_outline.sql): no fixed unit, since "4 hours"/"Half day"/"2 days" are
-- all valid answers this app has never tried to force into a structured value.
ALTER TABLE master_trainings ADD COLUMN default_duration TEXT;
