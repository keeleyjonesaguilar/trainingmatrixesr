const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const repo = require('../lib/repo');
const { parseSourceValue } = require('../lib/statusEngine');

const router = express.Router();

router.get('/employee/:employeeId/training/:trainingId', (req, res) => {
  res.json(repo.listRecordsForEmployee(req.params.employeeId, req.params.trainingId));
});

// Manual add/correct of a training record (spec section 9). Preserves whatever original
// wording/date is supplied rather than overwriting silently - each save is a new row unless
// record_id is passed to update an existing one, so history isn't lost (spec section 12).
router.post('/', (req, res) => {
  const {
    record_id, // if present, update in place; otherwise insert
    client_id,
    employee_id,
    training_id,
    original_client_training_name = null,
    completion_date = null,
    source_expiration_date = null,
    raw_source_value = null,
    source = 'Manual Entry',
    notes = null,
  } = req.body;

  if (!client_id || !employee_id || !training_id) {
    return res.status(400).json({ error: 'client_id, employee_id, training_id are required' });
  }
  const masterTraining = repo.getMasterTraining(training_id);
  if (!masterTraining) return res.status(400).json({ error: 'training_id does not exist in Master Trainings' });

  // If a raw value was given (e.g. "YES", "NO", a date) and no explicit completion_date,
  // interpret it the same way an import would - never fabricate a date ourselves.
  let finalCompletionDate = completion_date;
  let finalRawValue = raw_source_value;
  if (!completion_date && raw_source_value) {
    const parsed = parseSourceValue(raw_source_value);
    finalCompletionDate = parsed.completion_date;
    finalRawValue = parsed.raw_source_value;
  }

  const id = record_id || uuidv4();
  const existing = record_id ? db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(record_id) : null;

  if (existing) {
    db.prepare(
      `UPDATE employee_training_records
       SET original_client_training_name=?, completion_date=?, source_expiration_date=?, raw_source_value=?, source=?, notes=?
       WHERE record_id=?`
    ).run(
      original_client_training_name ?? existing.original_client_training_name,
      finalCompletionDate ?? existing.completion_date,
      source_expiration_date ?? existing.source_expiration_date,
      finalRawValue ?? existing.raw_source_value,
      source ?? existing.source,
      notes ?? existing.notes,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO employee_training_records
       (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
        completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', ?, ?, ?)`
    ).run(
      id,
      client_id,
      employee_id,
      training_id,
      masterTraining.training_name,
      original_client_training_name,
      finalCompletionDate,
      source_expiration_date,
      finalRawValue,
      source,
      notes
    );
  }

  const updated = repo.recomputeAndPersistRecord(id);
  res.status(existing ? 200 : 201).json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  db.prepare('DELETE FROM employee_training_records WHERE record_id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
