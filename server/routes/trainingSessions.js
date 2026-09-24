// Training Sign-In sessions - merged in from the standalone sign-in app (2026-08-19). Mounted
// under requireAuth in server/index.js like every other route here; individual mutating routes
// below additionally require requireAdmin, matching the rest of the app's convention.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('../lib/repo');
const { requireAdmin } = require('../middleware/auth');
const { qrPngBuffer, publicSignInUrl, feedbackQrPngBuffer, publicFeedbackUrl } = require('../lib/qr');
const { processAttendee, removeAttendee } = require('../lib/sessionRecords');
const { ensureEditToken, sessionEditUrl, regenerateRosters } = require('../lib/sessionCloseOut');
const { translateToSpanish } = require('../lib/translate');
const { buildCertificateFilename, buildRosterFilename, buildQrFilename } = require('../lib/certificateFilename');
const { listCertificateFiles, certificateZipName, createCertificateZip } = require('../lib/certificateZip');
const { logActivity } = require('../lib/activityLog');
const { generateCertificate } = require('../lib/pdfGen');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { parseName, firstLast } = require('../lib/names');
const fs = require('fs');

const router = express.Router();

const SESSION_LANGUAGES = ['english', 'spanish', 'both'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tokenGen() {
  return uuidv4().replace(/-/g, '').slice(0, 16);
}

// Translates a session's training name/outline to Spanish once, at save time, so the public
// sign-in page never calls the translation API itself (Keeley's design: cache the result, don't
// translate on every page view). If the call fails (e.g. DeepL is down or the API key becomes
// invalid), the session still saves with the Spanish text left blank and a warning surfaced to
// the admin - translation is a nice-to-have, never a reason to block saving the session.
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


const DAY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The actual calendar date scheduled for each day of a multi-day session (Keeley's request,
// 2026-09-22) - purely informational/display (shown alongside "Day X of Y"), never the real
// gate on attendance, which stays the trainer's own manual day-advance
// (server/migrations/055_multiday_sessions.sql's current_day) so a slipped day never misjudges
// who was actually present. `totalDays` may be null (a single-day session, or one being edited
// without touching total_days) - day_dates is only length-checked against it when both are set.
function validateDayDates(dayDates, totalDays) {
  if (dayDates === undefined || dayDates === null) return { dayDatesJson: null, error: null };
  if (!Array.isArray(dayDates) || dayDates.some((d) => typeof d !== 'string' || !DAY_DATE_PATTERN.test(d))) {
    return { dayDatesJson: null, error: 'day_dates must be a list of YYYY-MM-DD dates, one per day.' };
  }
  if (totalDays && dayDates.length !== totalDays) {
    return { dayDatesJson: null, error: `day_dates must have exactly ${totalDays} date(s) to match total_days.` };
  }
  return { dayDatesJson: JSON.stringify(dayDates), error: null };
}

// Per-day outline text (server/migrations/057_multiday_session_outlines.sql, Keeley's request,
// 2026-09-22) - "Day 1 has its own outline, day 2 and so on," shown to attendees instead of one
// blanket outline for the whole course. Same length-vs-total_days rule as day_dates, but no
// format check since it's free text.
function validateDayOutlines(dayOutlines, totalDays) {
  if (dayOutlines === undefined || dayOutlines === null) return { dayOutlinesJson: null, error: null };
  if (!Array.isArray(dayOutlines) || dayOutlines.some((o) => typeof o !== 'string')) {
    return { dayOutlinesJson: null, error: 'day_outlines must be a list of text, one per day.' };
  }
  if (totalDays && dayOutlines.length !== totalDays) {
    return { dayOutlinesJson: null, error: `day_outlines must have exactly ${totalDays} entries to match total_days.` };
  }
  return { dayOutlinesJson: JSON.stringify(dayOutlines), error: null };
}

// Parses day_dates/day_outlines back into plain arrays for API responses - raw session rows
// carry them as JSON strings (same TEXT-column convention as hs_course_options/hs_optional_topics).
function withParsedDayDates(session) {
  return {
    ...session,
    day_dates: session.day_dates ? JSON.parse(session.day_dates) : null,
    day_outlines: session.day_outlines ? JSON.parse(session.day_outlines) : null,
  };
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
  // Matches on the primary training OR one of a multi-training session's additional trainings
  // (server/migrations/045_multi_training_sessions.sql) - otherwise a session where this
  // training was taught, just not as the first one picked, would silently never show up here.
  const clauses = ['(ts.master_training_id = ? OR EXISTS (SELECT 1 FROM session_additional_trainings sat WHERE sat.session_id = ts.session_id AND sat.master_training_id = ?))'];
  const params = [req.params.trainingId, req.params.trainingId];
  if (client_id) { clauses.push('ts.client_id = ?'); params.push(client_id); }
  const rows = await dbAll(`${SESSION_WITH_CLIENT_SQL} WHERE ${clauses.join(' AND ')} ORDER BY ts.session_date DESC`, params);
  res.json(await Promise.all(rows.map(async (r) => ({ ...r, attendee_count: await attendeeCount(r.session_id) }))));
});

router.get('/:id', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
  const feedback = await dbAll('SELECT * FROM session_feedback WHERE session_id = ? ORDER BY submitted_at', [session.session_id]);
  // Extra trainings beyond the primary (server/migrations/045_multi_training_sessions.sql) -
  // each attendee's certificate/status for those lives in attendee_certificates since there can
  // be several, unlike the primary training's single certificate_path/processing_status columns.
  const additionalTrainings = await dbAll(
    'SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order',
    [session.session_id]
  );
  const additionalCerts = attendees.length
    ? await dbAll('SELECT * FROM attendee_certificates WHERE attendee_id = ANY(?)', [attendees.map((a) => a.attendee_id)])
    : [];
  // Per-day attendance for a multi-day session (server/migrations/055_multiday_sessions.sql) -
  // lets SessionDetail.jsx draw the "who made every day" matrix. Empty for every normal
  // single-day session (total_days is null), so this is a no-op query for the common case.
  const attendanceDays = session.total_days && attendees.length
    ? await dbAll('SELECT attendee_id, day_number FROM session_attendance_days WHERE session_id = ?', [session.session_id])
    : [];
  const attendeesWithCerts = attendees.map((a) => ({
    ...a,
    additional_certificates: additionalCerts.filter((c) => c.attendee_id === a.attendee_id),
    days_attended: attendanceDays.filter((d) => d.attendee_id === a.attendee_id).map((d) => d.day_number).sort((x, y) => x - y),
  }));
  res.json({
    ...withParsedDayDates(session),
    public_url: publicSignInUrl(session.qr_token),
    feedback_url: publicFeedbackUrl(session.qr_token),
    attendees: attendeesWithCerts,
    feedback,
    additional_trainings: additionalTrainings,
  });
});

