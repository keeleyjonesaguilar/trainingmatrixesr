// Training Sign-In sessions - merged in from the standalone sign-in app (2026-08-19). Mounted
// under requireAuth in server/index.js like every other route here; individual mutating routes
// below additionally require requireAdmin, matching the rest of the app's convention.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun, withTransaction } = require('../db');
const repo = require('../lib/repo');
const { requireAdmin } = require('../middleware/auth');
const { qrPngBuffer, publicSignInUrl, feedbackQrPngBuffer, publicFeedbackUrl } = require('../lib/qr');
const { processAttendee, removeAttendee } = require('../lib/sessionRecords');
const { ensureEditToken, sessionEditUrl, regenerateRosters } = require('../lib/sessionCloseOut');
const { saveDayTrainers, getSessionDays, clearDaySignoff, getCoTrainers, saveCoTrainers } = require('../lib/sessionDays');
const { translateToSpanish } = require('../lib/translate');
const { buildCertificateFilename, buildRosterFilename, buildQrFilename } = require('../lib/certificateFilename');
const { listCertificateFiles, certificateZipName, createCertificateZip } = require('../lib/certificateZip');
const { logActivity } = require('../lib/activityLog');
const { insertManualAttendee, certifyAfterClose, certifyTrainingParts } = require('../lib/lateAttendees');
const { isMultiDay, isMultiTrainingDay, trainingParts } = require('../lib/sessionParts');
const { startPrep, savePrep, sendTrainerSummary, PREP_LABELS, isInternalTrainer } = require('../lib/sessionPrep');
const { totalDuration } = require('../lib/durations');

// A session with per-training durations: `duration` is the total of them all (migration 078,
// Keeley's report, 2026-10-07) - recalculated whenever any of them changes.
async function recalcTotalDuration(sessionId) {
  const s = await dbGet('SELECT first_training_duration, duration FROM training_sessions WHERE session_id = ?', [sessionId]);
  if (!s || !s.first_training_duration) return;
  const extras = await dbAll('SELECT duration FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const total = totalDuration([s.first_training_duration, ...extras.map((t) => t.duration)]);
  if (total && total !== s.duration) await dbRun('UPDATE training_sessions SET duration = ? WHERE session_id = ?', [total, sessionId]);
}

// The WeTransfer link typed on the session form (Keeley's request, 2026-10-07): a web address or blank.
function cleanWetransferLink(value) {
  const link = String(value || '').trim();
  if (!link) return { link: null };
  return /^https?:\/\/\S+$/i.test(link) ? { link } : { error: 'The WeTransfer link should start with https://' };
}

// Session prep (lib/sessionPrep.js) never blocks saving a session - a failure is only logged.
async function startPrepSafely(sessionRow, opts) {
  try {
    return await startPrep(sessionRow, opts);
  } catch (err) {
    console.error(`Session prep could not start for ${sessionRow.session_id}:`, err); // eslint-disable-line no-console
    return false;
  }
}
const { isValidPhoneNumber } = require('../lib/phone');
const { parseName, firstLast } = require('../lib/names');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

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

const SESSION_WITH_CLIENT_SQL = `
  SELECT ts.*, c.client_name
  FROM training_sessions ts
  JOIN clients c ON c.client_id = ts.client_id
`;

// Session lists (2026-10-01, speed): the attendee count comes from the same query instead of one
// extra query per session, and signature images are left out - no list shows them, and they made
// the list several hundred KB that only grows. The full session page (GET /:id) still has them.
//
// Also every trainer who taught (lead, each multi-day day's trainer, co-trainers - Keeley's report,
// 2026-10-05: an OSHA 30 listed only the trainer who closed it) and every training covered, as
// names for the list and as ids for its Training/Trainer filters.
const SESSION_LIST_SQL = `
  SELECT ts.*, c.client_name,
    (SELECT COUNT(*) FROM session_attendees sa WHERE sa.session_id = ts.session_id) AS attendee_count,
    (SELECT string_agg(ct.trainer_name, ', ' ORDER BY ct.display_order) FROM session_co_trainers ct WHERE ct.session_id = ts.session_id) AS co_trainer_names,
    (SELECT json_agg(json_build_object('name', ct.trainer_name, 'id', ct.trainer_employee_id) ORDER BY ct.display_order) FROM session_co_trainers ct WHERE ct.session_id = ts.session_id) AS co_trainer_list,
    (SELECT json_agg(json_build_object(
        'name', COALESCE(sd.signed_trainer_name, sd.assigned_trainer_name),
        'id', CASE WHEN sd.signed_trainer_name IS NOT NULL THEN sd.signed_trainer_employee_id ELSE sd.assigned_trainer_employee_id END,
        'assigned_id', sd.assigned_trainer_employee_id) ORDER BY sd.day_number)
     FROM session_days sd WHERE sd.session_id = ts.session_id AND sd.day_number <= COALESCE(ts.total_days, 0)) AS day_trainer_list,
    (SELECT json_agg(json_build_object('label', sat.training_type_label, 'id', sat.master_training_id) ORDER BY sat.display_order)
     FROM session_additional_trainings sat WHERE sat.session_id = ts.session_id) AS additional_training_list
  FROM training_sessions ts
  JOIN clients c ON c.client_id = ts.client_id
`;
function withoutSignatures(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!k.endsWith('signature')) out[k] = v;
  return out;
}

