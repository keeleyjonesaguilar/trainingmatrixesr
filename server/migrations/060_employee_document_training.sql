-- Optionally ties an employee document (058_employee_documents.sql) to one catalog training
-- (Keeley's request, 2026-09-22: "offer the option to attach it to a specific training - not
-- required but an option"), e.g. a CPR card to First Aid/CPR/AED. Nullable - most documents
-- (a medical eval, say) belong to the employee in general, not to any one training.
ALTER TABLE employee_documents ADD COLUMN training_id TEXT REFERENCES master_trainings(training_id) ON DELETE SET NULL;