// Every field is required to create a session (Keeley's call) - client, training type,
// trainer name, date, location, duration, and outline all need to be on file up front.
// Trainer Employee ID is the one exception: it's always optional, and a missing one is no
// longer flagged for review (Keeley's request, 2026-09-17) - it can still be added to the
// trainer's own profile later if it becomes available.
//
// Open to the plain 'user' role too (Keeley's request, 2026-09-16) - see the matching note on
// server/routes/clients.js's POST /.
router.post('/', async (req, res) => {
  const {
    client_name, master_training_id, training_type_label, trainer_name, trainer_phone,
    session_date, outline, location, duration, language = 'english', additional_trainings = [],
    total_days = null, day_dates = null, day_outlines = null,
  } = req.body || {};
  if (!client_name || !training_type_label || !trainer_name || !session_date || !location || !duration || !outline) {
    return res.status(400).json({
      error: 'client_name, training_type_label, trainer_name, session_date, location, duration, and outline are all required',
    });
  }
  if (!Array.isArray(additional_trainings) || additional_trainings.some((t) => !t?.training_type_label)) {
    return res.status(400).json({ error: 'additional_trainings must be a list of {master_training_id, training_type_label}' });
  }
  if (!SESSION_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${SESSION_LANGUAGES.join(', ')}` });
  }
  // A multi-day course - one session, one QR code, used across every day (Keeley's request,
  // 2026-09-21). Left null for the overwhelming majority (single-day) sessions, which behave
  // exactly as before; 1 is treated the same as null (no meaningful "multi-day" below 2).
  const totalDays = total_days ? Number(total_days) : null;
  if (totalDays !== null && (!Number.isInteger(totalDays) || totalDays < 2)) {
    return res.status(400).json({ error: 'total_days must be a whole number of 2 or more.' });
  }
  const { dayDatesJson, error: dayDatesError } = validateDayDates(day_dates, totalDays);
  if (dayDatesError) return res.status(400).json({ error: dayDatesError });
  const { dayOutlinesJson, error: dayOutlinesError } = validateDayOutlines(day_outlines, totalDays);
  if (dayOutlinesError) return res.status(400).json({ error: dayOutlinesError });
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
       (session_id, qr_token, client_id, master_training_id, training_type_label, trainer_name, trainer_phone, trainer_employee_id, session_date, outline, location, duration, created_by, language, training_type_label_es, outline_es, total_days, day_dates, day_outlines)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      totalDays,
      dayDatesJson,
      dayOutlinesJson,
    ]
  );
  // Extra trainings taught in the same session (server/migrations/045_multi_training_sessions.sql)
  // - each just needs its own row; no translation/outline of its own since they all share the
  // one session-level outline typed above.
  for (let i = 0; i < additional_trainings.length; i += 1) {
    const t = additional_trainings[i];
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `INSERT INTO session_additional_trainings (id, session_id, master_training_id, training_type_label, display_order)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), session_id, t.master_training_id || null, t.training_type_label, i]
    );
  }

  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [session_id]);
  logActivity({
    actor: req.user, action: 'session_created', entityType: 'training_session', entityId: session_id,
    entityLabel: `${training_type_label} · ${client_name}`,
    details: additional_trainings.length ? `+${additional_trainings.length} additional training(s)` : undefined,
    req,
  });
  res.status(201).json({ ...withParsedDayDates(session), public_url: publicSignInUrl(qr_token), translation_warning: warning });
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
  if (!SESSION_LANGUAGES.includes(merged.language)) {
    return res.status(400).json({ error: `language must be one of: ${SESSION_LANGUAGES.join(', ')}` });
  }
  // Same total_days rule as creation (POST / above) - null/1 both mean "not multi-day".
  // req.body.total_days is checked directly (not `merged.total_days`) so leaving the field out
  // of the request entirely keeps the session's existing value, matching every other field here.
  let totalDays = existing.total_days;
  if (Object.prototype.hasOwnProperty.call(req.body, 'total_days')) {
    totalDays = req.body.total_days ? Number(req.body.total_days) : null;
    if (totalDays !== null && (!Number.isInteger(totalDays) || totalDays < 2)) {
      return res.status(400).json({ error: 'total_days must be a whole number of 2 or more.' });
    }
  }
  // Same "leave the field out to keep the existing value" rule as total_days above.
  let dayDatesJson = existing.day_dates;
  if (Object.prototype.hasOwnProperty.call(req.body, 'day_dates')) {
    const result = validateDayDates(req.body.day_dates, totalDays);
    if (result.error) return res.status(400).json({ error: result.error });
    dayDatesJson = result.dayDatesJson;
  }
  let dayOutlinesJson = existing.day_outlines;
  if (Object.prototype.hasOwnProperty.call(req.body, 'day_outlines')) {
    const result = validateDayOutlines(req.body.day_outlines, totalDays);
    if (result.error) return res.status(400).json({ error: result.error });
    dayOutlinesJson = result.dayOutlinesJson;
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
         session_date=?, outline=?, location=?, duration=?, language=?, training_type_label_es=?, outline_es=?, total_days=?, day_dates=?, day_outlines=?
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
      totalDays,
      dayDatesJson,
      dayOutlinesJson,
      req.params.id,
    ]
  );
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  logActivity({
    actor: req.user, action: 'session_updated', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, req,
  });
  res.json({ ...withParsedDayDates(session), translation_warning: warning });
});

