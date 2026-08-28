const fs = require('fs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('../lib/repo');
const { computeStatus } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { INTERNAL_CLIENT_ID } = require('../lib/repo');

const router = express.Router();

// Trainers live under the internal pseudo-client and are managed from their own dedicated
// Trainers page (server/routes/trainers.js) - they're excluded here so they never show up in
// the regular Clients->Employees browsing flow, Matrix filter dropdowns, or search.
router.get('/', async (req, res) => {
  const { client_id, department, job_title, search, activeOnly } = req.query;
  const clauses = [`employee_type != 'trainer'`];
  const params = [];
  if (client_id) { clauses.push('client_id = ?'); params.push(client_id); }
  if (department) { clauses.push('department = ?'); params.push(department); }
  if (job_title) { clauses.push('job_title = ?'); params.push(job_title); }
  if (search) { clauses.push('LOWER(full_name) LIKE ?'); params.push(`%${search.toLowerCase()}%`); }
  if (activeOnly === 'true') { clauses.push('active = 1'); }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = await dbAll(`SELECT * FROM employees ${where} ORDER BY full_name ASC`, params);
  res.json(rows);
});

// Distinct department/job title lists, used to populate matrix filter dropdowns (spec section 8).
router.get('/facets/list', async (req, res) => {
  const { client_id } = req.query;
  const clauses = [`employee_type != 'trainer'`];
  const params = [];
  if (client_id) { clauses.push('client_id = ?'); params.push(client_id); }
  const base = clauses.join(' AND ');
  const departments = (await dbAll(
    `SELECT DISTINCT department FROM employees WHERE ${base} AND department IS NOT NULL AND department != '' ORDER BY department`,
    params
  )).map((r) => r.department);
  const jobTitles = (await dbAll(
    `SELECT DISTINCT job_title FROM employees WHERE ${base} AND job_title IS NOT NULL AND job_title != '' ORDER BY job_title`,
    params
  )).map((r) => r.job_title);
  res.json({ departments, jobTitles });
});

// Possible-duplicate detection (Keeley's request): groups of trainee employees, scoped to the
// same client, that share either a normalized name or a normalized phone number. Registered
// before /:id so the literal path "duplicates" doesn't get swallowed by the :id param route.
router.get('/duplicates', async (req, res) => {
  res.json(await repo.findDuplicateEmployeeClusters());
});

// Merge one or more duplicate employee records into a single "winner" - keeps information
// from every side (a blank field on the winner is filled in from a loser), reassigns training
// records and sign-in-roster links, then removes the now-empty duplicate rows.
router.post('/merge', requireAdmin, async (req, res) => {
  const { winner_id, loser_ids } = req.body || {};
  if (!winner_id || !Array.isArray(loser_ids) || loser_ids.length === 0) {
    return res.status(400).json({ error: 'winner_id and a non-empty loser_ids array are required' });
  }
  const winner = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [winner_id]);
  if (!winner) return res.status(404).json({ error: 'Winner employee not found' });

  await repo.mergeEmployees(winner_id, loser_ids);
  res.json(await dbGet('SELECT * FROM employees WHERE employee_id = ?', [winner_id]));
});

// Dismiss a possible-duplicate grouping without merging (Keeley's request) - e.g. two
// employees who really do share a name/phone but aren't the same person. Only affects that
// exact grouping; a differently-shaped grouping involving one of these employees later would
// still be flagged.
router.post('/duplicates/ignore', requireAdmin, async (req, res) => {
  const { member_ids } = req.body || {};
  if (!Array.isArray(member_ids) || member_ids.length < 2) {
    return res.status(400).json({ error: 'member_ids must be an array of at least 2 employee ids' });
  }
  await repo.ignoreDuplicateCluster('employee', member_ids);
  res.json({ ok: true });
});

router.get('/:id', async (req, res) => {
  const row = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Employee not found' });
  res.json(row);
});

