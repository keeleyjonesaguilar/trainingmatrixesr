const express = require('express');
const db = require('../db');
const { EXPIRATION_UNITS } = require('../lib/statusEngine');
const repo = require('../lib/repo');

const router = express.Router();

router.get('/', (req, res) => {
  const { activeOnly } = req.query;
  const sql = `SELECT * FROM master_trainings ${activeOnly === 'true' ? 'WHERE active = 1' : ''} ORDER BY display_order ASC`;
  res.json(db.prepare(sql).all());
});

// Summary stats + category breakdown for the Master Trainings screen. Registered before
// /:id so the literal path "summary" doesn't get swallowed by the :id param route below.
router.get('/summary', (req, res) => {
  const active = db.prepare('SELECT * FROM master_trainings WHERE active = 1').all();
  const clientCoverage = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE active = 1').get().n;
  const aliasesMapped = db.prepare('SELECT COUNT(*) AS n FROM training_aliases').get().n;
  // "High-risk" isn't a stored flag - it's every category besides the two lowest-risk ones
  // (regulatory orientation/paperwork categories), based on this catalog's existing categories.
  const highRisk = active.filter((t) => !['OSHA', 'Orientation'].includes(t.category)).length;

  const categoryCounts = {};
  for (const t of active) categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  const categories = Object.entries(categoryCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const recentAliases = db
    .prepare(
      `SELECT a.alias_text, a.training_id, m.training_name
       FROM training_aliases a JOIN master_trainings m ON m.training_id = a.training_id
       ORDER BY a.rowid DESC LIMIT 6`
    )
    .all();

  res.json({
    masterModules: active.length,
    clientCoverage,
    aliasesMapped,
    highRisk,
    categories,
    recentAliases,
  });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Training not found' });
  res.json(row);
});

// Future Expansion (spec section 16): allow adding new trainings to the catalog without
// rebuilding the app. New Training IDs should follow the TRN-### convention but aren't enforced
// here, since the catalog may need to grow past TRN-052.
router.post('/', (req, res) => {
  const { training_id, training_name, category, training_type, default_expiration, active = 1, display_order } = req.body;
  if (!training_id || !training_name || !category || !training_type) {
    return res.status(400).json({ error: 'training_id, training_name, category, training_type are required' });
  }
  if (!EXPIRATION_UNITS.includes(default_expiration)) {
    return res.status(400).json({ error: `default_expiration must be one of: ${EXPIRATION_UNITS.join(', ')}` });
  }
  const existing = db.prepare('SELECT training_id FROM master_trainings WHERE training_id = ?').get(training_id);
  if (existing) return res.status(409).json({ error: 'training_id already exists' });

  const maxOrder = db.prepare('SELECT MAX(display_order) AS m FROM master_trainings').get().m || 0;
  db.prepare(
    `INSERT INTO master_trainings (training_id, training_name, category, training_type, default_expiration, active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(training_id, training_name, category, training_type, default_expiration, active ? 1 : 0, display_order ?? maxOrder + 1);

  res.status(201).json(db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(training_id));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Training not found' });
  const merged = { ...existing, ...req.body };
  if (!EXPIRATION_UNITS.includes(merged.default_expiration)) {
    return res.status(400).json({ error: `default_expiration must be one of: ${EXPIRATION_UNITS.join(', ')}` });
  }
  db.prepare(
    `UPDATE master_trainings SET training_name=?, category=?, training_type=?, default_expiration=?, active=?, display_order=?
     WHERE training_id=?`
  ).run(
    merged.training_name,
    merged.category,
    merged.training_type,
    merged.default_expiration,
    merged.active ? 1 : 0,
    merged.display_order,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(req.params.id));
});

// Training Detail Page (spec section 10): this training's catalog info plus employees who are
// current / expired / missing for it, optionally scoped to one client.
router.get('/:id/detail', (req, res) => {
  const mt = db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(req.params.id);
  if (!mt) return res.status(404).json({ error: 'Training not found' });

  const { client_id } = req.query;
  const clauses = ['active = 1'];
  const params = [];
  if (client_id) { clauses.push('client_id = ?'); params.push(client_id); }
  const employees = db.prepare(`SELECT * FROM employees WHERE ${clauses.join(' AND ')}`).all(...params);

  const buckets = { Current: [], Expired: [], Missing: [] };
  for (const emp of employees) {
    const { status, expirationDate } = repo.computeCell({
      employeeId: emp.employee_id,
      clientId: emp.client_id,
      trainingId: mt.training_id,
      masterTraining: mt,
    });
    if (buckets[status]) {
      buckets[status].push({ employee_id: emp.employee_id, full_name: emp.full_name, client_id: emp.client_id, expiration_date: expirationDate });
    }
  }

  res.json({ training: mt, current: buckets.Current, expired: buckets.Expired, missing: buckets.Missing });
});

module.exports = router;
