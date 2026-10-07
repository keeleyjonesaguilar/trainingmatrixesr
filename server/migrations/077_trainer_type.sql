-- Trainer Type (Keeley's request, 2026-10-07): each trainer is Internal (one of ESR's own) or
-- External (an outside/client trainer), set on their profile. Session prep (migration 076) only
-- runs for sessions with an Internal trainer. Starts from what was inferred before - a trainer
-- profile under the internal trainers client or Evolution Safety Resources is Internal, anyone
-- else External. NULL (a trainer added later and not set yet) falls back to that same rule.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS trainer_type TEXT;

UPDATE employees e SET trainer_type = CASE
    WHEN e.client_id = 'internal-trainers'
      OR EXISTS (SELECT 1 FROM clients c WHERE c.client_id = e.client_id AND (c.is_internal = 1 OR LOWER(c.client_name) = 'evolution safety resources'))
    THEN 'internal' ELSE 'external' END
WHERE e.trainer_type IS NULL
  AND (e.employee_type = 'trainer' OR e.is_trainer = 1
    OR e.employee_id IN (SELECT trainer_employee_id FROM training_sessions WHERE trainer_employee_id IS NOT NULL)
    OR e.employee_id IN (SELECT assigned_trainer_employee_id FROM session_days WHERE assigned_trainer_employee_id IS NOT NULL)
    OR e.employee_id IN (SELECT signed_trainer_employee_id FROM session_days WHERE signed_trainer_employee_id IS NOT NULL)
    OR e.employee_id IN (SELECT trainer_employee_id FROM session_co_trainers WHERE trainer_employee_id IS NOT NULL));
