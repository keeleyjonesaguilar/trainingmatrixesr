// Shared data-access helpers used across routes, so the matrix/dashboard/detail pages all
// read status the exact same way (single source of truth, per statusEngine.js).
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { computeStatus, parseSourceValue } = require('./statusEngine');

async function listMasterTrainings({ activeOnly = false } = {}) {
  const sql = `SELECT * FROM master_trainings ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY display_order ASC`;
  return dbAll(sql);
}

async function getMasterTraining(trainingId) {
  return dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [trainingId]);
}

async function getRequirement(clientId, trainingId) {
  return dbGet('SELECT * FROM client_training_requirements WHERE client_id = ? AND training_id = ?', [clientId, trainingId]);
}

async function listRequirementsForClient(clientId) {
  return dbAll('SELECT * FROM client_training_requirements WHERE client_id = ?', [clientId]);
}

async function getLatestRecord(employeeId, trainingId) {
  // If multiple records exist for the same employee+training (duplicates preserved per spec
  // section 12/15), only the active one(s) drive the live status; a record that's been
  // superseded during duplicate resolution (is_active_record = 0) stays in the table for
  // history but is excluded here. is_inactive = 0 excludes soft-deleted records the same way -
  // treated as if they don't exist for compliance purposes, but never physically deleted. The
  // most recently completed active record wins. insert_seq (a Postgres-only surrogate for
  // SQLite's old implicit rowid) breaks ties by insertion order.
  return dbGet(
    `SELECT * FROM employee_training_records
     WHERE employee_id = ? AND training_id = ? AND is_active_record = 1 AND is_inactive = 0
     ORDER BY (completion_date IS NULL), completion_date DESC, insert_seq DESC
     LIMIT 1`,
    [employeeId, trainingId]
  );
}

async function listRecordsForEmployee(employeeId, trainingId) {
  return dbAll(
    `SELECT * FROM employee_training_records WHERE employee_id = ? AND training_id = ? ORDER BY insert_seq DESC`,
    [employeeId, trainingId]
  );
}

// Permanently-ignored employee+training gaps (Keeley's request) - deliberately NOT a parameter
// on computeStatus() itself, which stays a pure function of record/requirement/masterTraining
// with no schema impact. Applied here as a post-processing step, after computeStatus already
// returned, so it never touches employee_training_records.status's CHECK constraint and never
// gets persisted by recomputeAndPersistRecord (which always writes the "true" computed status -
// the ignore is a fresh, read-time-only override, so a real new completion naturally overrides
// it right back without any extra logic).
async function isGapIgnored(employeeId, trainingId) {
  return !!(await dbGet('SELECT 1 FROM ignored_compliance_gaps WHERE employee_id = ? AND training_id = ?', [employeeId, trainingId]));
}

async function ignoreComplianceGap(employeeId, trainingId, ignoredBy) {
  await dbRun(
    'INSERT INTO ignored_compliance_gaps (id, employee_id, training_id, ignored_at, ignored_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (employee_id, training_id) DO NOTHING',
    [uuidv4(), employeeId, trainingId, new Date().toISOString(), ignoredBy || null]
  );
}

async function computeCell({ employeeId, clientId, trainingId, masterTraining, today }) {
  const requirement = await getRequirement(clientId, trainingId);
  const record = await getLatestRecord(employeeId, trainingId);
  const mt = masterTraining || (await getMasterTraining(trainingId));
  let { status, expirationDate } = computeStatus({ record, requirement, masterTraining: mt, today });
  if ((status === 'Expired' || status === 'Missing' || status === 'Pending Review') && (await isGapIgnored(employeeId, trainingId))) {
    status = 'Ignored';
  }
  return { requirement, record, status, expirationDate, masterTraining: mt };
}

async function recomputeAndPersistRecord(recordId, { today } = {}) {
  const record = await dbGet('SELECT * FROM employee_training_records WHERE record_id = ?', [recordId]);
  if (!record) return null;
  const masterTraining = await getMasterTraining(record.training_id);
  const requirement = await getRequirement(record.client_id, record.training_id);
  const { status, expirationDate } = computeStatus({ record, requirement, masterTraining, today });
  await dbRun('UPDATE employee_training_records SET status = ?, expiration_date = ? WHERE record_id = ?', [
    status,
    expirationDate,
    recordId,
  ]);
  return { ...record, status, expiration_date: expirationDate };
}