const nameKeyOf = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

// One list row: the session plus `trainer_names` (everyone who taught, no repeats, in the order
// they taught), `trainer_ids` and `training_ids` for the filters, and the extra trainings' names.
function listRow(r) {
  const out = withoutSignatures(r);
  delete out.co_trainer_list;
  delete out.day_trainer_list;
  delete out.additional_training_list;
  const days = isMultiDay(r) ? r.day_trainer_list || [] : [];
  const co = r.co_trainer_list || [];
  const people = [
    ...(days.length ? days : [{ name: r.trainer_signed_name || r.trainer_name, id: r.trainer_employee_id }]),
    ...co,
  ];
  const names = [];
  const seen = new Set();
  for (const p of people) {
    const key = nameKeyOf(p.name);
    if (!key || seen.has(key)) continue; // eslint-disable-line no-continue
    seen.add(key);
    names.push(p.name);
  }
  const extras = r.additional_training_list || [];
  return {
    ...out,
    attendee_count: Number(r.attendee_count),
    trainer_names: names.join(', '),
    trainer_name_list: names,
    trainer_ids: [...new Set([r.trainer_employee_id, ...days.flatMap((d) => [d.id, d.assigned_id]), ...co.map((t) => t.id)].filter(Boolean))],
    training_ids: [...new Set([r.master_training_id, ...extras.map((t) => t.id)].filter(Boolean))],
    additional_training_labels: extras.map((t) => t.label),
  };
}

