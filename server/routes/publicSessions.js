// Public, unauthenticated Training Sign-In routes - mounted at /api/public in server/index.js
// WITHOUT requireAuth. Trainees reach these by scanning a session's QR code; they never have
// (or need) a login. Everything else in this app requires a session cookie.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { generateCertificate } = require('../lib/pdfGen');
const { processAttendee, processAttendeeAdditionalTraining } = require('../lib/sessionRecords');
const { buildCertificateFilename } = require('../lib/certificateFilename');
const { DATA_DIR } = require('../lib/paths');
const path = require('path');
const repo = require('../lib/repo');
const { notifyAllUsers } = require('../lib/notifications');
const { ahaColumnsFromBody, ensureEditToken, regenerateRosters, sendCompletedFormsEmail } = require('../lib/sessionCloseOut');
const { parseName, firstLast } = require('../lib/names');

// An attendee's name as first/last parts plus the "First Last" trainee_name printed on their
// certificate - separate parts when the form sent them, otherwise split from one combined field.
function attendeeNameParts(body) {
  const first = String(body.trainee_first_name || '').trim();
  const last = String(body.trainee_last_name || '').trim();
  if (first || last) return { first, last, full: firstLast(first, last) };
  const parsed = parseName(body.trainee_name);
  return { first: parsed.first, last: parsed.last, full: String(body.trainee_name || '').trim() };
}

const router = express.Router();

// Same pattern as server/routes/auth.js's EMAIL_PATTERN - duplicated locally rather than
// shared, since these public routes intentionally have no dependency on the authenticated side.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // Lets the trainer close-out form pre-fill phone/email for a trainer already on file, instead
  // of retyping it every session (Keeley's request, 2026-09-17) - trainer_employee_id is set at
  // session creation time (repo.findOrCreateTrainerEmployee), so it's almost always available.
  let trainerPhone = session.trainer_phone || '';
  let trainerEmail = session.trainer_email || '';
  if (session.trainer_employee_id) {
    const trainerEmployee = await dbGet('SELECT employee_number, email FROM employees WHERE employee_id = ?', [session.trainer_employee_id]);
    if (trainerEmployee) {
      // employee_number is overloaded (a trainer added via the Trainers page stores their
      // Employee ID there instead of a phone - see server/routes/trainers.js) - only prefill
      // from it when it actually looks like a phone number, never a stray ID.
      if (!trainerPhone && isValidPhoneNumber(trainerEmployee.employee_number)) {
        trainerPhone = formatPhoneNumber(trainerEmployee.employee_number);
      }
      trainerEmail = trainerEmail || trainerEmployee.email || '';
    }
  }
  const additionalTrainings = await dbAll(
    'SELECT training_type_label FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order',
    [session.session_id]
  );
  res.json({
    client_name: session.client_name,
    master_training_id: session.master_training_id,
    training_type_label: session.training_type_label,
    training_type_label_es: session.training_type_label_es,
    additional_training_labels: additionalTrainings.map((t) => t.training_type_label),
    trainer_name: session.trainer_name,
    trainer_phone: trainerPhone,
    trainer_email: trainerEmail,
    session_date: session.session_date,
    outline: session.outline,
    outline_es: session.outline_es,
    language: session.language,
    status: session.status,
    attendee_count: attendeeCount,
    total_days: session.total_days,
    current_day: session.current_day,
    day_dates: session.day_dates ? JSON.parse(session.day_dates) : null,
    day_outlines: session.day_outlines ? JSON.parse(session.day_outlines) : null,
  });
});