// Two independent fulfillment checkboxes (Keeley's request, 2026-09-21) - whether this
// session's roster/certs were sent to the client and/or saved to the server. Deliberately its
// own lightweight endpoint rather than folded into the "Edit Session Details" PUT above, since
// that one requires the full set of session fields and these two flags need to be toggleable on
// their own from both the session page and (eventually) the list.
router.patch('/:id/fulfillment', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT session_id FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  const { sent_to_client, saved_to_server } = req.body || {};
  await dbRun(
    `UPDATE training_sessions SET
       sent_to_client = COALESCE(?, sent_to_client),
       saved_to_server = COALESCE(?, saved_to_server)
     WHERE session_id = ?`,
    [
      sent_to_client === undefined ? null : (sent_to_client ? 1 : 0),
      saved_to_server === undefined ? null : (saved_to_server ? 1 : 0),
      req.params.id,
    ]
  );
  res.json(await dbGet('SELECT sent_to_client, saved_to_server FROM training_sessions WHERE session_id = ?', [req.params.id]));
});

// The trainer/admin advances a multi-day session to the next day (Keeley's request, 2026-09-21) -
// deliberately manual rather than calendar-driven, so a course that slips a day (weather, a
// holiday) doesn't misjudge who was actually present. New sign-ins and "find your name" check-ins
// always attach to whatever current_day is at the moment they happen (server/routes/
// publicSessions.js), so advancing here is what actually opens the next day for attendance.
router.post('/:id/advance-day', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.total_days) return res.status(400).json({ error: 'This is not a multi-day session.' });
  if (session.status === 'closed') return res.status(400).json({ error: 'This session is already closed.' });
  if (session.current_day >= session.total_days) {
    return res.status(400).json({ error: `Already on the final day (Day ${session.total_days}).` });
  }
  const nextDay = session.current_day + 1;
  await dbRun('UPDATE training_sessions SET current_day = ? WHERE session_id = ?', [nextDay, req.params.id]);
  logActivity({
    actor: req.user, action: 'session_day_advanced', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: `Day ${nextDay} of ${session.total_days}`, req,
  });
  res.json({ current_day: nextDay, total_days: session.total_days });
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
  logActivity({
    actor: req.user, action: 'session_deleted', entityType: 'training_session', entityId: req.params.id,
    entityLabel: existing.training_type_label, req,
  });
  res.status(204).end();
});

