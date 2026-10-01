// Adding someone to a session after the fact - shared by the office's "Add Attendee" on the
// session page (routes/trainingSessions.js) and the trainer's emailed edit link (routes/
// sessionEdit.js, Keeley's request, 2026-10-01: trainers can add people they notice are missing
// from the final roster), so both apply exactly the same steps.
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const { generateCertificate } = require('./pdfGen');
const { withDayTrainers } = require('./sessionDays');
const { processAttendee } = require('./sessionRecords');
const { formatPhoneNumber } = require('./phone');
const { firstLast } = require('./names');

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

module.exports = { insertManualAttendee, markDaysAttended, certifyAfterClose };
