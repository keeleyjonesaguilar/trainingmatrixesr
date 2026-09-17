-- Adds "4 Years" as a valid expiration unit (Keeley's 2026-09-17 master catalog rebuild -
-- Flagger certs really do run on a 4-year cycle). Postgres has no ALTER-in-place for a CHECK
-- constraint's expression, so each is dropped and recreated with the new option added.
ALTER TABLE master_trainings DROP CONSTRAINT master_trainings_default_expiration_check;
ALTER TABLE master_trainings ADD CONSTRAINT master_trainings_default_expiration_check
  CHECK (default_expiration IN ('None','1 Year','2 Years','3 Years','4 Years','5 Years'));

ALTER TABLE client_training_requirements DROP CONSTRAINT client_training_requirements_client_expiration_unit_check;
ALTER TABLE client_training_requirements ADD CONSTRAINT client_training_requirements_client_expiration_unit_check
  CHECK (client_expiration_unit IS NULL OR client_expiration_unit IN ('None','1 Year','2 Years','3 Years','4 Years','5 Years'));
