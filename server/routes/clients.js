const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Client directory (Keeley's request, 2026-08-18): the main Clients page now shows a running
// list of clients first, so this includes a quick employee_count per client for that list -
// clicking into a client is what shows/edits their training requirement settings.
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.client_id AND e.active = 1) AS employee_count
       FROM clients c ORDER BY c.client_name ASC`
    )
    .all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Client not found' });
  res.json(row);
});

router.post('/', requireAdmin, (req, res) => {
  const { client_name, active = 1, notes = null } = req.body;
  if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'client_name is required' });
  const client_id = uuidv4();
  db.prepare('INSERT INTO clients (client_id, client_name, active, notes) VALUES (?, ?, ?, ?)').run(
    client_id,
    client_name.trim(),
    active ? 1 : 0,
    notes
  );
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id));
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  const client_name = req.body.client_name ?? existing.client_name;
  const active = req.body.active === undefined ? existing.active : (req.body.active ? 1 : 0);
  const notes = req.body.notes === undefined ? existing.notes : req.body.notes;
  db.prepare('UPDATE clients SET client_name = ?, active = ?, notes = ? WHERE client_id = ?').run(
    client_name,
    active,
    notes,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM clients WHERE client_id = ?').get(req.params.id));
});

module.exports = router;
