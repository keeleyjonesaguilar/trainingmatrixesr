// Training Sign-In sessions - merged in from the standalone sign-in app (2026-08-19). Mounted
// under requireAuth in server/index.js like every other route here; individual mutating routes
// below additionally require requireAdmin, matching the rest of the app's convention.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('../lib/repo');
const { requireAdmin } = require('../middleware/auth');
const { qrPngBuffer, publicSignInUrl, feedbackQrPngBuffer, publicFeedbackUrl } = require('../lib/qr');
const { processAttendee } = require('../lib/sessionRecords');
const { translateToSpanish } = require('../lib/translate');
const fs = require('fs');

const router = express.Router();

const SESSION_LANGUAGES = ['english', 'spanish', 'both'];

function tokenGen() {
  return uuidv4().replace(/-/g, '').slice(0, 16);
}

// Translates a session's training name/outline to Spanish once, at save time, so the public
// sign-in page never calls the translation API itself (Keeley's design: cache the result, don't
// translate on every page view). If the call fails (e.g. DEEPL_API_KEY isn't set up yet), the
// session still saves with the Spanish text left blank and a warning surfaced to the admin -
// translation is a nice-to-have, never a reason to block saving the session.
async function translateSessionFields(trainingTypeLabel, outline, language) {
  if (language === 'english') return { training_type_label_es: null, outline_es: null, warning: null };
  try {
    const [training_type_label_es, outline_es] = await Promise.all([
      translateToSpanish(trainingTypeLabel),
      translateToSpanish(outline),
    ]);
    return { training_type_label_es: training_type_label_es || null, outline_es: outline_es || null, warning: null };
  } catch (err) {
    return { training_type_label_es: null, outline_es: null, warning: err.message };
  }
}

async function attendeeCount(sessionId) {
  const { n } = await dbGet('SELECT COUNT(*) AS n FROM session_attendees WHERE session_id = ?', [sessionId]);
  return n;
}

const SESSION_WITH_CLIENT_SQL = `
  SELECT ts.*, c.client_name
  FROM training_sessions ts
  JOIN clients c ON c.client_id = ts.client_id
`;

// List sessions, optionally filtered by client_id (exact - used for cross-links from a client's
// own page), client_name (fuzzy - used by the filter box on the Sessions list), training, or status.
router.get('/', async (req, res) => {
  const { client_id, client_name, master_training_id, status, trainer_employee_id } = req.query;
  const clauses = [];
  const params = [];
  if (client_id) { clauses.push('ts.client_id = ?'); params.push(client_id); }
  if (client_name) { clauses.push('c.client_name LIKE ?'); params.push(`%${client_name}%`); }
  if (master_training_id) { clauses.push('ts.master_training_id = ?'); params.push(master_training_id); }
  if (status) { clauses.push('ts.status = ?'); params.push(status); }
  // Feeds a Trainer's own "Trainings Taught" section on their profile.
  if (trainer_employee_id) { clauses.push('ts.trainer_employee_id = ?'); params.push(trainer_employee_id); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await dbAll(`${SESSION_WITH_CLIENT_SQL} ${where} ORDER BY ts.session_date DESC, ts.created_at DESC`, params);
  res.json(await Promise.all(rows.map(async (r) => ({ ...r, attendee_count: await attendeeCount(r.session_id) }))));
});

// Training Types directory (the "master page per training type" ask): every training in the
// catalog with a completed-session count, plus any custom/uncatalogued labels used.
router.get('/summary-by-training', async (req, res) => {
  const trainings = await dbAll('SELECT * FROM master_trainings ORDER BY display_order ASC');
  const counts = await dbAll(
    `SELECT master_training_id, COUNT(*) AS n FROM training_sessions WHERE status = 'closed' GROUP BY master_training_id`
  );
  const countMap = Object.fromEntries(counts.map((c) => [c.master_training_id, c.n]));
  const result = trainings.map((t) => ({ ...t, completed_session_count: countMap[t.training_id] || 0 }));

  const custom = await dbAll(
    `SELECT training_type_label AS label, COUNT(*) AS n
     FROM training_sessions WHERE status = 'closed' AND master_training_id IS NULL
     GROUP BY training_type_label`
  );

  res.json({ trainings: result, custom });
});

// Drill into one training type: every session (upcoming and past) for it, across every client
// (optionally filtered down to one client). The client buckets these into Upcoming/Past by
// status - roster PDF/CSV only make sense once a session is closed.
router.get('/by-training/:trainingId', async (req, res) => {
  const { client_id } = req.query;
  const clauses = ['ts.master_training_id = ?'];
  const params = [req.params.trainingId];
  if (client_id) { clauses.push('ts.client_id = ?'); params.push(client_id); }
  const rows = await dbAll(`${SESSION_WITH_CLIENT_SQL} WHERE ${clauses.join(' AND ')} ORDER BY ts.session_date DESC`, params);
  res.json(await Promise.all(rows.map(async (r) => ({ ...r, attendee_count: await attendeeCount(r.session_id) }))));
});

router.get('/:id', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
  const feedback = await dbAll('SELECT * FROM session_feedback WHERE session_id = ? ORDER BY submitted_at', [session.session_id]);
  res.json({ ...session, public_url: publicSignInUrl(session.qr_token), feedback_url: publicFeedbackUrl(session.qr_token), attendees, feedback });
});