// A trainee signs in.
router.post('/:token/attendees', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'This training session has been closed and can no longer accept sign-ins.' });
  }
  const { trainee_phone, trainee_job_title, trainee_email, signature } = req.body || {};
  const traineeName = attendeeNameParts(req.body || {});
  if (!traineeName.full) {
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
  if (!trainee_email || !trainee_email.trim()) {
    return res.status(400).json({ error: 'Email address is required.' });
  }
  if (!EMAIL_PATTERN.test(trainee_email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A signature is required.' });
  }
  const attendee_id = uuidv4();
  await dbRun(
    `INSERT INTO session_attendees (attendee_id, session_id, trainee_name, trainee_first_name, trainee_last_name, trainee_phone, trainee_job_title, trainee_email, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attendee_id,
      session.session_id,
      traineeName.full,
      traineeName.first || null,
      traineeName.last || null,
      formatPhoneNumber(trainee_phone),
      trainee_job_title.trim(),
      trainee_email.trim().toLowerCase(),
      signature,
    ]
  );
  // Multi-day session (server/migrations/055_multiday_sessions.sql): a brand-new sign-in always
  // counts as attendance for whatever day is currently open, not necessarily "Day 1" - someone
  // signing in for the first time on Day 2 has, correctly, still missed Day 1.
  if (session.total_days) {
    await dbRun(
      `INSERT INTO session_attendance_days (id, session_id, attendee_id, day_number, signature)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), session.session_id, attendee_id, session.current_day, signature]
    );
  }
  res.status(201).json({ ok: true });
});

// "Find your name" (Keeley's request, 2026-09-21) - a returning attendee on a multi-day session
// looks themselves up instead of re-typing their whole profile every day. Plain substring search
// (not the word-set matching used for import de-duplication) since this is a live type-ahead
// over a small, single-session roster, not a one-shot "is this the same person" judgment call.
router.get('/:token/attendees/search', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const rows = await dbAll(
    `SELECT attendee_id, trainee_name FROM session_attendees
     WHERE session_id = ? AND trainee_name ILIKE ? ORDER BY trainee_name LIMIT 8`,
    [session.session_id, `%${q}%`]
  );
  if (rows.length === 0) return res.json([]);
  const days = await dbAll(
    `SELECT attendee_id, day_number FROM session_attendance_days WHERE session_id = ? AND attendee_id = ANY(?)`,
    [session.session_id, rows.map((r) => r.attendee_id)]
  );
  res.json(
    rows.map((r) => {
      const daysAttended = days.filter((d) => d.attendee_id === r.attendee_id).map((d) => d.day_number).sort((a, b) => a - b);
      return {
        attendee_id: r.attendee_id,
        trainee_name: r.trainee_name,
        days_attended: daysAttended,
        already_checked_in_today: daysAttended.includes(session.current_day),
      };
    })
  );
});

