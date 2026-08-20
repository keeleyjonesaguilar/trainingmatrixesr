// Shared data-access helpers used across routes, so the matrix/dashboard/detail pages all
// read status the exact same way (single source of truth, per statusEngine.js).
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { computeStatus, parseSourceValue } = require('./statusEngine');
const { formatPhoneNumber } = require('./phone');

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
  // history but is excluded here. is_inactive = 0 excludes soft-deleted records the same way -
  // treated as if they don't exist for compliance purposes, but never physically deleted. The
  // most recently completed active record wins.
  return db
    .prepare(
      `SELECT * FROM employee_training_records
       WHERE employee_id = ? AND training_id = ? AND is_active_record = 1 AND is_inactive = 0
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
    .prepare(`SELECT record_id FROM employee_training_records WHERE employee_id = ? AND training_id = ? AND is_inactive = 0`)
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
    trainer_employee_id = null,
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
       SET original_client_training_name=?, completion_date=?, source_expiration_date=?, raw_source_value=?, source=?, notes=?, trainer_employee_id=?, updated_at=?
       WHERE record_id=?`
    ).run(
      original_client_training_name ?? existing.original_client_training_name,
      finalCompletionDate ?? existing.completion_date,
      source_expiration_date ?? existing.source_expiration_date,
      finalRawValue ?? existing.raw_source_value,
      source ?? existing.source,
      notes ?? existing.notes,
      trainer_employee_id ?? existing.trainer_employee_id,
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
        trainer_employee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', ?, ?, ?, ?, ?, ?)`
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
      trainer_employee_id,
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

const INTERNAL_CLIENT_ID = 'internal-trainers';

// Master Training IDs follow TRN-### and used to be typed in by hand (error-prone, and nothing
// stopped a collision). This finds the highest existing numeric suffix and returns the next
// one, zero-padded to at least 3 digits - non-conforming legacy IDs are simply ignored.
function generateNextTrainingId() {
  const rows = db.prepare("SELECT training_id FROM master_trainings WHERE training_id LIKE 'TRN-%'").all();
  let max = 0;
  for (const r of rows) {
    const m = /^TRN-(\d+)$/.exec(r.training_id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const padded = String(max + 1).padStart(3, '0');
  return `TRN-${padded}`;
}

// Trainers are tracked as employees, but always under the one internal pseudo-client and
// always employee_type = 'trainer' - matching is scoped to both so this can never accidentally
// collide with a same-named trainee at a real client. Matched by PHONE NUMBER (Keeley's call:
// more reliable than name, since two trainers could share a name but not a phone), falling
// back to creating a new profile on first use so trainers don't need to be added ahead of time
// to be linked to their sessions. If a phone match is found under a different name (a typo
// corrected later), the name is refreshed to match - phone is the durable identity here.
function findOrCreateTrainerEmployee(trainerName, trainerPhone) {
  const trimmedName = String(trainerName || '').trim();
  const normalizedPhone = String(trainerPhone || '').replace(/\D/g, '');
  if (!trimmedName && !normalizedPhone) return null;

  const candidates = db
    .prepare(`SELECT * FROM employees WHERE client_id = ? AND employee_type = 'trainer'`)
    .all(INTERNAL_CLIENT_ID);

  if (normalizedPhone) {
    const match = candidates.find((e) => (e.employee_number || '').replace(/\D/g, '') === normalizedPhone);
    if (match) {
      if (trimmedName && match.full_name !== trimmedName) {
        db.prepare('UPDATE employees SET full_name = ? WHERE employee_id = ?').run(trimmedName, match.employee_id);
      }
      return match.employee_id;
    }
  } else if (trimmedName) {
    // No phone to match on (e.g. a CSV import row, or the quick "just a name" add-trainer
    // popup) - fall back to a case-insensitive name match so the same person typed the same
    // way repeatedly (a whole sheet of rows taught by one trainer) resolves to one profile
    // instead of a new duplicate every time.
    const match = candidates.find((e) => (e.full_name || '').trim().toLowerCase() === trimmedName.toLowerCase());
    if (match) return match.employee_id;
  }

  const employee_id = uuidv4();
  db.prepare(
    `INSERT INTO employees (employee_id, client_id, full_name, employee_number, employee_type, active, notes)
     VALUES (?, ?, ?, ?, 'trainer', 1, ?)`
  ).run(
    employee_id,
    INTERNAL_CLIENT_ID,
    trimmedName || 'Unnamed Trainer',
    formatPhoneNumber(trainerPhone) || null,
    'Created automatically from a Training Sessions entry (trainer name/phone).'
  );
  return employee_id;
}

// Groups trainee employees sharing a normalized name or phone number, scoped to one client if
// given (used both by the standalone "review duplicates" screens and by the automatic dedup
// that runs after two clients are merged). Two employees co-grouped by both name and phone
// collapse into one cluster rather than appearing twice.
function clusterKey(ids) {
  return [...ids].sort().join(',');
}

function isClusterIgnored(entityType, ids) {
  return !!db
    .prepare('SELECT 1 FROM duplicate_ignores WHERE entity_type = ? AND member_ids = ?')
    .get(entityType, clusterKey(ids));
}

function ignoreDuplicateCluster(entityType, ids) {
  db.prepare(
    'INSERT OR IGNORE INTO duplicate_ignores (id, entity_type, member_ids, created_at) VALUES (?, ?, ?, ?)'
  ).run(uuidv4(), entityType, clusterKey(ids), new Date().toISOString());
}

function findDuplicateEmployeeClusters({ clientId } = {}) {
  const rows = clientId
    ? db.prepare(`SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.employee_type != 'trainer' AND e.client_id = ?`).all(clientId)
    : db.prepare(`SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.employee_type != 'trainer'`).all();

  const groups = new Map();
  const addToGroup = (key, emp) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(emp);
  };
  for (const e of rows) {
    addToGroup(`name:${e.client_id}:${(e.full_name || '').trim().toLowerCase()}`, e);
    const phoneDigits = (e.employee_number || '').replace(/\D/g, '');
    if (phoneDigits) addToGroup(`phone:${e.client_id}:${phoneDigits}`, e);
  }

  const employeeToCluster = new Map();
  const clusters = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let cluster = null;
    for (const m of members) {
      if (employeeToCluster.has(m.employee_id)) { cluster = employeeToCluster.get(m.employee_id); break; }
    }
    if (!cluster) {
      cluster = [];
      clusters.push(cluster);
    }
    for (const m of members) {
      if (!cluster.find((x) => x.employee_id === m.employee_id)) cluster.push(m);
      employeeToCluster.set(m.employee_id, cluster);
    }
  }
  return clusters
    .filter((c) => c.length > 1)
    .filter((c) => !isClusterIgnored('employee', c.map((e) => e.employee_id)));
}

// Merge one or more duplicate employees into a single "winner." Keeps information from every
// side (Keeley's call): a blank field on the winner is filled in from a loser rather than
// staying blank, before the loser's training records/sign-in links move over and the loser
// row is removed. Nothing on the winner that's already set gets overwritten.
const EMPLOYEE_MERGE_FIELDS = ['employee_number', 'job_title', 'department', 'notes'];
function mergeEmployees(winnerId, loserIds) {
  for (const loserId of loserIds) {
    if (loserId === winnerId) continue;
    const loser = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(loserId);
    if (!loser) continue;
    const winner = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(winnerId);
    if (!winner) continue;

    const fills = {};
    for (const field of EMPLOYEE_MERGE_FIELDS) {
      if (!winner[field] && loser[field]) fills[field] = loser[field];
    }
    // A phone number that conflicts (both sides have one, and they differ) is flagged rather
    // than silently dropped - Keeley's call, since employee_number doubles as the identity
    // field trainers are matched on elsewhere, so losing a number quietly is worse here than
    // for a plain text field.
    if (winner.employee_number && loser.employee_number && winner.employee_number !== loser.employee_number) {
      const flag = `Possible duplicate phone number found during merge: ${loser.employee_number} (kept ${winner.employee_number})`;
      fills.notes = winner.notes ? `${winner.notes}\n${flag}` : flag;
    }
    if (Object.keys(fills).length) {
      const setClause = Object.keys(fills).map((f) => `${f} = ?`).join(', ');
      db.prepare(`UPDATE employees SET ${setClause} WHERE employee_id = ?`).run(...Object.values(fills), winnerId);
    }

    db.prepare('UPDATE employee_training_records SET employee_id = ?, client_id = ? WHERE employee_id = ?').run(winnerId, winner.client_id, loserId);
    db.prepare('UPDATE session_attendees SET employee_id = ? WHERE employee_id = ?').run(winnerId, loserId);
    db.prepare('DELETE FROM employees WHERE employee_id = ?').run(loserId);
  }

  // The merge can leave the winner with two records for the same training (one from each
  // side) - route that through the existing duplicate-record flagging so it surfaces for
  // review on Employee Detail instead of silently picking one as "the" record.
  const trainingIds = db
    .prepare('SELECT DISTINCT training_id FROM employee_training_records WHERE employee_id = ?')
    .all(winnerId)
    .map((r) => r.training_id);
  for (const trainingId of trainingIds) flagDuplicatesIfAny(winnerId, trainingId);
}

// Runs after two clients merge (their employees are now all under one client_id) - picks a
// winner per duplicate cluster automatically (active over inactive, then whoever has more
// training history, then whichever record is older) and merges the rest into it, same
// data-preserving rules as a manual merge.
function dedupeEmployeesForClient(clientId) {
  const clusters = findDuplicateEmployeeClusters({ clientId });
  for (const cluster of clusters) {
    const withCounts = cluster.map((e) => ({
      ...e,
      recordCount: db.prepare('SELECT COUNT(*) AS n FROM employee_training_records WHERE employee_id = ?').get(e.employee_id).n,
    }));
    withCounts.sort((a, b) => (b.active - a.active) || (b.recordCount - a.recordCount));
    const winner = withCounts[0];
    const loserIds = withCounts.slice(1).map((e) => e.employee_id);
    mergeEmployees(winner.employee_id, loserIds);
  }
}

// Runs after two clients merge - sessions that are actually the same real-world event (moved
// under one client_id by the merge) are combined: same date, same trainer, and same training
// type MUST all match (Keeley's rule - no fuzzy matching). Attendees from every duplicate move
// onto one surviving session (preferring one that's already closed, so certificates already
// generated aren't orphaned) and the redundant session rows are removed.
function dedupeSessionsForClient(clientId) {
  const sessions = db.prepare('SELECT * FROM training_sessions WHERE client_id = ?').all(clientId);
  const groups = new Map();
  for (const s of sessions) {
    const trainerKey = s.trainer_employee_id || `${(s.trainer_name || '').trim().toLowerCase()}|${(s.trainer_phone || '').replace(/\D/g, '')}`;
    const key = `${s.session_date}|${trainerKey}|${s.training_type_label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (b.status === 'closed') - (a.status === 'closed') || a.created_at.localeCompare(b.created_at));
    const [survivor, ...duplicates] = group;
    for (const dup of duplicates) {
      db.prepare('UPDATE session_attendees SET session_id = ? WHERE session_id = ?').run(survivor.session_id, dup.session_id);
      if (dup.roster_pdf_path && fs.existsSync(dup.roster_pdf_path)) fs.unlink(dup.roster_pdf_path, () => {});
      db.prepare('DELETE FROM training_sessions WHERE session_id = ?').run(dup.session_id);
    }
  }
}

// Same idea as findDuplicateEmployeeClusters, scoped the other way - only trainer-type
// employees (they all live under the one internal client already, so there's no per-client
// scoping needed). Merging a cluster reuses the exact same mergeEmployees() function -
// trainers are employees under the hood, nothing trainer-specific about a merge.
function findDuplicateTrainerClusters() {
  const rows = db.prepare(`SELECT * FROM employees WHERE client_id = ? AND employee_type = 'trainer'`).all(INTERNAL_CLIENT_ID);

  const groups = new Map();
  const addToGroup = (key, emp) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(emp);
  };
  for (const e of rows) {
    addToGroup(`name:${(e.full_name || '').trim().toLowerCase()}`, e);
    const phoneDigits = (e.employee_number || '').replace(/\D/g, '');
    if (phoneDigits) addToGroup(`phone:${phoneDigits}`, e);
  }

  const trainerToCluster = new Map();
  const clusters = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let cluster = null;
    for (const m of members) {
      if (trainerToCluster.has(m.employee_id)) { cluster = trainerToCluster.get(m.employee_id); break; }
    }
    if (!cluster) {
      cluster = [];
      clusters.push(cluster);
    }
    for (const m of members) {
      if (!cluster.find((x) => x.employee_id === m.employee_id)) cluster.push(m);
      trainerToCluster.set(m.employee_id, cluster);
    }
  }
  return clusters
    .filter((c) => c.length > 1)
    .filter((c) => !isClusterIgnored('trainer', c.map((e) => e.employee_id)));
}

// Groups real (non-internal) clients sharing a normalized name - simpler than the employee
// version since there's no phone number to also match on for clients.
function findDuplicateClientClusters() {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.client_id AND e.active = 1) AS employee_count
       FROM clients c WHERE c.is_internal = 0`
    )
    .all();
  const groups = new Map();
  for (const c of rows) {
    const key = (c.client_name || '').trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return Array.from(groups.values())
    .filter((g) => g.length > 1)
    .filter((g) => !isClusterIgnored('client', g.map((c) => c.client_id)));
}

// Merge one or more duplicate clients into a single "winner" - every employee, training
// record, requirement override, session, and import batch moves over (nothing deleted, notes
// backfilled the same way employee merges preserve data from both sides), then the newly-
// unified client is swept for employees and sessions that are now duplicates of each other as
// a direct result of the merge (Keeley's rule) and those are auto-merged too.
function mergeClients(winnerId, loserIds) {
  for (const loserId of loserIds) {
    if (loserId === winnerId) continue;
    const loser = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(loserId);
    if (!loser) continue;
    const winner = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(winnerId);
    if (!winner) continue;

    if (!winner.notes && loser.notes) {
      db.prepare('UPDATE clients SET notes = ? WHERE client_id = ?').run(loser.notes, winnerId);
    }

    db.prepare('UPDATE employees SET client_id = ? WHERE client_id = ?').run(winnerId, loserId);
    db.prepare('UPDATE employee_training_records SET client_id = ? WHERE client_id = ?').run(winnerId, loserId);
    db.prepare('UPDATE training_sessions SET client_id = ? WHERE client_id = ?').run(winnerId, loserId);
    db.prepare('UPDATE import_batches SET client_id = ? WHERE client_id = ?').run(winnerId, loserId);

    // client_training_requirements has a UNIQUE(client_id, training_id) constraint - if the
    // winner already has its own override for a training the loser also overrode, the
    // winner's own setting wins and the loser's duplicate row is dropped rather than moved.
    const loserRequirements = db.prepare('SELECT * FROM client_training_requirements WHERE client_id = ?').all(loserId);
    for (const req of loserRequirements) {
      const clash = db.prepare('SELECT 1 FROM client_training_requirements WHERE client_id = ? AND training_id = ?').get(winnerId, req.training_id);
      if (clash) {
        db.prepare('DELETE FROM client_training_requirements WHERE requirement_id = ?').run(req.requirement_id);
      } else {
        db.prepare('UPDATE client_training_requirements SET client_id = ? WHERE requirement_id = ?').run(winnerId, req.requirement_id);
      }
    }

    db.prepare('DELETE FROM clients WHERE client_id = ?').run(loserId);
  }

  dedupeEmployeesForClient(winnerId);
  dedupeSessionsForClient(winnerId);
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
  generateNextTrainingId,
  findOrCreateTrainerEmployee,
  INTERNAL_CLIENT_ID,
  findDuplicateEmployeeClusters,
  mergeEmployees,
  dedupeEmployeesForClient,
  dedupeSessionsForClient,
  mergeClients,
  findDuplicateClientClusters,
  findDuplicateTrainerClusters,
  ignoreDuplicateCluster,
};