async function recomputeAllForClientTraining(clientId, trainingId, effectiveDate) {
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
  const rows = await dbAll(`SELECT record_id FROM employee_training_records WHERE ${clauses.join(' AND ')}`, params);
  for (const r of rows) await recomputeAndPersistRecord(r.record_id);
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
async function saveTrainingRecord(opts) {
  // Distinguishes "field not sent at all" (keep whatever's on the existing record) from
  // "explicitly sent as null" (clear it) for trainer_employee_id specifically - needed so
  // picking "No trainer on file" in the Employee Detail edit form can actually remove a trainer,
  // not just leave the old one in place (the ?? fallback below on every other field only ever
  // sees explicit values from its callers today, so this distinction hasn't mattered for them).
  const trainerProvided = 'trainer_employee_id' in opts;
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
  const masterTraining = await getMasterTraining(training_id);
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
  const existing = record_id ? await dbGet('SELECT * FROM employee_training_records WHERE record_id = ?', [record_id]) : null;
  const now = new Date().toISOString();

  if (existing) {
    // training_id is always resent (it's required on every call, same as client_id/employee_id)
    // rather than defaulted from `existing` - lets an admin correct a wrongly-matched training
    // after the fact (Keeley's request, 2026-09-01: fixing a bad import match shouldn't mean
    // delete-and-recreate). original_training_name is a snapshot of the catalog name at save
    // time, so it's refreshed here too - otherwise it'd keep showing the training this record
    // used to be, not the corrected one.
    await dbRun(
      `UPDATE employee_training_records
       SET training_id=?, original_training_name=?, original_client_training_name=?, completion_date=?, source_expiration_date=?, raw_source_value=?, source=?, notes=?, trainer_employee_id=?, updated_at=?
       WHERE record_id=?`,
      [
        training_id,
        masterTraining.training_name,
        original_client_training_name ?? existing.original_client_training_name,
        finalCompletionDate ?? existing.completion_date,
        source_expiration_date ?? existing.source_expiration_date,
        finalRawValue ?? existing.raw_source_value,
        source ?? existing.source,
        notes ?? existing.notes,
        trainerProvided ? trainer_employee_id : existing.trainer_employee_id,
        now,
        id,
      ]
    );
  } else {
    // Multiple completions of the same training are expected and never flagged (Keeley's
    // call) - a re-cert, or a multi-day course logged as separate Day 1/Day 2 entries, is
    // normal history, not a mistake to review. Every record just gets its own row, always.
    await dbRun(
      `INSERT INTO employee_training_records
       (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
        completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes,
        trainer_employee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', ?, ?, ?, ?, ?, ?)`,
      [
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
        now,
      ]
    );
  }

  return recomputeAndPersistRecord(id);
}

// Attaches a certificate file that was generated/uploaded outside the normal multer upload
// route (e.g. a Training Sign-In certificate PDF generated at session close-out) to a record.
async function attachCertificateFile(recordId, { filename, filePath }) {
  const now = new Date().toISOString();
  await dbRun(
    `UPDATE employee_training_records
     SET certificate_filename = ?, certificate_path = ?, certificate_uploaded_at = ?, updated_at = ?
     WHERE record_id = ?`,
    [filename, filePath, now, now, recordId]
  );
}

// Used when creating a Training Sign-In session: the admin just types a client name (same as
// before the merge), and it resolves to a real client_id - creating the client if this is its
// first session - rather than requiring them to first go add the client on the Clients page.
async function findOrCreateClientByName(clientName) {
  const trimmed = String(clientName || '').trim();
  if (!trimmed) throw new Error('client_name is required');
  const existing = await dbGet('SELECT * FROM clients WHERE LOWER(client_name) = LOWER(?)', [trimmed]);
  if (existing) return existing.client_id;
  const client_id = uuidv4();
  await dbRun('INSERT INTO clients (client_id, client_name, active) VALUES (?, ?, 1)', [client_id, trimmed]);
  return client_id;
}

const INTERNAL_CLIENT_ID = 'internal-trainers';

// Master Training IDs follow TRN-### and used to be typed in by hand (error-prone, and nothing
// stopped a collision). This finds the highest existing numeric suffix and returns the next
// one, zero-padded to at least 3 digits - non-conforming legacy IDs are simply ignored.
async function generateNextTrainingId() {
  const rows = await dbAll("SELECT training_id FROM master_trainings WHERE training_id LIKE 'TRN-%'");
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
// collide with a same-named trainee at a real client. Matched by EMPLOYEE ID (Keeley's call:
// more reliable than name, since two trainers could share a name but not an ID), falling
// back to creating a new profile on first use so trainers don't need to be added ahead of time
// to be linked to their sessions. If an ID match is found under a different name (a typo
// corrected later), the name is refreshed to match - ID is the durable identity here.
async function findOrCreateTrainerEmployee(trainerName, trainerId) {
  const trimmedName = String(trainerName || '').trim();
  const normalizedId = String(trainerId || '').trim().toLowerCase();
  if (!trimmedName && !normalizedId) return null;

  const candidates = await dbAll(`SELECT * FROM employees WHERE client_id = ? AND employee_type = 'trainer'`, [INTERNAL_CLIENT_ID]);

  if (normalizedId) {
    const match = candidates.find((e) => (e.employee_number || '').trim().toLowerCase() === normalizedId);
    if (match) {
      if (trimmedName && match.full_name !== trimmedName) {
        await dbRun('UPDATE employees SET full_name = ? WHERE employee_id = ?', [trimmedName, match.employee_id]);
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
  await dbRun(
    `INSERT INTO employees (employee_id, client_id, full_name, employee_number, employee_type, active, notes)
     VALUES (?, ?, ?, ?, 'trainer', 1, ?)`,
    [
      employee_id,
      INTERNAL_CLIENT_ID,
      trimmedName || 'Unnamed Trainer',
      trainerId ? String(trainerId).trim() : null,
      'Created automatically from a Training Sessions entry (trainer name/Employee ID).',
    ]
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

async function isClusterIgnored(entityType, ids) {
  return !!(await dbGet('SELECT 1 FROM duplicate_ignores WHERE entity_type = ? AND member_ids = ?', [entityType, clusterKey(ids)]));
}

async function ignoreDuplicateCluster(entityType, ids) {
  await dbRun(
    'INSERT INTO duplicate_ignores (id, entity_type, member_ids, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (entity_type, member_ids) DO NOTHING',
    [uuidv4(), entityType, clusterKey(ids), new Date().toISOString()]
  );
}

async function findDuplicateEmployeeClusters({ clientId } = {}) {
  const rows = clientId
    ? await dbAll(`SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.employee_type != 'trainer' AND e.client_id = ?`, [clientId])
    : await dbAll(`SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.employee_type != 'trainer'`);

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

  const candidates = clusters.filter((c) => c.length > 1);
  const result = [];
  for (const c of candidates) {
    if (!(await isClusterIgnored('employee', c.map((e) => e.employee_id)))) result.push(c);
  }
  return result;
}

// Merge one or more duplicate employees into a single "winner." Keeps information from every
// side (Keeley's call): a blank field on the winner is filled in from a loser rather than
// staying blank, before the loser's training records/sign-in links move over and the loser
// row is removed. Nothing on the winner that's already set gets overwritten.
const EMPLOYEE_MERGE_FIELDS = ['employee_number', 'job_title', 'department', 'notes'];
async function mergeEmployees(winnerId, loserIds) {
  for (const loserId of loserIds) {
    if (loserId === winnerId) continue;
    const loser = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [loserId]);
    if (!loser) continue;
    const winner = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [winnerId]);
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
      await dbRun(`UPDATE employees SET ${setClause} WHERE employee_id = ?`, [...Object.values(fills), winnerId]);
    }

    await dbRun('UPDATE employee_training_records SET employee_id = ?, client_id = ? WHERE employee_id = ?', [winnerId, winner.client_id, loserId]);
    await dbRun('UPDATE session_attendees SET employee_id = ? WHERE employee_id = ?', [winnerId, loserId]);
    await dbRun('DELETE FROM employees WHERE employee_id = ?', [loserId]);
  }

  // The merge can leave the winner with two records for the same training (one from each
  // side) - that's fine, every completion just shows as its own row (Keeley's call, no more
  // flagging multiple completions of the same training as something needing review).
}

// Runs after two clients merge (their employees are now all under one client_id) - picks a
// winner per duplicate cluster automatically (active over inactive, then whoever has more
// training history, then whichever record is older) and merges the rest into it, same
// data-preserving rules as a manual merge.
async function dedupeEmployeesForClient(clientId) {
  const clusters = await findDuplicateEmployeeClusters({ clientId });
  for (const cluster of clusters) {
    const withCounts = await Promise.all(
      cluster.map(async (e) => ({
        ...e,
        recordCount: (await dbGet('SELECT COUNT(*) AS n FROM employee_training_records WHERE employee_id = ?', [e.employee_id])).n,
      }))
    );
    withCounts.sort((a, b) => (b.active - a.active) || (b.recordCount - a.recordCount));
    const winner = withCounts[0];
    const loserIds = withCounts.slice(1).map((e) => e.employee_id);
    await mergeEmployees(winner.employee_id, loserIds);
  }
}

// Runs after two clients merge - sessions that are actually the same real-world event (moved
// under one client_id by the merge) are combined: same date, same trainer, and same training
// type MUST all match (Keeley's rule - no fuzzy matching). Attendees from every duplicate move
// onto one surviving session (preferring one that's already closed, so certificates already
// generated aren't orphaned) and the redundant session rows are removed.
async function dedupeSessionsForClient(clientId) {
  const sessions = await dbAll('SELECT * FROM training_sessions WHERE client_id = ?', [clientId]);
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
      await dbRun('UPDATE session_attendees SET session_id = ? WHERE session_id = ?', [survivor.session_id, dup.session_id]);
      if (dup.roster_pdf_path && fs.existsSync(dup.roster_pdf_path)) fs.unlink(dup.roster_pdf_path, () => {});
      await dbRun('DELETE FROM training_sessions WHERE session_id = ?', [dup.session_id]);
    }
  }
}

// Same idea as findDuplicateEmployeeClusters, scoped the other way - only trainer-type
// employees (they all live under the one internal client already, so there's no per-client
// scoping needed). Merging a cluster reuses the exact same mergeEmployees() function -
// trainers are employees under the hood, nothing trainer-specific about a merge.
async function findDuplicateTrainerClusters() {
  const rows = await dbAll(`SELECT * FROM employees WHERE client_id = ? AND employee_type = 'trainer'`, [INTERNAL_CLIENT_ID]);

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

  const candidates = clusters.filter((c) => c.length > 1);
  const result = [];
  for (const c of candidates) {
    if (!(await isClusterIgnored('trainer', c.map((e) => e.employee_id)))) result.push(c);
  }
  return result;
}

// Groups real (non-internal) clients sharing a normalized name - simpler than the employee
// version since there's no phone number to also match on for clients.
async function findDuplicateClientClusters() {
  const rows = await dbAll(
    `SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.client_id AND e.active = 1) AS employee_count
     FROM clients c WHERE c.is_internal = 0`
  );
  const groups = new Map();
  for (const c of rows) {
    const key = (c.client_name || '').trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const candidates = Array.from(groups.values()).filter((g) => g.length > 1);
  const result = [];
  for (const g of candidates) {
    if (!(await isClusterIgnored('client', g.map((c) => c.client_id)))) result.push(g);
  }
  return result;
}

// Merge one or more duplicate clients into a single "winner" - every employee, training
// record, requirement override, session, and import batch moves over (nothing deleted, notes
// backfilled the same way employee merges preserve data from both sides), then the newly-
// unified client is swept for employees and sessions that are now duplicates of each other as
// a direct result of the merge (Keeley's rule) and those are auto-merged too.
async function mergeClients(winnerId, loserIds) {
  for (const loserId of loserIds) {
    if (loserId === winnerId) continue;
    const loser = await dbGet('SELECT * FROM clients WHERE client_id = ?', [loserId]);
    if (!loser) continue;
    const winner = await dbGet('SELECT * FROM clients WHERE client_id = ?', [winnerId]);
    if (!winner) continue;

    if (!winner.notes && loser.notes) {
      await dbRun('UPDATE clients SET notes = ? WHERE client_id = ?', [loser.notes, winnerId]);
    }

    await dbRun('UPDATE employees SET client_id = ? WHERE client_id = ?', [winnerId, loserId]);
    await dbRun('UPDATE employee_training_records SET client_id = ? WHERE client_id = ?', [winnerId, loserId]);
    await dbRun('UPDATE training_sessions SET client_id = ? WHERE client_id = ?', [winnerId, loserId]);
    await dbRun('UPDATE import_batches SET client_id = ? WHERE client_id = ?', [winnerId, loserId]);

    // client_training_requirements has a UNIQUE(client_id, training_id) constraint - if the
    // winner already has its own override for a training the loser also overrode, the
    // winner's own setting wins and the loser's duplicate row is dropped rather than moved.
    const loserRequirements = await dbAll('SELECT * FROM client_training_requirements WHERE client_id = ?', [loserId]);
    for (const req of loserRequirements) {
      const clash = await dbGet('SELECT 1 FROM client_training_requirements WHERE client_id = ? AND training_id = ?', [winnerId, req.training_id]);
      if (clash) {
        await dbRun('DELETE FROM client_training_requirements WHERE requirement_id = ?', [req.requirement_id]);
      } else {
        await dbRun('UPDATE client_training_requirements SET client_id = ? WHERE requirement_id = ?', [winnerId, req.requirement_id]);
      }
    }

    await dbRun('DELETE FROM clients WHERE client_id = ?', [loserId]);
  }

  await dedupeEmployeesForClient(winnerId);
  await dedupeSessionsForClient(winnerId);
}

module.exports = {
  listMasterTrainings,
  getMasterTraining,
  getRequirement,
  listRequirementsForClient,
  getLatestRecord,
  isGapIgnored,
  ignoreComplianceGap,
  listRecordsForEmployee,
  computeCell,
  recomputeAndPersistRecord,
  recomputeAllForClientTraining,
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
