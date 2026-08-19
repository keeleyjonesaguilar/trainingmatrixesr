// Shared data-access helpers used across routes, so the matrix/dashboard/detail pages all
// read status the exact same way (single source of truth, per statusEngine.js).
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { computeStatus, parseSourceValue } = require('./statusEngine');

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

// Shared insert/update path for an Employee Training Record - used by the manual "add/correct
// a record" route (trainingRecords.js) AND by a Training Sign-In session close-out (
// sessionRecords.js), so both paths go through the exact same duplicate-detection/status
// computation logic and can never drift out of sync with each other.
function saveTrainingRecord(opts) {
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
  } = opts;

  if (!client_id || !employee_id || !training_id) {
    throw new Error('client_id, employee_id, training_id are required');
  }
  const masterTraining = getMasterTraining(training_id);
  if (!masterTraining) throw new Error('training_id does not exist in Master Trainings');

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
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE employee_training_records
       SET original_client_training_name=?, completion_date=?, source_expiration_date=?, raw_source_value=?, source=?, notes=?, updated_at=?
       WHERE record_id=?`
    ).run(
      original_client_training_name ?? existing.original_client_training_name,
      finalCompletionDate ?? existing.completion_date,
      source_expiration_date ?? existing.source_expiration_date,
      finalRawValue ?? existing.raw_source_value,
      source ?? existing.source,
      notes ?? existing.notes,
      now,
      id
    );
  } else {
    // Rule 15 / duplicate handling: check before inserting whether this employee already has
    // a record for this training, so we know afterward whether to flag the group for review.
    const hadExistingRecord = !!db
      .prepare('SELECT 1 FROM employee_training_records WHERE employee_id = ? AND training_id = ?')
      .get(employee_id, training_id);

    db.prepare(
      `INSERT INTO employee_training_records
       (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
        completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', ?, ?, ?, ?, ?)`
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
      notes,
      now,
      now
    );

    if (hadExistingRecord) flagDuplicatesIfAny(employee_id, training_id);
  }

  return recomputeAndPersistRecord(id);
}

// Attaches a certificate file that was generated/uploaded outside the normal multer upload
// route (e.g. a Training Sign-In certificate PDF generated at session close-out) to a record.
function attachCertificateFile(recordId, { filename, filePath }) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE employee_training_records
     SET certificate_filename = ?, certificate_path = ?, certificate_uploaded_at = ?, updated_at = ?
     WHERE record_id = ?`
  ).run(filename, filePath, now, now, recordId);
}

// Used when creating a Training Sign-In session: the admin just types a client name (same as
// before the merge), and it resolves to a real client_id - creating the client if this is its
// first session - rather than requiring them to first go add the client on the Clients page.
function findOrCreateClientByName(clientName) {
  const trimmed = String(clientName || '').trim();
  if (!trimmed) throw new Error('client_name is required');
  const existing = db.prepare('SELECT * FROM clients WHERE LOWER(client_name) = LOWER(?)').get(trimmed);
  if (existing) return existing.client_id;
  const client_id = uuidv4();
  db.prepare('INSERT INTO clients (client_id, client_name, active) VALUES (?, ?, 1)').run(client_id, trimmed);
  return client_id;
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
  saveTrainingRecord,
  attachCertificateFile,
  findOrCreateClientByName,
};
