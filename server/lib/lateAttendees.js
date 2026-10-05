// Adding someone to a session after the fact - shared by the office's "Add Attendee" on the
// session page (routes/trainingSessions.js) and the trainer's emailed edit link (routes/
// sessionEdit.js, Keeley's request, 2026-10-01: trainers can add people they notice are missing
// from the final roster), so both apply exactly the same steps.
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { generateCertificate } = require('./pdfGen');
const { withDayTrainers } = require('./sessionDays');
const { processAttendee, processAttendeeAdditionalTraining } = require('./sessionRecords');
const { buildCertificateFilename } = require('./certificateFilename');
const { formatPhoneNumber } = require('./phone');
const { firstLast } = require('./names');
const { DATA_DIR } = require('./paths');
const { isMultiTrainingDay, trainingParts } = require('./sessionParts');

// Inserts an attendee typed in by someone else (no live sign-in), returning the new attendee_id.
async function insertManualAttendee(session, { firstName, lastName, phone, jobTitle, email, signature }) {
  const attendeeId = uuidv4();
  await dbRun(
    `INSERT INTO session_attendees (attendee_id, session_id, trainee_name, trainee_first_name, trainee_last_name, trainee_phone, trainee_job_title, trainee_email, signature, added_by_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      attendeeId,
      session.session_id,
      firstLast(firstName, lastName),
      firstName || null,
      lastName || null,
      phone ? formatPhoneNumber(phone) : null,
      jobTitle ? String(jobTitle).trim() : null,
      email ? String(email).trim().toLowerCase() : null,
      signature || null,
    ]
  );
  return attendeeId;
}

// Records the multi-day session days someone attended, as marked by `markedBy` rather than
// signed by the attendee (migration 073) - skips any day already on file.
async function markDaysAttended(session, attendeeId, days, markedBy) {
  for (const day of days) {
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `INSERT INTO session_attendance_days (id, session_id, attendee_id, day_number, signature, marked_by)
       VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT (session_id, attendee_id, day_number) DO NOTHING`,
      [uuidv4(), session.session_id, attendeeId, day, markedBy]
    );
  }
}

// After close-out, give one attendee their certificate and employee-file record - when they've
// made every day of a multi-day session; otherwise flag them incomplete with `incompleteReason`.
// Shared by adding an attendee after close and marking a missed day present, so both apply the
// same full-attendance gate the close route itself does. Returns true when certified.
async function certifyAfterClose(session, attendeeId, incompleteReason) {
  // A Multi Training Day certifies each training they checked in for on its own.
  if (isMultiTrainingDay(session)) return (await certifyTrainingParts(session, attendeeId)) > 0;
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendeeId]);
  let eligible = true;
  if (session.total_days) {
    const { n } = await dbGet(
      'SELECT COUNT(DISTINCT day_number) AS n FROM session_attendance_days WHERE session_id = ? AND attendee_id = ?',
      [session.session_id, attendeeId]
    );
    eligible = Number(n) >= session.total_days;
  }
  if (!eligible) {
    await dbRun(
      `UPDATE session_attendees SET processing_status = 'incomplete_attendance', processing_error = ? WHERE attendee_id = ?`,
      [incompleteReason, attendeeId]
    );
    return false;
  }
  let certPath = null;
  try {
    // A toolbox talk has no certificate - the record below still logs their attendance.
    if (session.session_kind !== 'toolbox_talk') certPath = await generateCertificate(await withDayTrainers(session), attendee);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Certificate generation failed for attendee ${attendeeId}:`, err);
  }
  await processAttendee(session, attendee, certPath);
  return true;
}

const DONE = ['linked', 'no_catalog_match'];

// Multi Training Day (Keeley's call, 2026-10-05): a certificate and training record for each
// training the attendee checked in for, and none for the ones they missed. Safe to run again - a
// training already certified is skipped, and one that failed is redone - so the close-out, an
// after-close add, and the office marking a training present all use it. Returns how many
// trainings were newly certified.
async function certifyTrainingParts(sessionRow, attendeeId) {
  const session = await withDayTrainers(sessionRow);
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [attendeeId]);
  if (!attendee) return 0;
  const attended = new Set((await dbAll(
    'SELECT day_number FROM session_attendance_days WHERE session_id = ? AND attendee_id = ?', [session.session_id, attendeeId]
  )).map((r) => r.day_number));
  const parts = await trainingParts(session);
  const existing = await dbAll('SELECT * FROM attendee_certificates WHERE attendee_id = ?', [attendeeId]);
  let certified = 0;
  for (const part of parts) {
    /* eslint-disable no-await-in-loop */
    const trainingSession = { ...session, training_type_label: part.label };
    if (part.number === 1) {
      if (DONE.includes(attendee.processing_status)) continue; // eslint-disable-line no-continue
      if (!attended.has(1)) {
        await dbRun(
          `UPDATE session_attendees SET processing_status = 'incomplete_attendance', processing_error = ? WHERE attendee_id = ?`,
          [`Didn't check in for ${part.label} - no certificate for it from this session.`, attendeeId]
        );
        continue; // eslint-disable-line no-continue
      }
      let certPath = null;
      try {
        certPath = await generateCertificate(trainingSession, attendee);
      } catch (err) {
        console.error(`Certificate generation failed for attendee ${attendeeId}:`, err); // eslint-disable-line no-console
      }
      await processAttendee(sessionRow, attendee, certPath);
      certified += 1;
      continue; // eslint-disable-line no-continue
    }
    if (!attended.has(part.number)) continue; // eslint-disable-line no-continue
    const prior = existing.find((c) => c.session_additional_training_id === part.additional_training.id);
    if (prior && DONE.includes(prior.processing_status)) continue; // eslint-disable-line no-continue
    if (prior) await dbRun('DELETE FROM attendee_certificates WHERE id = ?', [prior.id]);
    const outputPath = path.join(DATA_DIR, 'certificates', 'sign-in-sessions', session.session_id, `${attendeeId}-${part.additional_training.id}.pdf`);
    let certPath = null;
    let certFilename = null;
    try {
      certPath = await generateCertificate(trainingSession, attendee, outputPath);
      certFilename = buildCertificateFilename(trainingSession, attendee);
    } catch (err) {
      console.error(`Certificate generation failed for attendee ${attendeeId}, training ${part.additional_training.id}:`, err); // eslint-disable-line no-console
    }
    await processAttendeeAdditionalTraining(sessionRow, attendee, part.additional_training, certPath, certFilename);
    certified += 1;
    /* eslint-enable no-await-in-loop */
  }
  // Someone who missed the first training still belongs to their employee profile (documents,
  // the session page's links) through the other trainings' records.
  await dbRun(
    `UPDATE session_attendees SET employee_id = COALESCE(employee_id,
       (SELECT employee_id FROM attendee_certificates WHERE attendee_id = ? AND employee_id IS NOT NULL LIMIT 1))
     WHERE attendee_id = ?`,
    [attendeeId, attendeeId]
  );
  return certified;
}

module.exports = { insertManualAttendee, markDaysAttended, certifyAfterClose, certifyTrainingParts };