// Logs a "copied link" activity from the client's Copy button (SessionDetail.jsx) - the sign-in/
// feedback URLs themselves are static and computable client-side, so this endpoint has no other
// purpose than recording that someone did it (Keeley's request, 2026-09-17).
router.post('/:id/log-link-copied', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const linkType = req.body?.link_type === 'feedback' ? 'Feedback' : 'Sign-In';
  logActivity({
    actor: req.user, action: 'session_link_copied', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: `${linkType} link`, req,
  });
  res.json({ ok: true });
});

router.get('/:id/qrcode.png', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).end();
  const buf = await qrPngBuffer(session.qr_token);
  logActivity({
    actor: req.user, action: 'qr_code_downloaded', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: 'Sign-In QR', req,
  });
  res.set('Content-Type', 'image/png');
  // 'inline' (not 'attachment') so the <img> preview on SessionDetail.jsx still renders normally -
  // only the filename suggestion changes, which is all the <a download> link there needs.
  res.set('Content-Disposition', `inline; filename="${buildQrFilename(session, 'Sign-In QR')}"`);
  res.send(buf);
});

router.get('/:id/feedback-qrcode.png', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).end();
  const buf = await feedbackQrPngBuffer(session.qr_token);
  logActivity({
    actor: req.user, action: 'qr_code_downloaded', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: 'Feedback QR', req,
  });
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `inline; filename="${buildQrFilename(session, 'Feedback QR')}"`);
  res.send(buf);
});

