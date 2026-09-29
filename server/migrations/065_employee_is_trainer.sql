-- "Is a trainer" as its own flag, separate from employee_type (Keeley's request, 2026-09-29:
-- trainers who are also employees must stay trainers AND employees in one profile, with their
-- ratings). Merging a trainer profile into their employee profile keeps the employee side
-- (employee_type 'trainee', their real client), so before this a merged trainer who hadn't
-- taught a session yet dropped off the Trainers page and trainer pickers - and a new session for
-- them quietly created a second trainer profile, splitting their sessions and ratings.
ALTER TABLE employees ADD COLUMN is_trainer INTEGER NOT NULL DEFAULT 0;

UPDATE employees SET is_trainer = 1
WHERE employee_type = 'trainer'
   OR employee_id IN (SELECT trainer_employee_id FROM training_sessions WHERE trainer_employee_id IS NOT NULL)
   OR employee_id IN (SELECT trainer_employee_id FROM employee_training_records WHERE trainer_employee_id IS NOT NULL)
   OR employee_id IN (SELECT assigned_trainer_employee_id FROM session_days WHERE assigned_trainer_employee_id IS NOT NULL)
   OR employee_id IN (SELECT signed_trainer_employee_id FROM session_days WHERE signed_trainer_employee_id IS NOT NULL);
