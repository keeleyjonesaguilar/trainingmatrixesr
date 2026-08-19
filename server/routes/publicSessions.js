// Public, unauthenticated Training Sign-In routes - mounted at /api/public in server/index.js
// WITHOUT requireAuth. Trainees reach these by scanning a session's QR code; they never have
// (or need) a login. Everything else in this app requires a session cookie.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { formatPhoneNumber } = require('../lib/phone');
const { generateCertificate, generateRosterPdf } = require('../lib/pdfGen');
const { processAttendee } = require('../lib/sessionRecords');

const router = express.Router();

function getSessionByToken(token) {
  return db
    .prepare(
      `SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.qr_token = ?`
    )
    .get(token);
}

function isValidSignature(sig) {
  return typeof sig === 'string' && sig.startsWith('data:image/') && sig.length > 100;
}

// Fetch session context (no auth) so the sign-in page can show
// "You're signing in for: <client> / <training> / <date>" before the form.
router.get('/:token', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  const attendeeCount = db
    .prepare('SELECT COUNT(*) AS n FROM session_attendees WHERE session_id = ?')
    .get(session.session_id).n;
  res.json({
    client_name: session.client_name,
    training_type_label: session.training_type_label,
    trainer_name: session.trainer_name,
    session_date: session.session_date,
    outline: session.outline,
    status: session.status,
    attendee_count: attendeeCount,
  });
});

// A trainee signs in.
router.post('/:token/attendees', (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'This training session has been closed and can no longer accept sign-ins.' });
  }
  const { trainee_name, trainee_phone, signature } = req.body || {};
  if (!trainee_name || !trainee_name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A signature is required.' });
  }
  const attendee_id = uuidv4();
  db.prepare(
    `INSERT INTO session_attendees (attendee_id, session_id, trainee_name, trainee_phone, signature)
     VALUES (?, ?, ?, ?, ?)`
  ).run(attendee_id, session.session_id, trainee_name.trim(), formatPhoneNumber(trainee_phone) || null, signature);
  res.status(201).json({ ok: true });
});

// The trainer closes out the session at the end of training: locks the roster, generates a
// certificate per attendee, generates the combined roster PDF, and - now that this is all one
// database - writes each attendee straight into their employee's file (see sessionRecords.js).
router.post('/:token/close', async (req, res) => {
  const session = getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'This session is already closed.' });
  }
  const { trainer_signed_name, signature } = req.body || {};
  if (!trainer_signed_name || !trainer_signed_name.trim()) {
    return res.status(400).json({ error: 'Trainer name is required to close the session.' });
  }
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A trainer signature is required to close the session.' });
  }

  db.prepare(
    `UPDATE training_sessions
     SET status = 'closed', trainer_signed_name = ?, trainer_signature = ?,
         trainer_signed_at = datetime('now'), closed_at = datetime('now')
     WHERE session_id = ?`
  ).run(trainer_signed_name.trim(), signature, session.session_id);

  const updatedSession = db
    .prepare(`SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?`)
    .get(session.session_id);
  const attendees = db
    .prepare('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at')
    .all(session.session_id);

  // Certificate per attendee, then link them into the Matrix (best-effort per attendee so one
  // bad record can't block everyone else's certificate or employee record).
  for (const attendee of attendees) {
    let certPath = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      certPath = await generateCertificate(updatedSession, attendee);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Certificate generation failed for attendee ${attendee.attendee_id}:`, err);
    }
    processAttendee(updatedSession, attendee, certPath);
  }

  const attendeesFinal = db
    .prepare('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at')
    .all(session.session_id);

  try {
    const rosterPath = await generateRosterPdf(updatedSession, attendeesFinal);
    db.prepare('UPDATE training_sessions SET roster_pdf_path = ? WHERE session_id = ?').run(rosterPath, session.session_id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Roster PDF generation failed for session ${session.session_id}:`, err);
  }

  res.json({ ok: true, attendee_count: attendees.length });
});

module.exports = router;