// Every field is required to create a session (Keeley's call) - client, training type,
// trainer name, date, location, duration, and outline all need to be on file up front.
// Trainer Employee ID is the one exception: it's required when picking an existing trainer
// (auto-filled, read-only on the client) but skipped entirely for a brand-new trainer typed
// in on the spot - trainer_needs_review flags that session instead of blocking creation on it.
router.post('/', requireAdmin, async (req, res) => {
  const {
    client_name, master_training_id, training_type_label, trainer_name, trainer_phone,
    session_date, outline, location, duration, language = 'english',
  } = req.body || {};
  if (!client_name || !training_type_label || !trainer_name || !session_date || !location || !duration || !outline) {
    return res.status(400).json({
      error: 'client_name, training_type_label, trainer_name, session_date, location, duration, and outline are all required',
    });
  }
  // Derived purely from whether an Employee ID is present, not trusted from the client
  // (Keeley's call) - so a session created without one, then later edited to add it, clears
  // itself automatically instead of needing a separate "un-flag" action anywhere.
  const trainerNeedsReview = !trainer_phone;
  if (!SESSION_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${SESSION_LANGUAGES.join(', ')}` });
  }
  let clientId;
  try {
    clientId = await repo.findOrCreateClientByName(client_name);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Resolves to the trainer's own profile by Employee ID (more reliable than name - two
  // trainers could share a name, not an ID), creating one on first use - trainer_name/
  // trainer_phone are kept as-typed on the session too, a frozen display fallback (matches
  // how client_name works above).
  const trainerEmployeeId = await repo.findOrCreateTrainerEmployee(trainer_name, trainer_phone);
  const { training_type_label_es, outline_es, warning } = await translateSessionFields(training_type_label, outline, language);
  const session_id = uuidv4();
  const qr_token = tokenGen();
  await dbRun(
    `INSERT INTO training_sessions
       (session_id, qr_token, client_id, master_training_id, training_type_label, trainer_name, trainer_phone, trainer_employee_id, session_date, outline, location, duration, created_by, language, training_type_label_es, outline_es, trainer_needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session_id,
      qr_token,
      clientId,
      master_training_id || null,
      training_type_label,
      trainer_name,
      trainer_phone ? trainer_phone.trim() : null,
      trainerEmployeeId,
      session_date,
      outline,
      location,
      duration,
      req.user.username,
      language,
      training_type_label_es,
      outline_es,
      trainerNeedsReview ? 1 : 0,
    ]
  );
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [session_id]);
  res.status(201).json({ ...session, public_url: publicSignInUrl(qr_token), translation_warning: warning });
});

