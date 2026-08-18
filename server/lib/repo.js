// Shared data-access helpers used across routes, so the matrix/dashboard/detail pages all
// read status the exact same way (single source of truth, per statusEngine.js).
const db = require('../db');
const { computeStatus } = require('./statusEngine');

function listMasterTrainings({ activeOnly = false } = {}) {
  const sql = `SELECT * FROM master_trainings ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY display_order ASC`;
  return db.prepare(sql).all();
}

function getMasterTraining(trainingId) {
  return db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(trainingId);
}

function getRequirement(clientId, trainingId) {
  return db
    .prepare('SELECT * FROM client_training_requirements WHERE client_id = ? AND training_id = ?')
    .get(clientId, trainingId);
}

function listRequirementsForClient(clientId) {
  return db.prepare('SELECT * FROM client_training_requirements WHERE client_id = ?').all(clientId);
}

function getLatestRecord(employeeId, trainingId) {
  // If multiple records exist for the same employee+training (duplicates preserved per spec
  // section 12), the most recently completed one drives the live status; the rest remain
  // visible in history rather than being deleted.
  return db
    .prepare(
      `SELECT * FROM employee_training_records
       WHERE employee_id = ? AND training_id = ?
       ORDER BY (completion_date IS NULL), completion_date DESC, rowid DESC
       LIMIT 1`
    )
    .get(employeeId, trainingId);
}

function listRecordsForEmployee(employeeId, trainingId) {
  return db
    .prepare(
      `SELECT * FROM employee_training_records WHERE employee_id = ? AND training_id = ? ORDER BY rowid DESC`
    )
    .all(employeeId, trainingId);
}

function computeCell({ employeeId, clientId, trainingId, masterTraining, today }) {
  const requirement = getRequirement(clientId, trainingId);
  const record = getLatestRecord(employeeId, trainingId);
  const mt = masterTraining || getMasterTraining(trainingId);
  const { status, expirationDate } = computeStatus({ record, requirement, masterTraining: mt, today });
  return { requirement, record, status, expirationDate, masterTraining: mt };
}

function recomputeAndPersistRecord(recordId, { today } = {}) {
  const record = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(recordId);
  if (!record) return null;
  const masterTraining = getMasterTraining(record.training_id);
  const requirement = getRequirement(record.client_id, record.training_id);
  const { status, expirationDate } = computeStatus({ record, requirement, masterTraining, today });
  db.prepare('UPDATE employee_training_records SET status = ?, expiration_date = ? WHERE record_id = ?').run(
    status,
    expirationDate,
    recordId
  );
  return { ...record, status, expiration_date: expirationDate };
}

function recomputeAllForClientTraining(clientId, trainingId) {
  // Used after a client_training_requirements override changes - every affected record's
  // status/expiration must be refreshed, not left stale.
  const rows = db
    .prepare('SELECT record_id FROM employee_training_records WHERE client_id = ? AND training_id = ?')
    .all(clientId, trainingId);
  for (const r of rows) recomputeAndPersistRecord(r.record_id);
}

module.exports = {
  listMasterTrainings,
  getMasterTraining,
  getRequirement,
  listRequirementsForClient,
  getLatestRecord,
  listRecordsForEmployee,
  computeCell,
  recomputeAndPersistRecord,
  recomputeAllForClientTraining,
};
