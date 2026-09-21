-- Lets an admin dismiss a specific trainer/employee cross-match without merging it (same
-- "ignore this grouping" mechanism as duplicate_ignores already has for employee/client/trainer
-- clusters - see migrations/016_duplicate_ignores.sql) - Keeley's request, 2026-09-21: a trainer
-- profile and a regular employee profile that share a name/phone are surfaced as a possible
-- match on the Trainers page, since some trainers are also employees with their own completed
-- trainings that should live under one merged profile.
ALTER TABLE duplicate_ignores DROP CONSTRAINT duplicate_ignores_entity_type_check;
ALTER TABLE duplicate_ignores ADD CONSTRAINT duplicate_ignores_entity_type_check
  CHECK (entity_type IN ('employee', 'client', 'trainer', 'trainer_employee'));