// List sessions, optionally filtered by client_id (exact - used for cross-links from a client's
// own page), client_name (fuzzy - used by the filter box on the Sessions list), training, or status.
router.get('/', async (req, res) => {
  const { client_id, client_name, master_training_id, status, trainer_employee_id } = req.query;
  const clauses = [];
  const params = [];
  if (client_id) { clauses.push('ts.client_id = ?'); params.push(client_id); }
  // Case-insensitive (Keeley's report, 2026-09-30: "brady" found nothing - Postgres LIKE is case-sensitive).
  if (client_name) { clauses.push('c.client_name ILIKE ?'); params.push(`%${client_name}%`); }
  if (master_training_id) { clauses.push('ts.master_training_id = ?'); params.push(master_training_id); }
  if (status) { clauses.push('ts.status = ?'); params.push(status); }
  // Feeds a Trainer's own "Trainings Taught" section on their profile.
  // A multi-day session counts for every trainer who was assigned or signed off one of its days.
  if (trainer_employee_id) {
    clauses.push(`(ts.trainer_employee_id = ? OR EXISTS (SELECT 1 FROM session_days sd WHERE sd.session_id = ts.session_id
                   AND (sd.assigned_trainer_employee_id = ? OR sd.signed_trainer_employee_id = ?))
                   OR EXISTS (SELECT 1 FROM session_co_trainers ct WHERE ct.session_id = ts.session_id AND ct.trainer_employee_id = ?))`);
    params.push(trainer_employee_id, trainer_employee_id, trainer_employee_id, trainer_employee_id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await dbAll(`${SESSION_LIST_SQL} ${where} ORDER BY ts.session_date DESC, ts.created_at DESC`, params);
  res.json(rows.map(listRow));
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
  const rows = await dbAll(`${SESSION_LIST_SQL} WHERE ${clauses.join(' AND ')} ORDER BY ts.session_date DESC`, params);
  res.json(rows.map(listRow));
});

router.get('/:id', async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
  const feedbackRows = await dbAll('SELECT * FROM session_feedback WHERE session_id = ? ORDER BY submitted_at', [session.session_id]);
  // Each response's rating/comment per trainer (migration 074) - empty for feedback from before then.
  const trainerRatings = feedbackRows.length
    ? await dbAll('SELECT * FROM session_feedback_trainers WHERE feedback_id = ANY(?) ORDER BY trainer_name', [feedbackRows.map((f) => f.feedback_id)])
    : [];
  const feedback = feedbackRows.map((f) => ({ ...f, trainer_ratings: trainerRatings.filter((t) => t.feedback_id === f.feedback_id) }));
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
    ? await dbAll('SELECT attendee_id, day_number, marked_by FROM session_attendance_days WHERE session_id = ?', [session.session_id])
    : [];
  const attendeesWithCerts = attendees.map((a) => ({
    ...a,
    additional_certificates: additionalCerts.filter((c) => c.attendee_id === a.attendee_id),
    days_attended: attendanceDays.filter((d) => d.attendee_id === a.attendee_id).map((d) => d.day_number).sort((x, y) => x - y),
    // Days the office marked present instead of the trainee signing in (migration 073).
    days_marked_by_office: attendanceDays.filter((d) => d.attendee_id === a.attendee_id && d.marked_by).map((d) => d.day_number),
  }));
  res.json({
    ...withParsedDayDates(session),
    public_url: publicSignInUrl(session.qr_token),
    feedback_url: publicFeedbackUrl(session.qr_token),
    attendees: attendeesWithCerts,
    feedback,
    additional_trainings: additionalTrainings,
    days: await getSessionDays(session),
    co_trainers: await getCoTrainers(session.session_id),
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
    total_days = null, day_dates = null, day_outlines = null, day_trainers = null, separate_checkins = false,
    session_kind = 'training', toolbox_topic = null, co_trainer_ids = [], wetransfer_link = null,
  } = req.body || {};
  // A toolbox talk (Keeley's request, 2026-09-30): a Topic instead of a catalog training, filed
  // under the catalog's "Toolbox Talk" entry; outline/duration optional; never multi-day.
  const isToolbox = session_kind === 'toolbox_talk';
  let toolboxTrainingId = null;
  if (isToolbox) {
    if (!String(toolbox_topic || '').trim()) return res.status(400).json({ error: 'A topic is required for a toolbox talk.' });
    const toolbox = await dbGet("SELECT training_id FROM master_trainings WHERE LOWER(training_name) = 'toolbox talk' ORDER BY training_id LIMIT 1", []);
    if (!toolbox) return res.status(400).json({ error: 'The catalog has no "Toolbox Talk" training to file these under.' });
    toolboxTrainingId = toolbox.training_id;
  }
  const topic = isToolbox ? String(toolbox_topic).trim() : null;
  const effective = isToolbox
    ? {
      master_training_id: toolboxTrainingId,
      training_type_label: `Toolbox Talk: ${topic}`,
      outline: String(outline || '').trim() || topic,
      duration: String(duration || '').trim() || '15 minutes',
    }
    : { master_training_id, training_type_label, outline, duration };
  if (!client_name || !effective.training_type_label || !trainer_name || !session_date || !location || !effective.duration || !effective.outline) {
    return res.status(400).json({
      error: 'client_name, training_type_label, trainer_name, session_date, location, duration, and outline are all required',
    });
  }
  if (isToolbox && (total_days || (Array.isArray(additional_trainings) && additional_trainings.length))) {
    return res.status(400).json({ error: 'A toolbox talk is a single session - no extra days or additional trainings.' });
  }
  if (!Array.isArray(additional_trainings) || additional_trainings.some((t) => !t?.training_type_label)) {
    return res.status(400).json({ error: 'additional_trainings must be a list of {master_training_id, training_type_label}' });
  }
  // 2+ trainings: each has its own duration (Keeley's request, 2026-10-05). Only when the office
  // ticks "check in separately for each training" (Keeley's request, 2026-10-06 - off unless
  // ticked) is it a Multi Training Day (migration 075), where attendees scan the QR code again for
  // each training; otherwise one sign-in covers every training, as it did before.
  const hasExtras = !isToolbox && additional_trainings.length > 0;
  const multiTraining = hasExtras && separate_checkins === true;
  if (multiTraining && total_days) {
    return res.status(400).json({ error: 'A Multi Training Day is a single day - turn off multi-day, or teach one training per session.' });
  }
  if (hasExtras && additional_trainings.some((t) => !String(t.duration || '').trim())) {
    return res.status(400).json({ error: 'Enter a duration for every training.' });
  }
  if (!SESSION_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${SESSION_LANGUAGES.join(', ')}` });
  }
  const wetransfer = cleanWetransferLink(wetransfer_link);
  if (wetransfer.error) return res.status(400).json({ error: wetransfer.error });
  // A multi-day course - one session, one QR code, used across every day (Keeley's request,
  // 2026-09-21). Left null for the overwhelming majority (single-day) sessions, which behave
  // exactly as before; 1 is treated the same as null (no meaningful "multi-day" below 2).
  const totalDays = multiTraining ? 1 + additional_trainings.length : (total_days ? Number(total_days) : null);
  if (totalDays !== null && (!Number.isInteger(totalDays) || totalDays < 2)) {
    return res.status(400).json({ error: 'total_days must be a whole number of 2 or more.' });
  }
  const { dayDatesJson, error: dayDatesError } = multiTraining ? { dayDatesJson: null } : validateDayDates(day_dates, totalDays);
  if (dayDatesError) return res.status(400).json({ error: dayDatesError });
  const { dayOutlinesJson, error: dayOutlinesError } = multiTraining ? { dayOutlinesJson: null } : validateDayOutlines(day_outlines, totalDays);
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
  // Required when an Internal trainer is on it - lead, co-trainer, or a day's trainer (Keeley's
  // call, 2026-10-07); optional for outside trainers and toolbox talks.
  if (!isToolbox && !wetransfer.link) {
    const trainerIds = [trainerEmployeeId, ...(Array.isArray(co_trainer_ids) ? co_trainer_ids : []), ...(Array.isArray(day_trainers) ? day_trainers : [])];
    for (const id of trainerIds.filter(Boolean)) {
      // eslint-disable-next-line no-await-in-loop
      if (await isInternalTrainer(id)) return res.status(400).json({ error: 'A WeTransfer link is required when an internal trainer is assigned.' });
    }
  }
  const { training_type_label_es, outline_es, warning } = await translateSessionFields(effective.training_type_label, effective.outline, language);
  const session_id = uuidv4();
  const qr_token = tokenGen();
  await dbRun(
    `INSERT INTO training_sessions
       (session_id, qr_token, client_id, master_training_id, training_type_label, trainer_name, trainer_phone, trainer_employee_id, session_date, outline, location, duration, created_by, language, training_type_label_es, outline_es, total_days, day_dates, day_outlines, session_kind, toolbox_topic, multi_training_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session_id,
      qr_token,
      clientId,
      effective.master_training_id || null,
      effective.training_type_label,
      trainer_name,
      trainer_phone ? trainer_phone.trim() : null,
      trainerEmployeeId,
      session_date,
      effective.outline,
      location,
      effective.duration,
      req.user.username,
      language,
      training_type_label_es,
      outline_es,
      totalDays,
      dayDatesJson,
      dayOutlinesJson,
      isToolbox ? 'toolbox_talk' : 'training',
      topic,
      multiTraining ? 1 : 0,
    ]
  );
  // Extra trainings taught in the same session (server/migrations/045_multi_training_sessions.sql)
  // - each just needs its own row; no translation/outline of its own since they all share the
  // one session-level outline typed above.
  for (let i = 0; i < additional_trainings.length; i += 1) {
    const t = additional_trainings[i];
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `INSERT INTO session_additional_trainings (id, session_id, master_training_id, training_type_label, display_order, duration)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), session_id, t.master_training_id || null, t.training_type_label, i, String(t.duration || '').trim() || null]
    );
  }

  // Each day's trainer (lib/sessionDays.js) - a blank entry means the session's own trainer.
  if (totalDays && !multiTraining) {
    await saveDayTrainers(await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [session_id]), day_trainers);
  }
  // Other trainers teaching alongside the lead trainer (migration 074, Keeley's request, 2026-10-01).
  if (Array.isArray(co_trainer_ids) && co_trainer_ids.length) {
    await saveCoTrainers(await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [session_id]), co_trainer_ids);
  }
  if (wetransfer.link) await dbRun('UPDATE training_sessions SET wetransfer_link = ? WHERE session_id = ?', [wetransfer.link, session_id]);
  // 2+ trainings with their own durations: keep the first training's own, and the total as `duration`.
  if (hasExtras) {
    const first = String(req.body.first_training_duration || effective.duration || '').trim();
    await dbRun('UPDATE training_sessions SET first_training_duration = ? WHERE session_id = ?', [first, session_id]);
    await recalcTotalDuration(session_id);
  }
  // One of our own trainers -> the prep team is emailed to add the class details (lib/sessionPrep.js).
  await startPrepSafely(await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [session_id]));

  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [session_id]);
  logActivity({
    actor: req.user, action: 'session_created', entityType: 'training_session', entityId: session_id,
    entityLabel: `${effective.training_type_label} · ${client_name}`,
    details: additional_trainings.length
      ? `${multiTraining ? 'Multi Training Day' : 'One sign-in'}: ${1 + additional_trainings.length} trainings`
      : undefined,
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
  if (existing.session_kind === 'toolbox_talk') {
    const topic = String(merged.toolbox_topic || existing.toolbox_topic || '').trim();
    if (!topic) return res.status(400).json({ error: 'A topic is required for a toolbox talk.' });
    merged.toolbox_topic = topic;
    merged.training_type_label = `Toolbox Talk: ${topic}`;
    merged.master_training_id = existing.master_training_id;
    merged.outline = String(merged.outline || '').trim() || topic;
    merged.duration = String(merged.duration || '').trim() || '15 minutes';
  }

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
  // A Multi Training Day's count is its trainings - never edited as days. Whether a session with 2+
  // trainings checks in per training can be switched until someone signs in (2026-10-06).
  const { n: extrasCount } = await dbGet('SELECT COUNT(*) AS n FROM session_additional_trainings WHERE session_id = ?', [existing.session_id]);
  let multiTraining = isMultiTrainingDay(existing);
  let switchedCheckins = false;
  if (Object.prototype.hasOwnProperty.call(req.body, 'separate_checkins') && extrasCount > 0 && existing.session_kind !== 'toolbox_talk'
    && Boolean(req.body.separate_checkins) !== multiTraining) {
    const { n: signedIn } = await dbGet('SELECT COUNT(*) AS n FROM session_attendees WHERE session_id = ?', [existing.session_id]);
    if (existing.status !== 'open' || signedIn > 0) {
      return res.status(400).json({ error: 'Separate check-ins can only be turned on or off before anyone signs in.' });
    }
    multiTraining = Boolean(req.body.separate_checkins);
    switchedCheckins = true;
  }
  let totalDays = switchedCheckins ? (multiTraining ? 1 + extrasCount : null) : existing.total_days;
  if (!multiTraining && !switchedCheckins && Object.prototype.hasOwnProperty.call(req.body, 'total_days')) {
    totalDays = req.body.total_days ? Number(req.body.total_days) : null;
    if (totalDays !== null && (!Number.isInteger(totalDays) || totalDays < 2)) {
      return res.status(400).json({ error: 'total_days must be a whole number of 2 or more.' });
    }
  }
  // Same "leave the field out to keep the existing value" rule as total_days above.
  let dayDatesJson = switchedCheckins ? null : existing.day_dates;
  if (!multiTraining && !switchedCheckins && Object.prototype.hasOwnProperty.call(req.body, 'day_dates')) {
    const result = validateDayDates(req.body.day_dates, totalDays);
    if (result.error) return res.status(400).json({ error: result.error });
    dayDatesJson = result.dayDatesJson;
  }
  let dayOutlinesJson = switchedCheckins ? null : existing.day_outlines;
  if (!multiTraining && !switchedCheckins && Object.prototype.hasOwnProperty.call(req.body, 'day_outlines')) {
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
         session_date=?, outline=?, location=?, duration=?, language=?, training_type_label_es=?, outline_es=?, total_days=?, day_dates=?, day_outlines=?,
         toolbox_topic=?
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
      merged.toolbox_topic || null,
      req.params.id,
    ]
  );
  if (switchedCheckins) {
    await dbRun('UPDATE training_sessions SET multi_training_day = ?, current_day = 1 WHERE session_id = ?', [multiTraining ? 1 : 0, req.params.id]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'wetransfer_link')) {
    const wetransfer = cleanWetransferLink(req.body.wetransfer_link);
    if (wetransfer.error) return res.status(400).json({ error: wetransfer.error });
    // Can't be cleared on a session with the prep step (an Internal trainer).
    if (!wetransfer.link && existing.prep_status) {
      return res.status(400).json({ error: 'A WeTransfer link is required.' });
    }
    await dbRun('UPDATE training_sessions SET wetransfer_link = ? WHERE session_id = ?', [wetransfer.link, req.params.id]);
  }
  // The first training's own duration (the edit form's "Duration - <first training>" box) - and
  // `duration` becomes the total again below.
  if (extrasCount > 0 && String(req.body.first_training_duration || '').trim()) {
    await dbRun('UPDATE training_sessions SET first_training_duration = ? WHERE session_id = ?', [String(req.body.first_training_duration).trim(), req.params.id]);
  }
  // Each other training's own duration: [{ id, duration }].
  if (extrasCount > 0 && Array.isArray(req.body.additional_training_durations)) {
    for (const t of req.body.additional_training_durations) {
      const duration = String(t?.duration || '').trim();
      if (!duration) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await dbRun('UPDATE session_additional_trainings SET duration = ? WHERE id = ? AND session_id = ?', [duration, String(t.id || ''), req.params.id]);
    }
  }
  if (extrasCount > 0) await recalcTotalDuration(req.params.id);
  // Per-day trainers: rewritten from the form when sent, otherwise kept as they were (still
  // re-saved, so a change to the number of days adds/drops day rows). None on a one-day session.
  const savedSession = await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (multiTraining) {
    await saveDayTrainers(savedSession, null);
  } else if (Object.prototype.hasOwnProperty.call(req.body, 'day_trainers')) {
    await saveDayTrainers(savedSession, req.body.day_trainers);
  } else if (savedSession.total_days) {
    const current = await getSessionDays(existing);
    await saveDayTrainers(savedSession, current.map((d) => d.assigned_trainer_employee_id));
  } else {
    await saveDayTrainers(savedSession, null);
  }
  // Co-trainers: replaced when the form sends them; re-saved otherwise so a new lead trainer who
  // was a co-trainer isn't listed twice.
  if (Object.prototype.hasOwnProperty.call(req.body, 'co_trainer_ids')) {
    await saveCoTrainers(savedSession, req.body.co_trainer_ids);
  } else {
    await saveCoTrainers(savedSession, (await getCoTrainers(savedSession.session_id)).map((t) => t.trainer_employee_id));
  }
  // An edit that puts one of our own trainers on it starts prep, same as creating it would.
  await startPrepSafely(await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [req.params.id]));
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  logActivity({
    actor: req.user, action: 'session_updated', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, req,
  });
  res.json({ ...withParsedDayDates(session), translation_warning: warning });
});

// Session prep (lib/sessionPrep.js, Keeley's request, 2026-10-07). The prep team saves the class
// details here; the first save (or a change after the summary went out) emails the reviewers.
router.put('/:id/prep', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.prep_status) return res.status(400).json({ error: "This session doesn't have a prep step." });
  const result = await savePrep(session, req.body || {}, req.user.full_name || req.user.username);
  if (result.error) return res.status(400).json({ error: result.error });
  logActivity({
    actor: req.user, action: 'session_prep_saved', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: result.notified ? 'Reviewers notified' : undefined, req,
  });
  res.json({ ...result, prep_status: (await dbGet('SELECT prep_status FROM training_sessions WHERE session_id = ?', [session.session_id])).prep_status });
});

// A reviewer sends the trainer(s) the class summary (again, after a change).
router.post('/:id/prep/send', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const result = await sendTrainerSummary(session, req.user.full_name || req.user.username);
  if (result.error) return res.status(400).json({ error: result.error });
  logActivity({
    actor: req.user, action: 'session_prep_sent', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: `Summary sent to ${result.sent_to.join(', ')}`, req,
  });
  res.json(result);
});

// Ask for prep on a session that didn't get it automatically (created before this existed, or an
// outside trainer the office wants it for anyway).
router.post('/:id/prep/start', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'closed' || session.session_kind === 'toolbox_talk') return res.status(400).json({ error: 'Prep is only for upcoming training sessions.' });
  if (session.prep_status) return res.json({ prep_status: session.prep_status });
  const started = await startPrep(session, { force: true });
  if (started) {
    logActivity({
      actor: req.user, action: 'session_prep_requested', entityType: 'training_session', entityId: session.session_id,
      entityLabel: `${session.training_type_label} · ${session.client_name}`, req,
    });
  }
  res.json({ prep_status: started ? 'info_needed' : session.prep_status, label: PREP_LABELS.info_needed });
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
  const nextLabel = isMultiTrainingDay(session)
    ? `Training ${nextDay} of ${session.total_days}: ${(await trainingParts(session))[nextDay - 1].label}`
    : `Day ${nextDay} of ${session.total_days}`;
  logActivity({
    actor: req.user, action: 'session_day_advanced', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: nextLabel, req,
  });
  res.json({ current_day: nextDay, total_days: session.total_days });
});

// Undo an advance done too early (Keeley's request, 2026-09-28: a session was moved to Day 2 on
// the morning of Day 1, so that day's sign-ins were all recorded as Day 2). Steps back one day
// and moves every sign-in recorded for the day being undone back to the earlier day - or drops it
// when that person is already checked in for the earlier day, since it was only the same
// attendance recorded twice.
router.post('/:id/previous-day', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.total_days) return res.status(400).json({ error: 'This is not a multi-day session.' });
  if (session.status === 'closed') return res.status(400).json({ error: 'This session is already closed.' });
  if (session.current_day <= 1) return res.status(400).json({ error: 'Already on Day 1.' });
  const fromDay = session.current_day;
  const toDay = fromDay - 1;
  const { moved, dropped } = await withTransaction(async () => {
    const rows = await dbAll('SELECT id, attendee_id FROM session_attendance_days WHERE session_id = ? AND day_number = ?', [session.session_id, fromDay]);
    const alreadyOnEarlierDay = new Set((await dbAll(
      'SELECT attendee_id FROM session_attendance_days WHERE session_id = ? AND day_number = ?', [session.session_id, toDay]
    )).map((r) => r.attendee_id));
    let movedCount = 0;
    let droppedCount = 0;
    for (const row of rows) {
      if (alreadyOnEarlierDay.has(row.attendee_id)) {
        // eslint-disable-next-line no-await-in-loop
        await dbRun('DELETE FROM session_attendance_days WHERE id = ?', [row.id]);
        droppedCount += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await dbRun('UPDATE session_attendance_days SET day_number = ? WHERE id = ?', [toDay, row.id]);
        movedCount += 1;
      }
    }
    await dbRun('UPDATE training_sessions SET current_day = ? WHERE session_id = ?', [toDay, session.session_id]);
    // The day being reopened is no longer finished - its trainer signs it off again.
    await clearDaySignoff(session.session_id, toDay);
    return { moved: movedCount, dropped: droppedCount };
  });
  logActivity({
    actor: req.user, action: 'session_day_reverted', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`,
    details: `Back to Day ${toDay} of ${session.total_days}; ${moved} sign-in(s) moved from Day ${fromDay}${dropped ? `, ${dropped} duplicate(s) removed` : ''}`, req,
  });
  res.json({ current_day: toDay, total_days: session.total_days, moved, dropped });
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

  const attendee_id = await insertManualAttendee(session, {
    firstName: traineeFirst, lastName: traineeLast, phone: trainee_phone, jobTitle: trainee_job_title, email: trainee_email, signature,
  });

  if (session.status === 'closed') {
    await certifyAfterClose(session, attendee_id, 'Added after the session closed with no recorded attendance days on file.');

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

// Mark someone present for a day of a multi-day session from the office (Keeley's request,
// 2026-10-01: "in case they forget" to sign in). Only for days that have started - up to the
// current day while open, any day once closed. On a closed session this can complete their
// attendance, which issues the certificate and training record just like an after-close add.
async function attendanceDayContext(req, res) {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.sessionId]);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return null; }
  if (!session.total_days) { res.status(400).json({ error: 'This is not a multi-day session.' }); return null; }
  const day = Number(req.params.day);
  if (!Number.isInteger(day) || day < 1 || day > session.total_days) {
    res.status(400).json({ error: `Pick a day from 1 to ${session.total_days}.` });
    return null;
  }
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [req.params.attendeeId, session.session_id]);
  if (!attendee) { res.status(404).json({ error: 'Attendee not found' }); return null; }
  return { session, day, attendee };
}

