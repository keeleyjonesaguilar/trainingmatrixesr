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