// A returning attendee confirms it's them and signs fresh for whichever day is currently open
// (Keeley's call: a new signature every day, not just Day 1).
router.post('/:token/attendees/:attendeeId/checkin', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: "This sign-in link isn't valid." });
  if (session.status === 'closed') {
    return res.status(400).json({ error: 'This training session has been closed and can no longer accept sign-ins.' });
  }
  if (!session.total_days) return res.status(400).json({ error: 'This is not a multi-day session.' });
  const attendee = await dbGet('SELECT attendee_id FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [
    req.params.attendeeId,
    session.session_id,
  ]);
  if (!attendee) return res.status(404).json({ error: 'Attendee not found on this session.' });
  const { signature } = req.body || {};
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A signature is required.' });
  }
  const existing = await dbGet(
    'SELECT id FROM session_attendance_days WHERE session_id = ? AND attendee_id = ? AND day_number = ?',
    [session.session_id, attendee.attendee_id, session.current_day]
  );
  if (existing) {
    return res.status(400).json({ error: `Already checked in for Day ${session.current_day}.` });
  }
  await dbRun(
    `INSERT INTO session_attendance_days (id, session_id, attendee_id, day_number, signature)
     VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), session.session_id, attendee.attendee_id, session.current_day, signature]
  );
  res.status(201).json({ ok: true, day_number: session.current_day });
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
  // A multi-day session can only close from its final day (Keeley's call) - otherwise closing
  // early would judge attendance against a course that hasn't finished yet.
  if (session.total_days && session.current_day < session.total_days) {
    return res.status(400).json({
      error: `This is a ${session.total_days}-day session, currently on Day ${session.current_day}. Advance to Day ${session.total_days} before closing.`,
    });
  }
  // The AHA Heartsaver Course Roster fields (hs_*, Keeley's request, 2026-09-21) are read by
  // ahaColumnsFromBody below - they only print for First Aid/CPR/AED sessions.
  const { trainer_signed_name, trainer_email, trainer_phone, signature, pin } = req.body || {};
  if (!trainer_signed_name || !trainer_signed_name.trim()) {
    return res.status(400).json({ error: 'Trainer name is required to close the session.' });
  }
  if (!trainer_email || !trainer_email.trim()) {
    return res.status(400).json({ error: 'Trainer email is required to close the session.' });
  }
  if (!EMAIL_PATTERN.test(trainer_email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!trainer_phone || !trainer_phone.trim()) {
    return res.status(400).json({ error: 'Trainer phone number is required to close the session.' });
  }
  if (!isValidPhoneNumber(trainer_phone)) {
    return res.status(400).json({ error: 'Please enter a standard 10-digit phone number.' });
  }
  if (!isValidSignature(signature)) {
    return res.status(400).json({ error: 'A trainer signature is required to close the session.' });
  }
  // Only the trainer should be able to close the session (Keeley's request: trainees
  // shouldn't be able to trigger it by accident) - an admin-editable, case-insensitive PIN
  // (trainer_close_pin_settings, defaults to "2026"), checked server-side since the client-side
  // field is only a UX convenience, not the real boundary.
  const pinSetting = await dbGet('SELECT pin FROM trainer_close_pin_settings WHERE id = ?', ['default']);
  if (String(pin || '').trim().toUpperCase() !== String(pinSetting?.pin || '').trim().toUpperCase()) {
    return res.status(400).json({ error: 'Incorrect PIN.' });
  }

  const formattedTrainerPhone = formatPhoneNumber(trainer_phone);
  const ahaColumns = ahaColumnsFromBody(req.body || {});
  await dbRun(
    `UPDATE training_sessions
     SET status = 'closed', trainer_signed_name = ?, trainer_email = ?, trainer_phone = ?, trainer_signature = ?,
         trainer_signed_at = now_utc_text(), closed_at = now_utc_text(),
         ${Object.keys(ahaColumns).map((col) => `${col} = ?`).join(', ')}
     WHERE session_id = ?`,
    [
      trainer_signed_name.trim(), trainer_email.trim().toLowerCase(), formattedTrainerPhone, signature,
      ...Object.values(ahaColumns),
      session.session_id,
    ]
  );
  // The secret behind the trainer's "Edit close-out details" email link (routes/sessionEdit.js).
  await ensureEditToken(session.session_id);

  // Keep the trainer's own profile current from what they just signed off with (Keeley's
  // request, 2026-09-17) - eliminates the need to manually add it on the back end. The session
  // is already linked to a trainer employee almost always (set at creation by
  // repo.findOrCreateTrainerEmployee) - reuse that same link rather than re-resolving one here,
  // since a name/phone typed slightly differently at close-out than at creation would otherwise
  // resolve to a *different* profile than the one this session is actually attached to, leaving
  // a stray duplicate instead of updating the real one. Only fall back to finding/creating a new
  // link for the rare session that somehow has none yet.
  let trainerEmployeeId = session.trainer_employee_id;
  if (!trainerEmployeeId) {
    trainerEmployeeId = await repo.findOrCreateTrainerEmployee(trainer_signed_name.trim(), formattedTrainerPhone);
    if (trainerEmployeeId) {
      await dbRun('UPDATE training_sessions SET trainer_employee_id = ? WHERE session_id = ?', [trainerEmployeeId, session.session_id]);
    }
  }
  // The trainer's profile email, read before the update below - documents go to both this and
  // the sign-off email when they differ (Keeley's call, 2026-09-22).
  let trainerProfileEmail = null;
  if (trainerEmployeeId) {
    trainerProfileEmail = (await dbGet('SELECT email FROM employees WHERE employee_id = ?', [trainerEmployeeId]))?.email || null;
    // employee_number and email only fill in when blank (never overwrite) - employee_number may
    // already hold a real Employee ID entered by an admin via the Trainers page, and email may be
    // one an admin assigned on the trainer's profile (Keeley's request, 2026-09-22).
    await dbRun(
      'UPDATE employees SET employee_number = COALESCE(NULLIF(employee_number, \'\'), ?), email = COALESCE(NULLIF(email, \'\'), ?) WHERE employee_id = ?',
      [formattedTrainerPhone, trainer_email.trim().toLowerCase(), trainerEmployeeId]
    );
  }

  const updatedSession = await dbGet(
    `SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?`,
    [session.session_id]
  );
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
  // Extra trainings taught in the same session (server/migrations/045_multi_training_sessions.sql) -
  // empty for the overwhelming majority of (single-training) sessions.
  const additionalTrainings = await dbAll(
    'SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order',
    [session.session_id]
  );

  // Multi-day session (server/migrations/055_multiday_sessions.sql, Keeley's request): an
  // attendee only gets certified if they attended every required day. Counted once here rather
  // than per-attendee in the loop below, since it's the same query either way.
  let daysAttendedByAttendee = null;
  if (updatedSession.total_days && attendees.length) {
    const dayRows = await dbAll(
      'SELECT attendee_id, COUNT(DISTINCT day_number) AS n FROM session_attendance_days WHERE session_id = ? GROUP BY attendee_id',
      [session.session_id]
    );
    daysAttendedByAttendee = Object.fromEntries(dayRows.map((r) => [r.attendee_id, Number(r.n)]));
  }

  // Certificate per attendee for the primary training, then link them into the Matrix
  // (best-effort per attendee so one bad record can't block everyone else's certificate or
  // employee record) - then the same for each additional training, one certificate/record per
  // (attendee, training) pair.
  for (const attendee of attendees) {
    if (daysAttendedByAttendee) {
      const daysAttended = daysAttendedByAttendee[attendee.attendee_id] || 0;
      if (daysAttended < updatedSession.total_days) {
        // eslint-disable-next-line no-await-in-loop
        await dbRun(
          `UPDATE session_attendees SET processing_status = 'incomplete_attendance', processing_error = ? WHERE attendee_id = ?`,
          [`Attended ${daysAttended} of ${updatedSession.total_days} required days - no certificate generated from this session.`, attendee.attendee_id]
        );
        continue; // eslint-disable-line no-continue
      }
    }
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

    for (const additionalTraining of additionalTrainings) {
      // A shallow clone with the swapped label is all generateCertificate/buildCertificateFilename
      // read differently per training - date/client/trainer stay the session's own.
      const trainingSession = { ...updatedSession, training_type_label: additionalTraining.training_type_label };
      const outputPath = path.join(
        DATA_DIR, 'certificates', 'sign-in-sessions', session.session_id, `${attendee.attendee_id}-${additionalTraining.id}.pdf`
      );
      let additionalCertPath = null;
      let additionalCertFilename = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        additionalCertPath = await generateCertificate(trainingSession, attendee, outputPath);
        additionalCertFilename = buildCertificateFilename(trainingSession, attendee);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Certificate generation failed for attendee ${attendee.attendee_id}, training ${additionalTraining.id}:`, err);
      }
      // eslint-disable-next-line no-await-in-loop
      await processAttendeeAdditionalTraining(updatedSession, attendee, additionalTraining, additionalCertPath, additionalCertFilename);
    }
  }

  const attendeesFinal = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);

  // Completed forms emailed once close-out finishes (Keeley's request, 2026-09-22): a ZIP of the
  // attendees' certificates, the sign-in roster PDF, and the AHA roster for First Aid/CPR/AED -
  // attached, to the trainer and every app user (see lib/sessionCloseOut.js).
  const { rosterPath, ahaRosterPath } = await regenerateRosters(updatedSession, attendeesFinal, additionalTrainings);
  await sendCompletedFormsEmail({
    session: updatedSession, additionalTrainings, attendees: attendeesFinal, rosterPath, ahaRosterPath, trainerProfileEmail,
  });

  try {
    const allLabels = [updatedSession.training_type_label, ...additionalTrainings.map((t) => t.training_type_label)].join(', ');
    // Bell notification only - the forms email above replaces the old link-only email.
    await notifyAllUsers({
      type: 'session_completed',
      title: `${allLabels} training completed`,
      body: `${updatedSession.client_name} · ${attendeesFinal.length} attendee(s) · ${updatedSession.session_date}`,
      link_path: `/sessions/${updatedSession.session_id}`,
      email: false,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Notification failed for session ${session.session_id}:`, err);
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
    training_type_label_es: session.training_type_label_es,
    language: session.language,
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
