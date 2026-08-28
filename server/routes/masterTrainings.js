const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { EXPIRATION_UNITS } = require('../lib/statusEngine');
const repo = require('../lib/repo');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const { activeOnly } = req.query;
  const sql = `SELECT * FROM master_trainings ${activeOnly === 'true' ? 'WHERE active = 1' : ''} ORDER BY display_order ASC`;
  res.json(await dbAll(sql));
});

// Summary stats + category breakdown for the Master Trainings screen. Registered before
// /:id so the literal path "summary" doesn't get swallowed by the :id param route below.
router.get('/summary', async (req, res) => {
  const active = await dbAll('SELECT * FROM master_trainings WHERE active = 1');
  const clientCoverage = (await dbGet('SELECT COUNT(*) AS n FROM clients WHERE active = 1 AND is_internal = 0')).n;
  const aliasesMapped = (await dbGet('SELECT COUNT(*) AS n FROM training_aliases')).n;
  // "High-risk" isn't a stored flag - it's every category besides the two lowest-risk ones
  // (regulatory orientation/paperwork categories), based on this catalog's existing categories.
  const highRisk = active.filter((t) => !['OSHA', 'Orientation'].includes(t.category)).length;

  const categoryCounts = {};
  for (const t of active) categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  const categories = Object.entries(categoryCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const recentAliases = await dbAll(
    `SELECT a.alias_text, a.training_id, m.training_name
     FROM training_aliases a JOIN master_trainings m ON m.training_id = a.training_id
     ORDER BY a.insert_seq DESC LIMIT 6`
  );

  res.json({
    masterModules: active.length,
    clientCoverage,
    aliasesMapped,
    highRisk,
    categories,
    recentAliases,
  });
});

router.get('/:id', async (req, res) => {
  const row = await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Training not found' });
  res.json(row);
});

// Future Expansion (spec section 16): allow adding new trainings to the catalog without
// rebuilding the app. Training IDs are now auto-generated (TRN-### one past the current
// highest number) rather than typed in by hand - see repo.generateNextTrainingId - so there's
// no more collision risk and no manual-formatting mistakes.
router.post('/', requireAdmin, async (req, res) => {
  const { training_name, category, training_type, default_expiration, active = 1, display_order } = req.body;
  if (!training_name || !category || !training_type) {
    return res.status(400).json({ error: 'training_name, category, training_type are required' });
  }
  if (!EXPIRATION_UNITS.includes(default_expiration)) {
    return res.status(400).json({ error: `default_expiration must be one of: ${EXPIRATION_UNITS.join(', ')}` });
  }
  const training_id = await repo.generateNextTrainingId();

  const maxOrder = (await dbGet('SELECT MAX(display_order) AS m FROM master_trainings')).m || 0;
  await dbRun(
    `INSERT INTO master_trainings (training_id, training_name, category, training_type, default_expiration, active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [training_id, training_name, category, training_type, default_expiration, active ? 1 : 0, display_order ?? maxOrder + 1]
  );

  res.status(201).json(await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [training_id]));
});

router.put('/:id', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Training not found' });
  const merged = { ...existing, ...req.body };
  if (!EXPIRATION_UNITS.includes(merged.default_expiration)) {
    return res.status(400).json({ error: `default_expiration must be one of: ${EXPIRATION_UNITS.join(', ')}` });
  }
  await dbRun(
    `UPDATE master_trainings SET training_name=?, category=?, training_type=?, default_expiration=?, active=?, display_order=?, outline=?, default_duration=?
     WHERE training_id=?`,
    [
      merged.training_name,
      merged.category,
      merged.training_type,
      merged.default_expiration,
      merged.active ? 1 : 0,
      merged.display_order,
      merged.outline ?? null,
      merged.default_duration ?? null,
      req.params.id,
    ]
  );
  res.json(await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [req.params.id]));
});

// Training Detail Page (spec section 10): this training's catalog info plus every employee
// who has some real status for it, optionally scoped to one client.
//
// Bug fix (2026-08-18): this used to only bucket Current/Expired/Missing, silently dropping
// anyone whose status was No Expiration or Pending Review - which is most completed records,
// since most trainings in this catalog don't expire. That made the page look empty even when
// employees had actually completed the training. Not Applicable is still excluded on purpose
// (that means the training doesn't apply to that employee at all - nothing to show).
router.get('/:id/detail', async (req, res) => {
  const mt = await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [req.params.id]);
  if (!mt) return res.status(404).json({ error: 'Training not found' });

  const { client_id } = req.query;
  const clauses = ['e.active = 1', 'c.is_internal = 0'];
  const params = [];
  if (client_id) { clauses.push('e.client_id = ?'); params.push(client_id); }
  const employees = await dbAll(
    `SELECT e.* FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE ${clauses.join(' AND ')}`,
    params
  );

  const buckets = { Current: [], Expired: [], 'No Expiration': [], 'Pending Review': [], Missing: [] };
  for (const emp of employees) {
    const { status, expirationDate, record } = await repo.computeCell({
      employeeId: emp.employee_id,
      clientId: emp.client_id,
      trainingId: mt.training_id,
      masterTraining: mt,
    });
    if (buckets[status]) {
      buckets[status].push({
        employee_id: emp.employee_id,
        full_name: emp.full_name,
        client_id: emp.client_id,
        completion_date: record ? record.completion_date : null,
        expiration_date: expirationDate,
      });
    }
  }

  res.json({
    training: mt,
    current: buckets.Current,
    expired: buckets.Expired,
    noExpiration: buckets['No Expiration'],
    pendingReview: buckets['Pending Review'],
    missing: buckets.Missing,
  });
});

// Delete a training from the catalog (Keeley's request - e.g. a test/accidental entry).
// Blocked if any employee has an actual completion record for it - deleting the catalog row
// out from under real compliance history would make those records orphaned/invisible rather
// than actually removing anything, so "Inactive" is the right tool once a training has real
// history; this stays for entries nobody has ever completed. client_training_requirements
// cascades automatically (ON DELETE CASCADE); sessions/import history that referenced it fall
// back to their own frozen label text rather than being deleted themselves.
router.delete('/:id', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Training not found' });

  const recordCount = (await dbGet('SELECT COUNT(*) AS n FROM employee_training_records WHERE training_id = ?', [req.params.id])).n;
  if (recordCount > 0) {
    return res.status(400).json({
      error: `Cannot delete - ${recordCount} employee training record${recordCount === 1 ? '' : 's'} reference this training. Set it to Inactive instead if it's no longer needed.`,
    });
  }

  await dbRun('DELETE FROM training_aliases WHERE training_id = ?', [req.params.id]);
  await dbRun('UPDATE training_sessions SET master_training_id = NULL WHERE master_training_id = ?', [req.params.id]);
  await dbRun('UPDATE import_column_map SET matched_training_id = NULL WHERE matched_training_id = ?', [req.params.id]);
  await dbRun('DELETE FROM master_trainings WHERE training_id = ?', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