// Edit a session's own metadata after creation (client/trainer/date/outline/location/duration).
// Note: this does not retroactively regenerate already-generated roster/certificate PDFs, and
// does not re-touch employee records already written by a prior close-out - the per-attendee
// Retry button on SessionDetail remains the way to reprocess one attendee against corrected data.
router.put('/:id', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  const merged = { ...existing, ...req.body };

  if (!merged.client_name && !existing.client_id) {
    return res.status(400).json({ error: 'client_name is required' });
  }
  if (!merged.training_type_label || !merged.trainer_name || !merged.session_date || !merged.location || !merged.duration || !merged.outline) {
    return res.status(400).json({
      error: 'training_type_label, trainer_name, session_date, location, duration, and outline are all required',
    });
  }
  // Same derived-not-trusted logic as creation: this self-clears the moment an Employee ID
  // gets added through this same edit form, with no separate "un-flag" action needed.
  const trainerNeedsReview = !merged.trainer_phone;
  if (!SESSION_LANGUAGES.includes(merged.language)) {
    return res.status(400).json({ error: `language must be one of: ${SESSION_LANGUAGES.join(', ')}` });
  }

  let clientId = existing.client_id;
  if (req.body.client_name) {
    try {
      clientId = await repo.findOrCreateClientByName(req.body.client_name);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  let trainerEmployeeId = existing.trainer_employee_id;
  if (req.body.trainer_name || req.body.trainer_phone) {
    trainerEmployeeId = await repo.findOrCreateTrainerEmployee(merged.trainer_name, merged.trainer_phone);
  }

  // Re-translates whenever Spanish/Both is in effect, since the name/outline/language could
  // each have just changed and there's no cheap way to tell from here - this only runs when an
  // admin saves the session, never on a public sign-in page view.
  const { training_type_label_es, outline_es, warning } = await translateSessionFields(
    merged.training_type_label,
    merged.outline,
    merged.language
  );

  await dbRun(
    `UPDATE training_sessions
     SET client_id=?, master_training_id=?, training_type_label=?, trainer_name=?, trainer_phone=?, trainer_employee_id=?,
         session_date=?, outline=?, location=?, duration=?, language=?, training_type_label_es=?, outline_es=?, trainer_needs_review=?
     WHERE session_id=?`,
    [
      clientId,
      merged.master_training_id ?? null,
      merged.training_type_label,
      merged.trainer_name,
      merged.trainer_phone ? merged.trainer_phone.trim() : null,
      trainerEmployeeId,
      merged.session_date,
      merged.outline,
      merged.location,
      merged.duration,
      merged.language,
      training_type_label_es,
      outline_es,
      trainerNeedsReview ? 1 : 0,
      req.params.id,
    ]
  );
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  res.json({ ...session, translation_warning: warning });
});

// Delete a session created by accident (Keeley's request - lives under the session's own
// "Edit Session Details" panel). Attendee rows cascade-delete via the FK; certificate/roster
// files on disk don't, so they're unlinked first, mirroring the client-delete cleanup pattern.
router.delete('/:id', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Session not found' });

  if (existing.roster_pdf_path && fs.existsSync(existing.roster_pdf_path)) fs.unlink(existing.roster_pdf_path, () => {});
  const attendees = await dbAll('SELECT certificate_path FROM session_attendees WHERE session_id = ?', [req.params.id]);
  for (const { certificate_path } of attendees) {
    if (certificate_path && fs.existsSync(certificate_path)) fs.unlink(certificate_path, () => {});
  }

  await dbRun('DELETE FROM training_sessions WHERE session_id = ?', [req.params.id]);
  res.status(204).end();
});

router.get('/:id/qrcode.png', async (req, res) => {
  const session = await dbGet('SELECT qr_token FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!session) return res.status(404).end();
  const buf = await qrPngBuffer(session.qr_token);
  res.set('Content-Type', 'image/png');
  res.send(buf);
});

router.get('/:id/feedback-qrcode.png', async (req, res) => {
  const session = await dbGet('SELECT qr_token FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!session) return res.status(404).end();
  const buf = await feedbackQrPngBuffer(session.qr_token);
  res.set('Content-Type', 'image/png');
  res.send(buf);
});

router.get('/:id/roster.pdf', async (req, res) => {
  const session = await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!session || !session.roster_pdf_path) {
    return res.status(404).json({ error: 'Roster PDF not available yet — close the session first' });
  }
  res.download(session.roster_pdf_path, `roster-${session.session_date}.pdf`);
});

router.get('/:sessionId/attendees/:attendeeId/certificate.pdf', async (req, res) => {
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [
    req.params.attendeeId,
    req.params.sessionId,
  ]);
  if (!attendee || !attendee.certificate_path) return res.status(404).json({ error: 'Certificate not available yet' });
  res.download(attendee.certificate_path, attendee.certificate_filename || 'certificate.pdf');
});

// Manual correction of a typo'd attendee entry (name/phone), while the session is still open.
router.patch('/:sessionId/attendees/:attendeeId', requireAdmin, async (req, res) => {
  const { trainee_name, trainee_phone } = req.body || {};
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [
    req.params.attendeeId,
    req.params.sessionId,
  ]);
  if (!attendee) return res.status(404).json({ error: 'Attendee not found' });
  await dbRun(
    'UPDATE session_attendees SET trainee_name = COALESCE(?, trainee_name), trainee_phone = COALESCE(?, trainee_phone) WHERE attendee_id = ?',
    [trainee_name || null, trainee_phone || null, attendee.attendee_id]
  );
  res.json(await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendee.attendee_id]));
});

// Remove a duplicate/mistaken sign-in - only while the session is still open (roster locks at close-out).
router.delete('/:sessionId/attendees/:attendeeId', requireAdmin, async (req, res) => {
  const session = await dbGet('SELECT status FROM training_sessions WHERE session_id = ?', [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'Session is closed; roster is locked' });
  }
  await dbRun('DELETE FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [req.params.attendeeId, req.params.sessionId]);
  res.json({ ok: true });
});

// Re-run the employee/training-record linkage for one attendee - useful if it failed, or if the
// session used a custom label that's since been added to the Master Training Catalog.
router.post('/:sessionId/attendees/:attendeeId/process', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'closed') return res.status(400).json({ error: 'Session must be closed first' });
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [
    req.params.attendeeId,
    req.params.sessionId,
  ]);
  if (!attendee) return res.status(404).json({ error: 'Attendee not found' });
  await processAttendee(session, attendee, attendee.certificate_path || null);
  res.json(await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendee.attendee_id]));
});

// CSV export of a session's roster.
router.get('/:id/roster.csv', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
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
