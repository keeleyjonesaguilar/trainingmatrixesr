-- An employee is now either a 'trainee' (existing meaning: a client's worker whose compliance
-- is tracked) or a 'trainer' (staff who conduct trainings, profiled on their own Trainers
-- page). Defaults every existing employee to 'trainee' so nothing changes for current data.
ALTER TABLE employees ADD COLUMN employee_type TEXT NOT NULL DEFAULT 'trainee' CHECK (employee_type IN ('trainee','trainer'));
