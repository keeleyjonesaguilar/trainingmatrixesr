-- Recording a training completion manually now requires picking a trainer too (Keeley's
-- request), same structured link training_sessions already uses - ON DELETE SET NULL so a
-- removed trainer employee never blocks/cascades away the completion record itself.
ALTER TABLE employee_training_records ADD COLUMN trainer_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL;