// Employee Detail Page (spec section 9): all 52 (or however many active) Master Trainings
// with this employee's corresponding record, status, and original client wording.
router.get('/:id/full-detail', async (req, res) => {
  const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [req.params.id]);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const client = await dbGet('SELECT * FROM clients WHERE client_id = ?', [employee.client_id]);
  const masterTrainings = await repo.listMasterTrainings({ activeOnly: true });
  const trainings = await Promise.all(masterTrainings.map(async (mt) => {
    const { requirement, record, status, expirationDate } = await repo.computeCell({
      employeeId: employee.employee_id,
      clientId: employee.client_id,
      trainingId: mt.training_id,
      masterTraining: mt,
    });
    return {
      training_id: mt.training_id,
      training_name: requirement?.client_training_name || mt.training_name,
      master_training_name: mt.training_name,
      category: mt.category,
      training_type: mt.training_type,
      requirement_status: requirement ? requirement.requirement_status : 'Not Required',
      original_client_training_name: record ? record.original_client_training_name : null,
      completion_date: record ? record.completion_date : null,
      expiration_date: expirationDate,
      status,
      expiring_soon: await repo.isExpiringSoon(status, expirationDate),
      notes: record ? record.notes : null,
      record_id: record ? record.record_id : null,
      duplicate_status: record ? record.duplicate_status : 'none',
      certificate_filename: record ? record.certificate_filename : null,
      trainer_employee_id: record ? record.trainer_employee_id : null,
      // Only records created by closing out a sign-in session have a captured signature - one
      // manually entered via "Record Training Completion" or brought in by CSV import has none.
      signature: record
        ? (await dbGet('SELECT signature FROM session_attendees WHERE training_record_id = ? ORDER BY signed_at DESC LIMIT 1', [record.record_id]))?.signature || null
        : null,
    };
  }));

  // Every completed record on file, not just the one "latest" one per training type (Keeley's
  // request: nothing should ever look overridden - a training taken more than once, e.g. Day
  // 1/Day 2 of a multi-day course or a later re-cert, needs its own row every time). The stat
  // tiles above and the Matrix/Dashboard still use the single-cell-per-type view above, since
  // compliance status is inherently "per training type," but this list is the actual history.
  const completedRecordsRaw = await dbAll(
    `SELECT r.*, mt.training_name AS master_training_name
     FROM employee_training_records r
     JOIN master_trainings mt ON mt.training_id = r.training_id
     WHERE r.employee_id = ? AND r.is_inactive = 0 AND r.completion_date IS NOT NULL
     ORDER BY r.completion_date DESC, r.insert_seq DESC`,
    [employee.employee_id]
  );
  const completedRecords = await Promise.all(completedRecordsRaw.map(async (r) => {
    const requirement = await repo.getRequirement(employee.client_id, r.training_id);
    const masterTraining = await repo.getMasterTraining(r.training_id);
    // Status/expiration are recomputed live here (Keeley's report, 2026-08-26: this table
    // was showing r.status/r.expiration_date straight off the DB row, frozen at whatever
    // they were the last time the record was written - so a training that's genuinely
    // expired by now kept showing its old status forever, unlike the stat tiles above
    // which already recompute live via computeCell). Same computeStatus() every other page
    // uses, just applied to every historical record here instead of only the latest one.
    const { status, expirationDate } = computeStatus({ record: r, requirement, masterTraining });
    return {
      training_id: r.training_id,
      training_name: requirement?.client_training_name || r.master_training_name,
      master_training_name: r.master_training_name,
      original_client_training_name: r.original_client_training_name,
      completion_date: r.completion_date,
      expiration_date: expirationDate,
      status,
      expiring_soon: await repo.isExpiringSoon(status, expirationDate),
      notes: r.notes,
      record_id: r.record_id,
      certificate_filename: r.certificate_filename,
      trainer_employee_id: r.trainer_employee_id,
      signature: (await dbGet('SELECT signature FROM session_attendees WHERE training_record_id = ? ORDER BY signed_at DESC LIMIT 1', [r.record_id]))?.signature || null,
    };
  }));

  // Aggregate feedback rating for a trainer's own profile page (Keeley's request) - across
  // every session they taught, not just their most recent one. Only meaningful for trainers,
  // so it's skipped entirely for a regular trainee.
  let trainerFeedbackSummary = null;
  if (employee.employee_type === 'trainer') {
    const agg = await dbGet(
      `SELECT AVG(sf.trainer_rating) AS avg_trainer_rating, AVG(sf.effectiveness_rating) AS avg_effectiveness_rating, COUNT(*) AS response_count
       FROM session_feedback sf
       JOIN training_sessions ts ON ts.session_id = sf.session_id
       WHERE ts.trainer_employee_id = ?`,
      [employee.employee_id]
    );
    trainerFeedbackSummary = {
      avg_trainer_rating: agg.response_count > 0 ? agg.avg_trainer_rating : null,
      avg_effectiveness_rating: agg.response_count > 0 ? agg.avg_effectiveness_rating : null,
      response_count: agg.response_count,
    };
  }

  res.json({ employee, client, trainings, completedRecords, trainerFeedbackSummary });
});

