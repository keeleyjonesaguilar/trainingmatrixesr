// Trainers directory - deliberately separate from /api/employees (which excludes trainer-type
// rows) so trainers are browsed/managed on their own dedicated page, never mixed into a real
// client's roster or the org-wide employee list.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const repo = require('../lib/repo');
const { INTERNAL_CLIENT_ID } = require('../lib/repo');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');

const router = express.Router();

// Registered before the (nonexistent, but keeping the convention) generic routes so
// "duplicates" is never mistaken for anything else.
router.get('/duplicates', (req, res) => {
  res.json(repo.findDuplicateTrainerClusters());
});

// Dismiss a possible-duplicate grouping without merging (Keeley's request) - e.g. two
// trainers who really do share a name/phone but aren't the same person.
router.post('/duplicates/ignore', requireAdmin, (req, res) => {
  const { member_ids } = req.body || {};
  if (!Array.isArray(member_ids) || member_ids.length < 2) {
    return res.status(400).json({ error: 'member_ids must be an array of at least 2 trainer ids' });
  }
  repo.ignoreDuplicateCluster('trainer', member_ids);
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM employees WHERE client_id = ? AND employee_type = 'trainer' ORDER BY full_name ASC`)
    .all(INTERNAL_CLIENT_ID);
  res.json(rows);
});

// Phone number is captured here too (Keeley's call: trainings get linked to a trainer by
// phone, since it's a more reliable identity than name) - stored on the same employee_number
// column a regular employee's phone uses.
router.post('/', requireAdmin, (req, res) => {
  const { full_name, job_title = null, employee_number = null } = req.body || {};
  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (employee_number && !isValidPhoneNumber(employee_number)) {
    return res.status(400).json({ error: 'employee_number must be a standard 10-digit phone number' });
  }
  const employee_id = uuidv4();
  db.prepare(
    `INSERT INTO employees (employee_id, client_id, full_name, job_title, employee_number, active, employee_type)
     VALUES (?, ?, ?, ?, ?, 1, 'trainer')`
  ).run(employee_id, INTERNAL_CLIENT_ID, full_name.trim(), job_title, formatPhoneNumber(employee_number));
  res.status(201).json(db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employee_id));
});

module.exports = router;
