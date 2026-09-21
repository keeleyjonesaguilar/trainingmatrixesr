// Trainers directory - deliberately separate from /api/employees (which excludes trainer-type
// rows) so trainers are browsed/managed on their own dedicated page, never mixed into a real
// client's roster or the org-wide employee list.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const repo = require('../lib/repo');
const { INTERNAL_CLIENT_ID } = require('../lib/repo');
const { logActivity } = require('../lib/activityLog');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');

const router = express.Router();

// Registered before the (nonexistent, but keeping the convention) generic routes so
// "duplicates" is never mistaken for anything else.
router.get('/duplicates', async (req, res) => {
  res.json(await repo.findDuplicateTrainerClusters());
});

// Dismiss a possible-duplicate grouping without merging (Keeley's request) - e.g. two
// trainers who really do share a name/phone but aren't the same person.
router.post('/duplicates/ignore', requireAdmin, async (req, res) => {
  const { member_ids } = req.body || {};
  if (!Array.isArray(member_ids) || member_ids.length < 2) {
    return res.status(400).json({ error: 'member_ids must be an array of at least 2 trainer ids' });
  }
  await repo.ignoreDuplicateCluster('trainer', member_ids);
  res.json({ ok: true });
});

// Trainer profiles that share a name/phone with a real employee elsewhere in the system
// (Keeley's request, 2026-09-21) - the actual merge reuses POST /api/employees/merge (already
// type-agnostic; see server/lib/repo.js's mergeEmployees), this just surfaces the pairing.
router.get('/cross-matches', async (req, res) => {
  res.json(await repo.findTrainerEmployeeCrossMatches());
});

router.post('/cross-matches/ignore', requireAdmin, async (req, res) => {
  const { trainer_id, employee_id } = req.body || {};
  if (!trainer_id || !employee_id) {
    return res.status(400).json({ error: 'trainer_id and employee_id are required' });
  }
  await repo.ignoreDuplicateCluster('trainer_employee', [trainer_id, employee_id]);
  res.json({ ok: true });
});

// A "trainer" here means anyone who trains, not only a standalone trainer-type profile under
// the internal client (Keeley's request, 2026-09-21) - a real employee who's ever taught a
// session (most often after being merged with what used to be their own separate trainer
// profile) still belongs on this page, under their real client, with their own completed-
// trainings history intact.
router.get('/', async (req, res) => {
  const rows = await dbAll(
    `SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id
     WHERE (e.client_id = ? AND e.employee_type = 'trainer')
        OR e.employee_id IN (SELECT DISTINCT trainer_employee_id FROM training_sessions WHERE trainer_employee_id IS NOT NULL)
     ORDER BY e.full_name ASC`,
    [INTERNAL_CLIENT_ID]
  );
  res.json(rows);
});

// Trainers are identified by phone number, same as a regular employee (Keeley's call,
// 2026-09-18: trainer and employee IDs are both phone numbers now) - stored on the same
// employee_number column, validated/formatted the same way as server/routes/employees.js's
// POST /.
//
// Open to the plain 'user' role too (Keeley's request, 2026-09-16) - see the matching note on
// server/routes/clients.js's POST /.
router.post('/', async (req, res) => {
  const { full_name, job_title = null, employee_number = null } = req.body || {};
  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (employee_number && !isValidPhoneNumber(employee_number)) {
    return res.status(400).json({ error: 'employee_number must be a standard 10-digit phone number' });
  }
  const employee_id = uuidv4();
  await dbRun(
    `INSERT INTO employees (employee_id, client_id, full_name, job_title, employee_number, active, employee_type)
     VALUES (?, ?, ?, ?, ?, 1, 'trainer')`,
    [employee_id, INTERNAL_CLIENT_ID, full_name.trim(), job_title, formatPhoneNumber(employee_number)]
  );
  logActivity({ actor: req.user, action: 'trainer_created', entityType: 'trainer', entityId: employee_id, entityLabel: full_name.trim(), req });
  res.status(201).json(await dbGet('SELECT * FROM employees WHERE employee_id = ?', [employee_id]));
});

module.exports = router;
