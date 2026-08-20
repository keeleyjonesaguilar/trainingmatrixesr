const fs = require('fs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const repo = require('../lib/repo');
const { INTERNAL_CLIENT_ID } = require('../lib/repo');

const router = express.Router();

// Client directory (Keeley's request, 2026-08-18): the main Clients page now shows a running
// list of clients first, so this includes a quick employee_count per client for that list -
// clicking into a client is what shows/edits their training requirement settings. The internal
// Trainers pseudo-client is excluded - it's managed from its own dedicated Trainers page, never
// mixed into the real client directory.
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM employees e WHERE e.client_id = c.client_id AND e.active = 1) AS employee_count
       FROM clients c WHERE c.is_internal = 0 ORDER BY c.client_name ASC`
    )
    .all();
  res.json(rows);
});

// Registered before /:id so the literal path "duplicates"/"merge" doesn't get swallowed by
// the :id param route below.
router.get('/duplicates', (req, res) => {
  res.json(repo.findDuplicateClientClusters());
});

// Merge one or more duplicate clients into a single "winner" - every employee, training
// record, requirement override, session, and import batch moves over (nothing deleted); any
// employees or sessions that become duplicates of each other as a direct result are then
// auto-merged too (Keeley's rule - see repo.mergeClients for exactly how).
router.post('/merge', requireAdmin, (req, res) => {
  const { winner_id, loser_ids } = req.body || {};
  if (!winner_id || !Array.isArray(loser_ids) || loser_ids.length === 0) {
    return res.status(400).json({ error: 'winner_id and a non-empty loser_ids array are required' });
  }
  if (loser_ids.includes(INTERNAL_CLIENT_ID) || winner_id === INTERNAL_CLIENT_ID) {
    return res.status(400).json({ error: 'The internal Trainers profile cannot be merged.' });
  }
  const winner = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(winner_id);
  if (!winner) return res.status(404).json({ error: 'Winner client not found' });

  repo.mergeClients(winner_id, loser_ids);
  res.json(db.prepare('SELECT * FROM clients WHERE client_id = ?').get(winner_id));
});

// Dismiss a possible-duplicate grouping without merging (Keeley's request) - e.g. two clients
// that really do just share a name. Only affects that exact grouping; a differently-shaped
// grouping involving one of these clients later would still be flagged.
router.post('/duplicates/ignore', requireAdmin, (req, res) => {
  const { member_ids } = req.body || {};
  if (!Array.isArray(member_ids) || member_ids.length < 2) {
    return res.status(400).json({ error: 'member_ids must be an array of at least 2 client ids' });
  }
  repo.ignoreDuplicateCluster('client', member_ids);
  res.json({ ok: true });
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

// Permanently deletes a client and everything under it (employees, training records,
// sessions, import history) - ON DELETE CASCADE on the relevant foreign keys handles the DB
// rows, but certificate/roster files living on disk are not touched by that cascade, so they're
// explicitly unlinked here first. The internal Trainers pseudo-client can never be deleted this
// way - it's system-managed, not a real client an admin should be able to remove.
router.delete('/:id', requireAdmin, (req, res) => {
  if (req.params.id === INTERNAL_CLIENT_ID) {
    return res.status(400).json({ error: 'The internal Trainers profile cannot be deleted.' });
  }
  const existing = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const recordCerts = db
    .prepare('SELECT certificate_path FROM employee_training_records WHERE client_id = ? AND certificate_path IS NOT NULL')
    .all(req.params.id);
  for (const { certificate_path } of recordCerts) {
    if (certificate_path && fs.existsSync(certificate_path)) fs.unlink(certificate_path, () => {});
  }

  const sessions = db.prepare('SELECT session_id, roster_pdf_path FROM training_sessions WHERE client_id = ?').all(req.params.id);
  for (const session of sessions) {
    if (session.roster_pdf_path && fs.existsSync(session.roster_pdf_path)) fs.unlink(session.roster_pdf_path, () => {});
    const attendeeCerts = db
      .prepare('SELECT certificate_path FROM session_attendees WHERE session_id = ? AND certificate_path IS NOT NULL')
      .all(session.session_id);
    for (const { certificate_path } of attendeeCerts) {
      if (certificate_path && fs.existsSync(certificate_path)) fs.unlink(certificate_path, () => {});
    }
  }

  db.prepare('DELETE FROM clients WHERE client_id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