async function attendanceResult(sessionId, attendeeId) {
  const rows = await dbAll('SELECT day_number, marked_by FROM session_attendance_days WHERE session_id = ? AND attendee_id = ? ORDER BY day_number', [sessionId, attendeeId]);
  const attendee = await dbGet('SELECT processing_status FROM session_attendees WHERE attendee_id = ?', [attendeeId]);
  return {
    days_attended: rows.map((r) => r.day_number),
    days_marked_by_office: rows.filter((r) => r.marked_by).map((r) => r.day_number),
    processing_status: attendee?.processing_status,
  };
}

router.post('/:sessionId/attendees/:attendeeId/days/:day', requireAdmin, async (req, res) => {
  const ctx = await attendanceDayContext(req, res);
  if (!ctx) return;
  const { session, day, attendee } = ctx;
  if (session.status === 'open' && day > session.current_day) {
    return res.status(400).json({ error: `Day ${day} hasn't started yet - the session is on Day ${session.current_day}.` });
  }
  // A closed session may issue a certificate here, and certificate files have to be made by the
  // live server - a local copy would save a path only this computer has into the live records.
  if (session.status === 'closed' && process.env.RENDER !== 'true' && process.env.ALLOW_LOCAL_ROSTER_REBUILD !== 'on') {
    return res.status(400).json({ error: 'Mark days on a closed session from the live site (esr-training.com) - certificates are stored there.' });
  }
  const existing = await dbGet(
    'SELECT id FROM session_attendance_days WHERE session_id = ? AND attendee_id = ? AND day_number = ?',
    [session.session_id, attendee.attendee_id, day]
  );
  if (existing) return res.json(await attendanceResult(session.session_id, attendee.attendee_id));
  await dbRun(
    'INSERT INTO session_attendance_days (id, session_id, attendee_id, day_number, signature, marked_by) VALUES (?, ?, ?, ?, NULL, ?)',
    [uuidv4(), session.session_id, attendee.attendee_id, day, req.user.username]
  );
  let certified = false;
  // A Multi Training Day certifies just the training marked (lib/lateAttendees.js).
  if (session.status === 'closed' && isMultiTrainingDay(session)) {
    certified = (await certifyTrainingParts(session, attendee.attendee_id)) > 0;
    if (certified) {
      const allAttendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
      const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
      await regenerateRosters(session, allAttendees, additionalTrainings);
    }
  } else if (session.status === 'closed' && attendee.processing_status === 'incomplete_attendance') {
    certified = await certifyAfterClose(session, attendee.attendee_id, 'Still missing a day after the office marked attendance.');
    if (certified) {
      const allAttendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
      const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
      await regenerateRosters(session, allAttendees, additionalTrainings);
    }
  }
  logActivity({
    actor: req.user, action: 'attendance_marked', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`,
    details: `${attendee.trainee_name} – ${isMultiTrainingDay(session) ? (await trainingParts(session))[day - 1].label : `Day ${day}`}${certified ? ' (certificate issued)' : ''}`, req,
  });
  res.json({ ...(await attendanceResult(session.session_id, attendee.attendee_id)), certified });
});

// Undo an office-marked day (a mis-click) while the session is still open. A trainee's own
// signed sign-in is never removed here, and a closed session's attendance is final.
router.delete('/:sessionId/attendees/:attendeeId/days/:day', requireAdmin, async (req, res) => {
  const ctx = await attendanceDayContext(req, res);
  if (!ctx) return;
  const { session, day, attendee } = ctx;
  if (session.status !== 'open') return res.status(400).json({ error: 'Attendance can only be changed while the session is open.' });
  const row = await dbGet(
    'SELECT id, marked_by FROM session_attendance_days WHERE session_id = ? AND attendee_id = ? AND day_number = ?',
    [session.session_id, attendee.attendee_id, day]
  );
  if (!row) return res.json(await attendanceResult(session.session_id, attendee.attendee_id));
  if (!row.marked_by) return res.status(400).json({ error: `${attendee.trainee_name} signed in for Day ${day} themselves - only days marked by the office can be undone.` });
  await dbRun('DELETE FROM session_attendance_days WHERE id = ?', [row.id]);
  logActivity({
    actor: req.user, action: 'attendance_unmarked', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, details: `${attendee.trainee_name} – Day ${day}`, req,
  });
  res.json(await attendanceResult(session.session_id, attendee.attendee_id));
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

// Attendee documents in bulk (Keeley's request, 2026-10-02: e.g. a CPR class's AHA skills
// checklists, one per person) - the files are chosen together on the session page, matched to
// attendees there by the name in each file name, and filed under each person's Documents (same
// folder, types and size limit as a single document upload on a profile), linked to the
// session's training when it's on their profile. Saved on the live server only - a local copy
// would record a path only that computer has.
const ATTENDEE_DOCS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'employee-documents');
const attendeeDocsUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(ATTENDEE_DOCS_DIR, { recursive: true }); cb(null, ATTENDEE_DOCS_DIR); },
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname) || ''}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 100 },
  fileFilter: (req, file, cb) => (/\.(pdf|jpg|jpeg|png)$/i.test(file.originalname)
    ? cb(null, true)
    : cb(new Error(`${file.originalname}: only PDF, JPG, or PNG files can be uploaded`))),
});

router.post('/:id/attendee-documents', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (process.env.RENDER !== 'true' && process.env.ALLOW_LOCAL_ROSTER_REBUILD !== 'on') {
    return res.status(400).json({ error: 'Upload attendee documents from the live site (esr-training.com) - this copy of the app stores files on this computer only.' });
  }
  attendeeDocsUpload.array('documents', 100)(req, res, async (err) => {
    const files = req.files || [];
    const discard = () => files.forEach((f) => fs.unlink(f.path, () => {}));
    if (err) { discard(); return res.status(400).json({ error: err.message }); }
    let assignments;
    try { assignments = JSON.parse(req.body?.assignments || '[]'); } catch { assignments = null; }
    if (!Array.isArray(assignments) || assignments.length !== files.length || !files.length) {
      discard();
      return res.status(400).json({ error: 'Choose at least one file and who it belongs to.' });
    }
    const attendees = await dbAll('SELECT attendee_id, employee_id, trainee_name FROM session_attendees WHERE session_id = ?', [session.session_id]);
    const byId = new Map(attendees.map((a) => [a.attendee_id, a]));
    const problems = [];
    files.forEach((f, i) => {
      const a = byId.get(assignments[i]?.attendee_id);
      if (!a) problems.push(`${f.originalname}: pick who it belongs to`);
      else if (!a.employee_id) problems.push(`${f.originalname}: ${a.trainee_name} isn't linked to an employee profile yet`);
      else if (!String(assignments[i]?.label || '').trim()) problems.push(`${f.originalname}: needs a label`);
    });
    if (problems.length) { discard(); return res.status(400).json({ error: problems.join('; ') }); }

    const saved = [];
    for (let i = 0; i < files.length; i += 1) {
      const a = byId.get(assignments[i].attendee_id);
      // eslint-disable-next-line no-await-in-loop
      const hasTraining = session.master_training_id && await dbGet(
        'SELECT 1 AS x FROM employee_training_records WHERE employee_id = ? AND training_id = ? LIMIT 1', [a.employee_id, session.master_training_id]
      );
      // eslint-disable-next-line no-await-in-loop
      await dbRun(
        `INSERT INTO employee_documents (document_id, employee_id, label, filename, file_path, uploaded_by, training_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), a.employee_id, String(assignments[i].label).trim().slice(0, 200), files[i].originalname, files[i].path, req.user.username,
          hasTraining ? session.master_training_id : null]
      );
      saved.push(`${a.trainee_name}: ${String(assignments[i].label).trim()}`);
    }
    logActivity({
      actor: req.user, action: 'attendee_documents_uploaded', entityType: 'training_session', entityId: session.session_id,
      entityLabel: `${session.training_type_label} · ${session.client_name}`, details: `${saved.length} document(s)`, req,
    });
    res.status(201).json({ saved: saved.length, details: saved });
  });
});

// Rebuild a closed session's roster PDFs from what's on file now (Keeley's request, 2026-09-29:
// e.g. a trainer's name corrected after close-out). Runs on the server that stores the files -
// no email, nothing else regenerated.
router.post('/:id/rebuild-rosters', requireAdmin, async (req, res) => {
  const session = await dbGet(`${SESSION_WITH_CLIENT_SQL} WHERE ts.session_id = ?`, [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'closed') return res.status(400).json({ error: 'Rosters are only built once the session is closed.' });
  // A local copy of the app shares the live database but not the live server's files - building
  // here would point the live session at a file only this computer has.
  if (process.env.RENDER !== 'true' && process.env.ALLOW_LOCAL_ROSTER_REBUILD !== 'on') {
    return res.status(400).json({ error: 'Rebuild rosters from the live site (esr-training.com) - this copy of the app stores files on this computer only.' });
  }
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
  const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
  const { rosterPath, ahaRosterPath } = await regenerateRosters(session, attendees, additionalTrainings);
  logActivity({
    actor: req.user, action: 'rosters_rebuilt', entityType: 'training_session', entityId: session.session_id,
    entityLabel: `${session.training_type_label} · ${session.client_name}`, req,
  });
  res.json({ ok: Boolean(rosterPath), aha_roster: Boolean(ahaRosterPath) });
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