router.get('/:id/roster.pdf', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session || !session.roster_pdf_path) {
    return res.status(404).json({ error: 'Roster PDF not available yet — close the session first' });
  }
  logActivity({
    actor: req.user, action: 'roster_downloaded', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: 'PDF', req,
  });
  res.download(session.roster_pdf_path, buildRosterFilename(session, 'pdf'));
});

// The official AHA Heartsaver Course Roster (Keeley's request, 2026-09-21) - only ever
// populated for First Aid/CPR/AED (TRN-020) sessions; see server/lib/ahaRoster.js.
router.get('/:id/aha-roster.pdf', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session || !session.hs_roster_pdf_path) {
    return res.status(404).json({ error: 'AHA roster not available yet — close the session first' });
  }
  logActivity({
    actor: req.user, action: 'aha_roster_downloaded', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, req,
  });
  res.download(session.hs_roster_pdf_path, buildRosterFilename(session, 'pdf').replace('.pdf', '_AHA-Roster.pdf'));
});

router.get('/:sessionId/attendees/:attendeeId/certificate.pdf', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [
    req.params.attendeeId,
    req.params.sessionId,
  ]);
  if (!attendee || !attendee.certificate_path) return res.status(404).json({ error: 'Certificate not available yet' });
  logActivity({
    actor: req.user, action: 'certificate_downloaded', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: attendee.trainee_name, req,
  });
  // Computed fresh rather than using the stored certificate_filename column (Keeley's request,
  // 2026-09-16: "Training Title_Client_Trainer_Date_Trainee Name") - this way every download,
  // including a certificate generated before that request, gets the current naming convention
  // without needing to regenerate the PDF itself.
  res.download(attendee.certificate_path, buildCertificateFilename(session, attendee));
});

