-- Lets an admin permanently dismiss one employee+training compliance gap (Keeley's request) -
-- for when a training genuinely no longer applies to that specific person, distinct from the
-- client-wide Not Required/Not Applicable override in client_training_requirements. There is no
-- un-ignore by design: if the employee is retrained later, that's simply a new completion
-- record, which naturally stops matching this table's row (see repo.computeCell).
CREATE TABLE IF NOT EXISTS ignored_compliance_gaps (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  training_id   TEXT NOT NULL REFERENCES master_trainings(training_id) ON DELETE CASCADE,
  ignored_at    TEXT NOT NULL,
  ignored_by    TEXT,
  UNIQUE(employee_id, training_id)
);
