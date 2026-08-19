// Training Sign-In sessions - merged in from the standalone sign-in app (2026-08-19). Mounted
// under requireAuth in server/index.js like every other route here; individual mutating routes
// below additionally require requireAdmin, matching the rest of the app's convention.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const repo = require('../lib/repo');
const { requireAdmin } = require('../middleware/auth');
const { qrPngBuffer, publicSignInUrl } = require('../lib/qr');
const { processAttendee } = require('../lib/sessionRecords');

const router = express.Router();

function tokenGen() {
  return uuidv4().replace(/-/g, '').slice(0, 16);
}

function attendeeCount(sessionId) {
  return db.prepare('SELECT COUNT(*) AS n FROM session_attendees WHERE session_id = ?').get(sessionId).n;
}

const SESSION_WITH_CLIENT_SQL = `
  SELECT ts.*, c.client_name
  FROM training_sessions ts
  JOIN clients c ON c.client_id = ts.client_id
`;

// List sessions, optionally filtered by client_id (exact - used for cross-links from a client's
// own page), client_name (fuzzy - used by the filter box on the Sessions list), training, or status.
router.get('/', (req, res) => {
  const { client_id, client_name, master_training_id, status } = req.query;
  const clauses = [];
  const params = [];
  if (client_id) { clauses.push('ts.client_id = ?'); params.push(client_id); }
  if (client_name) { clauses.push('c.client_name LIKE ?'); params.push(`%${client_name}%`); }
  if (master_training_id) { clauses.push('ts.master_training_id = ?'); params.push(master_training_id); }
  if (status) { clauses.push('ts.status = ?'); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${SESSION_WITH_CLIENT_SQL} ${where} ORDER BY ts.session_date DESC, ts.created_at DESC`)
    .all(...params);
  res.json(rows.map((r) => ({ ...r, attendee_count: attendeeCount(r.session_id) })));
});

// Training Types directory (the "master page per training type" ask): every training in the
// catalog with a completed-session count, plus any custom/uncatalogued labels used.
router.get('/summary-by-training', (req, res) => {
  const trainings = db.prepare('SELECT * FROM master_trainings ORDER BY display_order ASC').all();
  const counts = db
    .prepare(
      `SELECT master_training_id, COUNT(*) AS n FROM training_sessions WHERE status = 'closed' GROUP BY master_training_id`
    )
    .all();
  const countMap = Object.fromEntries(counts.map((c) => [c.master_training_id, c.n]));
  const result = trainings.map((t) => ({ ...t, completed_session_count: countMap[t.training_id] || 0 }));

  const custom = db
    .prepare(
      `SELECT training_type_label AS label, COUNT(*) AS n
       FROM training_sessions WHERE status = 'closed' AND master_training_id IS NULL
       GROUP BY training_type_label`
    )
    .all();

  res.json({ trainings: result, custom });
});

// Drill into one training type: every completed session/roster for it, across every client
// (optionally filtered down to one client).
router.get('/by-training/:trainingId', (req, res) => {
  const { client_id } = req.query;
  const clauses = ['ts.master_training_id = ?', "ts.status = 'closed'"];
  const params = [req.params.trainingId];
  if (client_id) { clauses.push('ts.client_id = ?'); params.push(client_id); }
  const rows = db
    .prepare(`${SESSION_WITH_CLIENT_SQL} WHERE ${clauses.join(' AND ')} ORDER BY ts.session_date DESC`)
    .all(...params);
  res.json(rows.map((r) => ({ ...r, attendee_count: attendeeCount(r.session_id) })));
});

router.get('/:id', (req, res) => {
  const session = db.prepare(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendees = db
    .prepare('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at')
    .all(session.session_id);
  res.json({ ...session, public_url: publicSignInUrl(session.qr_token), attendees });
});

router.post('/', requireAdmin, (req, res) => {
  const { client_name, master_training_id, training_type_label, trainer_name, session_date, outline } = req.body || {};
  if (!client_name || !training_type_label || !trainer_name || !session_date) {
    return res.status(400).json({
      error: 'client_name, training_type_label, trainer_name, and session_date are required',
    });
  }
  let clientId;
  try {
    clientId = repo.findOrCreateClientByName(client_name);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const session_id = uuidv4();
  const qr_token = tokenGen();
  db.prepare(
    `INSERT INTO training_sessions
       (session_id, qr_token, client_id, master_training_id, training_type_label, trainer_name, session_date, outline, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session_id,
    qr_token,
    clientId,
    master_training_id || null,
    training_type_label,
    trainer_name,
    session_date,
    outline || null,
    req.user.username
  );
  const session = db.prepare(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`).get(session_id);
  res.status(201).json({ ...session, public_url: publicSignInUrl(qr_token) });
});

router.get('/:id/qrcode.png', async (req, res) => {
  const session = db.prepare('SELECT qr_token FROM training_sessions WHERE session_id = ?').get(req.params.id);
  if (!session) return res.status(404).end();
  const buf = await qrPngBuffer(session.qr_token);
  res.set('Content-Type', 'image/png');
  res.send(buf);
});

router.get('/:id/roster.pdf', (req, res) => {
  const session = db.prepare('SELECT * FROM training_sessions WHERE session_id = ?').get(req.params.id);
  if (!session || !session.roster_pdf_path) {
    return res.status(404).json({ error: 'Roster PDF not available yet — close the session first' });
  }
  res.download(session.roster_pdf_path, `roster-${session.session_date}.pdf`);
});

router.get('/:sessionId/attendees/:attendeeId/certificate.pdf', (req, res) => {
  const attendee = db
    .prepare('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?')
    .get(req.params.attendeeId, req.params.sessionId);
  if (!attendee || !attendee.certificate_path) return res.status(404).json({ error: 'Certificate not available yet' });
  res.download(attendee.certificate_path, attendee.certificate_filename || 'certificate.pdf');
});

// Manual correction of a typo'd attendee entry (name/phone), while the session is still open.
router.patch('/:sessionId/attendees/:attendeeId', requireAdmin, (req, res) => {
  const { trainee_name, trainee_phone } = req.body || {};
  const attendee = db
    .prepare('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?')
    .get(req.params.attendeeId, req.params.sessionId);
  if (!attendee) return res.status(404).json({ error: 'Attendee not found' });
  db.prepare(
    'UPDATE session_attendees SET trainee_name = COALESCE(?, trainee_name), trainee_phone = COALESCE(?, trainee_phone) WHERE attendee_id = ?'
  ).run(trainee_name || null, trainee_phone || null, attendee.attendee_id);
  res.json(db.prepare('SELECT * FROM session_attendees WHERE attendee_id = ?').get(attendee.attendee_id));
});

// Remove a duplicate/mistaken sign-in - only while the session is still open (roster locks at close-out).
router.delete('/:sessionId/attendees/:attendeeId', requireAdmin, (req, res) => {
  const session = db.prepare('SELECT status FROM training_sessions WHERE session_id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'Session is closed; roster is locked' });
  }
  db.prepare('DELETE FROM session_attendees WHERE attendee_id = ? AND session_id = ?').run(
    req.params.attendeeId,
    req.params.sessionId
  );
  res.json({ ok: true });
});

// Re-run the employee/training-record linkage for one attendee - useful if it failed, or if the
// session used a custom label that's since been added to the Master Training Catalog.
router.post('/:sessionId/attendees/:attendeeId/process', requireAdmin, (req, res) => {
  const session = db.prepare(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`).get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'closed') return res.status(400).json({ error: 'Session must be closed first' });
  const attendee = db
    .prepare('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?')
    .get(req.params.attendeeId, req.params.sessionId);
  if (!attendee) return res.status(404).json({ error: 'Attendee not found' });
  processAttendee(session, attendee, attendee.certificate_path || null);
  res.json(db.prepare('SELECT * FROM session_attendees WHERE attendee_id = ?').get(attendee.attendee_id));
});

// CSV export of a session's roster.
router.get('/:id/roster.csv', (req, res) => {
  const session = db.prepare(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendees = db
    .prepare('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at')
    .all(session.session_id);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [
    'Client',
    'Training',
    'Trainer',
    'Session Date',
    'Trainee Name',
    'Trainee Phone',
    'Signed At',
    'Employee Record Status',
  ];
  const lines = [header.map(esc).join(',')];
  for (const a of attendees) {
    lines.push(
      [
        session.client_name,
        session.training_type_label,
        session.trainer_signed_name || session.trainer_name,
        session.session_date,
        a.trainee_name,
        a.trainee_phone,
        a.signed_at,
        a.processing_status,
      ]
        .map(esc)
        .join(',')
    );
  }
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', `attachment; filename="roster-${session.session_date}.csv"`);
  res.send(lines.join('\n'));
});

module.exports = router;