// Same as the primary certificate download above, for one *additional* training on a
// multi-training session (server/migrations/045_multi_training_sessions.sql).
router.get('/:sessionId/attendees/:attendeeId/additional-certificates/:certId.pdf', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const cert = await dbGet(
    `SELECT ac.*, sa.trainee_name, sat.training_type_label
     FROM attendee_certificates ac
     JOIN session_attendees sa ON sa.attendee_id = ac.attendee_id
     JOIN session_additional_trainings sat ON sat.id = ac.session_additional_training_id
     WHERE ac.id = ? AND ac.attendee_id = ? AND sa.session_id = ?`,
    [req.params.certId, req.params.attendeeId, req.params.sessionId]
  );
  if (!cert || !cert.certificate_path) return res.status(404).json({ error: 'Certificate not available yet' });
  logActivity({
    actor: req.user, action: 'certificate_downloaded', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${cert.training_type_label} · ${session.client_name}`, details: cert.trainee_name, req,
  });
  const trainingSession = { ...session, training_type_label: cert.training_type_label };
  res.download(cert.certificate_path, buildCertificateFilename(trainingSession, cert));
});

// One ZIP per training (Keeley's request, 2026-09-17: a session covering 2+ trainings hands out
// a separate batch per training rather than one zip mixing certificate types) - `?training=`
// selects which: 'primary' for the session's own training, or a session_additional_trainings id
// for one of the extras. A plain single-training session (no additional trainings) can omit the
// query param entirely and gets the one training it has, same as the old single-zip behavior.
// Only ever includes attendees who actually have a certificate on file (skips anyone whose
// generation failed, rather than erroring the whole download over one bad row).
router.get('/:sessionId/certificates.zip', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const additionalTrainings = await dbAll(
    'SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order',
    [session.session_id]
  );
  const trainingKey = req.query.training || (additionalTrainings.length === 0 ? 'primary' : null);
  if (!trainingKey) {
    return res.status(400).json({ error: 'This session covers multiple trainings - choose which one to download.' });
  }

  let training = null;
  if (trainingKey !== 'primary') {
    training = additionalTrainings.find((t) => t.id === trainingKey);
    if (!training) return res.status(404).json({ error: 'Training not found on this session.' });
  }
  const trainingLabel = training ? training.training_type_label : session.training_type_label;
  const files = await listCertificateFiles(session, training);

  if (files.length === 0) {
    return res.status(404).json({ error: 'No certificates available yet - close the session first.' });
  }

  logActivity({
    actor: req.user, action: 'certificates_zip_downloaded', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${trainingLabel} · ${session.client_name}`, details: `${files.length} certificate(s)`, req,
  });

  const zipName = certificateZipName(session, trainingLabel);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`);

  const archive = createCertificateZip(files);
  archive.on('error', (err) => {
    // Headers are already sent by the time archiver can fail mid-stream, so the best that can be
    // done is end the response - a JSON error body here would just corrupt the partial zip.
    console.error(`Certificate ZIP failed for session ${session.session_id}:`, err);
    res.end();
  });
  archive.pipe(res);
  await archive.finalize();
});

// Manually add a missed attendee to the roster (Keeley's request, 2026-09-22) - works whether the
// session is still open or already closed. A closed session's roster used to be permanently
// locked to new entries (only removal was ever allowed, below) - this is the one deliberate way
// back in, for someone who genuinely attended but never signed in at the kiosk. Signature is
// optional here (migration 059) since there's often no live signature to capture after the fact.
// Immediately runs the same certificate/employee-linkage step the close-out itself uses when the
// session is already closed, and regenerates the combined roster PDF (and the AHA roster, for a
// First Aid/CPR/AED session) so the newly-added person shows up on both right away. Doesn't
// extend to a session's *additional* trainings (server/migrations/045_multi_training_sessions.sql)
// - a rare-enough compounding edge case (multi-training session + a manual add after close) that
// it's left for a manual Retry-style follow-up rather than adding here.
router.post('/:sessionId/attendees', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { trainee_phone, trainee_job_title, trainee_email, signature } = req.body || {};
  // First/last parts (server/lib/names.js), with a single combined name still accepted.
  let traineeFirst = String(req.body?.trainee_first_name || '').trim();
  let traineeLast = String(req.body?.trainee_last_name || '').trim();
  if (!traineeFirst && !traineeLast) ({ first: traineeFirst, last: traineeLast } = parseName(req.body?.trainee_name));
  const trainee_name = firstLast(traineeFirst, traineeLast);
  if (!trainee_name) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (trainee_phone && !isValidPhoneNumber(trainee_phone)) {
    return res.status(400).json({ error: 'Please enter a standard 10-digit phone number.' });
  }
  if (trainee_email && !EMAIL_PATTERN.test(trainee_email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const attendee_id = uuidv4();
  await dbRun(
    `INSERT INTO session_attendees (attendee_id, session_id, trainee_name, trainee_first_name, trainee_last_name, trainee_phone, trainee_job_title, trainee_email, signature, added_by_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      attendee_id,
      session.session_id,
      trainee_name,
      traineeFirst || null,
      traineeLast || null,
      trainee_phone ? formatPhoneNumber(trainee_phone) : null,
      trainee_job_title ? trainee_job_title.trim() : null,
      trainee_email ? trainee_email.trim().toLowerCase() : null,
      signature || null,
    ]
  );

  if (session.status === 'closed') {
    const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendee_id]);

    // Multi-day session (server/migrations/055_multiday_sessions.sql): someone added after the
    // fact has zero recorded attendance days on file, so the same full-attendance gate the close
    // route itself applies correctly leaves them incomplete unless total_days is unset.
    let eligible = true;
    if (session.total_days) {
      const { n } = await dbGet(
        'SELECT COUNT(DISTINCT day_number) AS n FROM session_attendance_days WHERE session_id = ? AND attendee_id = ?',
        [session.session_id, attendee_id]
      );
      eligible = Number(n) >= session.total_days;
    }
    if (!eligible) {
      await dbRun(
        `UPDATE session_attendees SET processing_status = 'incomplete_attendance', processing_error = ? WHERE attendee_id = ?`,
        ['Added after the session closed with no recorded attendance days on file.', attendee_id]
      );
    } else {
      let certPath = null;
      try {
        certPath = await generateCertificate(session, attendee);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Certificate generation failed for manually-added attendee ${attendee_id}:`, err);
      }
      await processAttendee(session, attendee, certPath);
    }

    // Regenerate the combined roster (and AHA roster, if applicable) so the new attendee shows
    // up on both right away, same generation the close route itself uses.
    const allAttendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
    const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
    await regenerateRosters(session, allAttendees, additionalTrainings);
  }

  logActivity({
    actor: req.user, action: 'attendee_added_manually', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: trainee_name.trim(), req,
  });
  res.status(201).json(await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendee_id]));
});

// Manual correction of a typo'd attendee entry (name/phone/email), while the session is still open.
router.patch('/:sessionId/attendees/:attendeeId', requireAdmin, async (req, res) => {
  const { trainee_name, trainee_phone, trainee_email } = req.body || {};
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [
    req.params.attendeeId,
    req.params.sessionId,
  ]);
  if (!attendee) return res.status(404).json({ error: 'Attendee not found' });
  await dbRun(
    'UPDATE session_attendees SET trainee_name = COALESCE(?, trainee_name), trainee_phone = COALESCE(?, trainee_phone), trainee_email = COALESCE(?, trainee_email) WHERE attendee_id = ?',
    [trainee_name || null, trainee_phone || null, trainee_email || null, attendee.attendee_id]
  );
  res.json(await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendee.attendee_id]));
});

// Remove a duplicate/mistaken sign-in. Allowed after close-out too (Keeley's request,
// 2026-09-24) - removeAttendee also deletes the certificate and employee-file training record that
// sign-in produced, and the rosters are rebuilt so it drops off them.
router.delete('/:sessionId/attendees/:attendeeId', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const removed = await removeAttendee(session.session_id, req.params.attendeeId);
  if (!removed) return res.status(404).json({ error: 'Attendee not found' });
  if (session.status === 'closed') {
    const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
    const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
    await regenerateRosters(session, attendees, additionalTrainings);
  }
  logActivity({
    actor: req.user, action: 'attendee_removed', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: removed.trainee_name, req,
  });
  res.json({ ok: true });
});

// The trainer's "Edit close-out details" link (the same one emailed at close-out) - for an admin
// to pass along, including for sessions closed before the link existed, which get one here.
router.post('/:id/edit-link', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'closed') return res.status(400).json({ error: 'The edit link is only available after the session is closed.' });
  const editToken = await ensureEditToken(session.session_id);
  logActivity({
    actor: req.user, action: 'session_link_copied', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: 'trainer edit', req,
  });
  // `path` lets the page build the link on whatever site it's open on (localhost while testing);
  // `url` is the public one the close-out email uses.
  res.json({ url: sessionEditUrl(editToken), path: `/session-edit/${editToken}` });
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
    'Trainee Email',
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
        a.trainee_email,
        a.signed_at,
        a.processing_status,
      ]
        .map(esc)
        .join(',')
    );
  }
  logActivity({
    actor: req.user, action: 'roster_downloaded', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: 'CSV', req,
  });
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', `attachment; filename="${buildRosterFilename(session, 'csv')}"`);
  res.send(lines.join('\n'));
});

module.exports = router;