// Trainer profiles are created via the dedicated /api/trainers route, not here - this route
// stays for regular client employees (employee_type defaults to 'trainee'). Both routes share
// this one invariant check so a trainer can never end up under a real client, and a trainee
// can never end up under the internal Trainers pseudo-client.
function assertClientTypeInvariant(clientId, employeeType) {
  const isInternal = clientId === INTERNAL_CLIENT_ID;
  const isTrainer = employeeType === 'trainer';
  if (isInternal !== isTrainer) {
    throw new Error(
      isInternal
        ? 'The internal Trainers profile can only hold trainer-type employees.'
        : 'Only the internal Trainers profile can hold trainer-type employees.'
    );
  }
}

router.post('/', requireAdmin, async (req, res) => {
  const {
    client_id, employee_number = null, full_name, job_title = null, department = null, active = 1, notes = null,
    employee_type = 'trainee',
  } = req.body;
  if (!client_id || !full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'client_id and full_name are required' });
  }
  if (employee_number && !isValidPhoneNumber(employee_number)) {
    return res.status(400).json({ error: 'employee_number must be a standard 10-digit phone number' });
  }
  const client = await dbGet('SELECT client_id FROM clients WHERE client_id = ?', [client_id]);
  if (!client) return res.status(400).json({ error: 'client_id does not exist' });
  try {
    assertClientTypeInvariant(client_id, employee_type);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const employee_id = uuidv4();
  await dbRun(
    `INSERT INTO employees (employee_id, client_id, employee_number, full_name, job_title, department, active, notes, employee_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [employee_id, client_id, formatPhoneNumber(employee_number), full_name.trim(), job_title, department, active ? 1 : 0, notes, employee_type]
  );
  res.status(201).json(await dbGet('SELECT * FROM employees WHERE employee_id = ?', [employee_id]));
});

router.put('/:id', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });
  const merged = { ...existing, ...req.body };
  try {
    assertClientTypeInvariant(merged.client_id, merged.employee_type);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (merged.employee_number && !isValidPhoneNumber(merged.employee_number)) {
    return res.status(400).json({ error: 'employee_number must be a standard 10-digit phone number' });
  }
  await dbRun(
    `UPDATE employees SET employee_number=?, full_name=?, job_title=?, department=?, active=?, notes=? WHERE employee_id=?`,
    [formatPhoneNumber(merged.employee_number), merged.full_name, merged.job_title, merged.department, merged.active ? 1 : 0, merged.notes, req.params.id]
  );
  res.json(await dbGet('SELECT * FROM employees WHERE employee_id = ?', [req.params.id]));
});

// Permanently delete an employee created by mistake (Keeley's request). Their training
// records cascade-delete via the existing FK; certificate files on disk don't, so they're
// unlinked first. session_attendees.employee_id has no ON DELETE clause (defaults to
// restrict), so any sign-in rows pointing at this employee are detached (set to NULL) first -
// the sign-in record itself stays on the roster, just no longer linked to a profile.
router.delete('/:id', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const certs = await dbAll(
    'SELECT certificate_path FROM employee_training_records WHERE employee_id = ? AND certificate_path IS NOT NULL',
    [req.params.id]
  );
  for (const { certificate_path } of certs) {
    if (certificate_path && fs.existsSync(certificate_path)) fs.unlink(certificate_path, () => {});
  }

  // session_attendees.training_record_id also restricts deletion of the records it points to -
  // detach those too, since this employee's records are about to cascade-delete with them.
  await dbRun(
    `UPDATE session_attendees SET training_record_id = NULL
     WHERE training_record_id IN (SELECT record_id FROM employee_training_records WHERE employee_id = ?)`,
    [req.params.id]
  );
  await dbRun('UPDATE session_attendees SET employee_id = NULL WHERE employee_id = ?', [req.params.id]);
  await dbRun('DELETE FROM employees WHERE employee_id = ?', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
