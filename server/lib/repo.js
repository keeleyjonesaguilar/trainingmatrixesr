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
  // section 12/15), only the active one(s) drive the live status; a record that's been
  // superseded during duplicate resolution (is_active_record = 0) stays in the table for
  // history but is excluded here. The most recently completed active record wins.
  return db
    .prepare(
      `SELECT * FROM employee_training_records
       WHERE employee_id = ? AND training_id = ? AND is_active_record = 1
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

function recomputeAllForClientTraining(clientId, trainingId, effectiveDate) {
  // Used after a client_training_requirements override changes. Rule 9: this must NOT
  // rewrite historical records. If an effective date is set, only touch records with no
  // completion date yet (nothing resolved to protect) or whose completion_date falls on/after
  // the effective date (i.e. completed under the new rule going forward) - records completed
  // before the change keep whatever expiration they were already given. With no effective
  // date (legacy rows, or an explicitly "apply now" change), fall back to refreshing everyone.
  const clauses = ['client_id = ?', 'training_id = ?'];
  const params = [clientId, trainingId];
  if (effectiveDate) {
    clauses.push('(completion_date IS NULL OR completion_date >= ?)');
    params.push(effectiveDate);
  }
  const rows = db
    .prepare(`SELECT record_id FROM employee_training_records WHERE ${clauses.join(' AND ')}`)
    .all(...params);
  for (const r of rows) recomputeAndPersistRecord(r.record_id);
}

// Duplicate handling (Rule 15 / spec sections 18, 33): never delete a duplicate, just flag
// every record sharing this employee+training pair so an authorized user can review and
// choose which one is active. Called after a new record is inserted for a pair that already
// had at least one record on file.
function flagDuplicatesIfAny(employeeId, trainingId) {
  const rows = db
    .prepare(`SELECT record_id FROM employee_training_records WHERE employee_id = ? AND training_id = ?`)
    .all(employeeId, trainingId);
  if (rows.length < 2) return false;
  const mark = db.prepare(
    `UPDATE employee_training_records SET duplicate_status = 'flagged' WHERE record_id = ? AND duplicate_status = 'none'`
  );
  for (const r of rows) mark.run(r.record_id);
  return true;
}

// Resolve a duplicate group: the chosen record becomes the active/current one (drives status
// everywhere), the rest stay in the table (never deleted) but stop competing for "latest".
// All records in the group are marked resolved so they no longer show as needing review.
function resolveDuplicateGroup(activeRecordId) {
  const active = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(activeRecordId);
  if (!active) return null;
  const siblings = db
    .prepare('SELECT record_id FROM employee_training_records WHERE employee_id = ? AND training_id = ?')
    .all(active.employee_id, active.training_id);
  const setActive = db.prepare(
    `UPDATE employee_training_records SET is_active_record = ?, duplicate_status = 'resolved' WHERE record_id = ?`
  );
  for (const s of siblings) setActive.run(s.record_id === activeRecordId ? 1 : 0, s.record_id);
  return recomputeAndPersistRecord(activeRecordId);
}

// Display-only derived flag - deliberately NOT a 7th status in statusEngine.js (that stays the
// single source of truth for Current/Expired/Missing/etc). "Expiring soon" is just "Current,
// but the expiration date is inside the next N days" - computed here wherever it's shown.
function isExpiringSoon(status, expirationDate, days = 30, today) {
  if (status !== 'Current' || !expirationDate) return false;
  const now = today ? new Date(today) : new Date();
  const exp = new Date(expirationDate);
  const diffDays = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
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
  flagDuplicatesIfAny,
  resolveDuplicateGroup,
  isExpiringSoon,
};
