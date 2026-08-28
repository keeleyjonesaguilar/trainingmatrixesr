// Public, unauthenticated Training Sign-In routes - mounted at /api/public in server/index.js
// WITHOUT requireAuth. Trainees reach these by scanning a session's QR code; they never have
// (or need) a login. Everything else in this app requires a session cookie.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { generateCertificate, generateRosterPdf } = require('../lib/pdfGen');
const { processAttendee } = require('../lib/sessionRecords');

const router = express.Router();

async function getSessionByToken(token) {
  return dbGet(
    `SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.qr_token = ?`,
    [token]
  );
}

function isValidSignature(sig) {
  return typeof sig === 'string' && sig.startsWith('data:image/') && sig.length > 100;
}

// Fetch session context (no auth) so the sign-in page can show
// "You're signing in for: <client> / <training> / <date>" before the form.
router.get('/:token', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  const { n: attendeeCount } = await dbGet('SELECT COUNT(*) AS n FROM session_attendees WHERE session_id = ?', [session.session_id]);
  res.json({
    client_name: session.client_name,
    training_type_label: session.training_type_label,
    training_type_label_es: session.training_type_label_es,
    trainer_name: session.trainer_name,
    session_date: session.session_date,
    outline: session.outline,
    outline_es: session.outline_es,
    language: session.language,
    status: session.status,
    attendee_count: attendeeCount,
  });
});

// A trainee signs in.
router.post('/:token/attendees', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'This training session has been closed and can no longer accept sign-ins.' });
  }
  const { trainee_name, trainee_phone, trainee_job_title, signature } = req.body || {};
  if (!trainee_name || !trainee_name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!trainee_phone || !trainee_phone.trim()) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }
  if (!isValidPhoneNumber(trainee_phone)) {
    return res.status(400).json({ error: 'Please enter a standard 10-digit phone number.' });
  }
  if (!trainee_job_title || !trainee_job_title.trim()) {
    return res.status(400).json({ error: 'Job title is required.' });
  }
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A signature is required.' });
  }
  const attendee_id = uuidv4();
  await dbRun(
    `INSERT INTO session_attendees (attendee_id, session_id, trainee_name, trainee_phone, trainee_job_title, signature)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [attendee_id, session.session_id, trainee_name.trim(), formatPhoneNumber(trainee_phone), trainee_job_title.trim(), signature]
  );
  res.status(201).json({ ok: true });
});

// The trainer closes out the session at the end of training: locks the roster, generates a
// certificate per attendee, generates the combined roster PDF, and - now that this is all one
// database - writes each attendee straight into their employee's file (see sessionRecords.js).
router.post('/:token/close', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'This session is already closed.' });
  }
  const { trainer_signed_name, signature, pin } = req.body || {};
  if (!trainer_signed_name || !trainer_signed_name.trim()) {
    return res.status(400).json({ error: 'Trainer name is required to close the session.' });
  }
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A trainer signature is required to close the session.' });
  }
  // Only the trainer should be able to close the session (Keeley's request: trainees
  // shouldn't be able to trigger it by accident) - a fixed, case-insensitive PIN, checked
  // server-side since the client-side field is only a UX convenience, not the real boundary.
  if (String(pin || '').trim().toUpperCase() !== 'ESR') {
    return res.status(400).json({ error: 'Incorrect PIN.' });
  }

  await dbRun(
    `UPDATE training_sessions
     SET status = 'closed', trainer_signed_name = ?, trainer_signature = ?,
         trainer_signed_at = now_utc_text(), closed_at = now_utc_text()
     WHERE session_id = ?`,
    [trainer_signed_name.trim(), signature, session.session_id]
  );

  const updatedSession = await dbGet(
    `SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?`,
    [session.session_id]
  );
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);

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
    // eslint-disable-next-line no-await-in-loop
    await processAttendee(updatedSession, attendee, certPath);
  }

  const attendeesFinal = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);

  try {
    const rosterPath = await generateRosterPdf(updatedSession, attendeesFinal);
    await dbRun('UPDATE training_sessions SET roster_pdf_path = ? WHERE session_id = ?', [rosterPath, session.session_id]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Roster PDF generation failed for session ${session.session_id}:`, err);
  }

  res.json({ ok: true, attendee_count: attendees.length });
});

// Fetch session context for the feedback page (no auth) - same minimal shape as the sign-in
// context fetch above, just for the second QR code's landing page.
router.get('/:token/feedback', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This feedback link isn't valid." });
  // Question text comes from the admin-editable feedback_form_settings row (Keeley's request)
  // - read here rather than through the authenticated /api/feedback-settings route, since this
  // page has no login to read it with.
  const labels = await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']);
  res.json({
    client_name: session.client_name,
    training_type_label: session.training_type_label,
    trainer_name: session.trainer_name,
    session_date: session.session_date,
    labels,
  });
});

// A trainee submits post-training feedback - anonymous (no attendee/employee link), so there's
// no login/name field and no identity to attach it to even if we wanted to. Multiple
// submissions per session are expected, one per trainee who fills out the form.
router.post('/:token/feedback', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This feedback link isn't valid." });
  const {
    could_ask_questions = null,
    understood_material = null,
    needs_additional_training = null,
    effectiveness_rating,
    trainer_rating,
    trainer_comment = null,
  } = req.body || {};
  const effectiveness = Number(effectiveness_rating);
  const trainerScore = Number(trainer_rating);
  if (!Number.isInteger(effectiveness) || effectiveness < 1 || effectiveness > 5) {
    return res.status(400).json({ error: 'effectiveness_rating must be a whole number between 1 and 5.' });
  }
  if (!Number.isInteger(trainerScore) || trainerScore < 1 || trainerScore > 5) {
    return res.status(400).json({ error: 'trainer_rating must be a whole number between 1 and 5.' });
  }
  await dbRun(
    `INSERT INTO session_feedback
       (feedback_id, session_id, could_ask_questions, understood_material, needs_additional_training, effectiveness_rating, trainer_rating, trainer_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      session.session_id,
      could_ask_questions,
      understood_material,
      needs_additional_training,
      effectiveness,
      trainerScore,
      trainer_comment ? String(trainer_comment).trim() : null,
    ]
  );
  res.status(201).json({ ok: true });
});

module.exports = router;
