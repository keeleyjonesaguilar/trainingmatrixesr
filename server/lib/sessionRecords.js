// Bridges a Training Sign-In session's attendees into the Matrix's own employee records -
// this is what used to be a separate app calling this one over HTTP (matrixSync.js, now
// deleted). Since the merge, it's just direct database calls in the same process: find-or-
// create the employee, save their training record via repo.saveTrainingRecord (the exact same
// path a manual entry uses), and attach the generated certificate. Nothing here is optional/
// toggleable anymore - it runs every time a session is closed.
const fs = require('fs');
const { dbGet, dbAll, dbRun } = require('./../db');
const { v4: uuidv4 } = require('uuid');
const repo = require('./repo');
const { formatPhoneNumber } = require('./phone');
const { buildCertificateFilename } = require('./certificateFilename');
const { nameColumns, nameKey } = require('./names');

// Matches an attendee to an existing employee at this client by name or phone, or creates a
// new one - same matching rule the old cross-app sync used (name OR phone, scoped to the
// client), just running in-process now instead of over HTTP.
async function findOrCreateEmployee(clientId, attendee) {
  const normalizedPhone = (attendee.trainee_phone || '').replace(/\D/g, '');
  // Compared as first/last parts (server/lib/names.js) - the sign-in form collects "Bill" +
  // "Zuniga" while the employee on file reads "Zuniga, Bill", which a plain string compare missed.
  const cols = nameColumns({ first_name: attendee.trainee_first_name, last_name: attendee.trainee_last_name, full_name: attendee.trainee_name });
  const attendeeKey = nameKey(cols);
  const candidates = await dbAll('SELECT * FROM employees WHERE client_id = ?', [clientId]);
  const match = candidates.find((e) => {
    const nameMatch = nameKey(e.full_name) === attendeeKey;
    const phoneMatch = normalizedPhone && (e.employee_number || '').replace(/\D/g, '') === normalizedPhone;
    return nameMatch || phoneMatch;
  });
  if (match) {
    // Backfill job title only if it's currently missing - a sign-in kiosk shouldn't silently
    // overwrite a client's authoritative job-title data with a possibly mistyped value.
    if (attendee.trainee_job_title && !match.job_title) {
      await dbRun(`UPDATE employees SET job_title = ? WHERE employee_id = ?`, [attendee.trainee_job_title, match.employee_id]);
    }
    return match.employee_id;
  }

  const employee_id = uuidv4();
  await dbRun(
    `INSERT INTO employees (employee_id, client_id, employee_number, full_name, first_name, last_name, job_title, active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      employee_id,
      clientId,
      formatPhoneNumber(attendee.trainee_phone || null),
      cols.full_name,
      cols.first_name || null,
      cols.last_name || null,
      attendee.trainee_job_title || null,
      'Created automatically from a Training Sign-In session.',
    ]
  );
  return employee_id;
}

// Called once per attendee when a session is closed (and available afterward as a manual
// per-attendee retry). certificatePath may be null if certificate generation itself failed -
// the employee/record linkage still proceeds either way.
async function processAttendee(session, attendee, certificatePath) {
  // Save the certificate onto the attendee's own row first (independent of what happens
  // below) so the roster page's "Download" link works even if employee/record linkage fails.
  const certificateFilename = certificatePath ? buildCertificateFilename(session, attendee) : null;

  if (certificatePath) {
    await dbRun('UPDATE session_attendees SET certificate_path = ?, certificate_filename = ? WHERE attendee_id = ?', [
      certificatePath,
      certificateFilename,
      attendee.attendee_id,
    ]);
  }

  try {
    const employeeId = await findOrCreateEmployee(session.client_id, attendee);

    if (!session.master_training_id) {
      // The session used a custom/uncatalogued training label - there's no Master Training to
      // attach a compliance record to. The employee is still on file; add the training to the
      // catalog and use "Retry" on this attendee if you want a record created after the fact.
      await dbRun(
        `UPDATE session_attendees
         SET employee_id = ?, training_record_id = NULL, processing_status = 'no_catalog_match', processing_error = ?
         WHERE attendee_id = ?`,
        [
          employeeId,
          'This session used a custom training label with no matching Master Training - no training record was created, but the employee is on file.',
          attendee.attendee_id,
        ]
      );
      return;
    }

    const record = await repo.saveTrainingRecord({
      client_id: session.client_id,
      employee_id: employeeId,
      training_id: session.master_training_id,
      completion_date: session.session_date,
      source: 'Training Sign-In',
      notes: `Trainer: ${session.trainer_signed_name || session.trainer_name}. Session ID: ${session.session_id}.`,
    });

    if (certificatePath) {
      await repo.attachCertificateFile(record.record_id, {
        filename: certificateFilename,
        filePath: certificatePath,
      });
    }

    await dbRun(
      `UPDATE session_attendees
       SET employee_id = ?, training_record_id = ?, processing_status = 'linked', processing_error = NULL
       WHERE attendee_id = ?`,
      [employeeId, record.record_id, attendee.attendee_id]
    );
  } catch (err) {
    await dbRun(
      `UPDATE session_attendees SET processing_status = 'failed', processing_error = ? WHERE attendee_id = ?`,
      [String(err.message || err).slice(0, 500), attendee.attendee_id]
    );
  }
}

// Same linkage as processAttendee above, for one *additional* training on a multi-training
// session (server/migrations/045_multi_training_sessions.sql) - writes to attendee_certificates
// instead of session_attendees since an attendee can have several of these, one per extra
// training, alongside their one primary-training record.
async function processAttendeeAdditionalTraining(session, attendee, additionalTraining, certificatePath, certificateFilename) {
  const id = uuidv4();
  await dbRun(
    `INSERT INTO attendee_certificates (id, attendee_id, session_additional_training_id, certificate_path, certificate_filename)
     VALUES (?, ?, ?, ?, ?)`,
    [id, attendee.attendee_id, additionalTraining.id, certificatePath || null, certificateFilename || null]
  );

  try {
    const employeeId = await findOrCreateEmployee(session.client_id, attendee);

    if (!additionalTraining.master_training_id) {
      await dbRun(
        `UPDATE attendee_certificates
         SET employee_id = ?, processing_status = 'no_catalog_match', processing_error = ?
         WHERE id = ?`,
        [
          employeeId,
          'This training used a custom label with no matching Master Training - no training record was created, but the employee is on file.',
          id,
        ]
      );
      return;
    }

    const record = await repo.saveTrainingRecord({
      client_id: session.client_id,
      employee_id: employeeId,
      training_id: additionalTraining.master_training_id,
      completion_date: session.session_date,
      source: 'Training Sign-In',
      notes: `Trainer: ${session.trainer_signed_name || session.trainer_name}. Session ID: ${session.session_id}.`,
    });

    if (certificatePath) {
      await repo.attachCertificateFile(record.record_id, {
        filename: certificateFilename,
        filePath: certificatePath,
      });
    }

    await dbRun(
      `UPDATE attendee_certificates
       SET employee_id = ?, training_record_id = ?, processing_status = 'linked', processing_error = NULL
       WHERE id = ?`,
      [employeeId, record.record_id, id]
    );
  } catch (err) {
    await dbRun(
      `UPDATE attendee_certificates SET processing_status = 'failed', processing_error = ? WHERE id = ?`,
      [String(err.message || err).slice(0, 500), id]
    );
  }
}

// Removes one sign-in from a session - open or closed (Keeley's request, 2026-09-24: attendees
// sometimes sign in twice by accident). On a closed session, that sign-in already produced its
// own certificate(s) and its own training record(s) in the employee's file (saveTrainingRecord
// never merges - every completion is its own row), so those go too; nothing another sign-in
// created is touched. The employee profile itself stays, since it may pre-date this session.
// Returns the removed attendee row, or null if it wasn't found on this session.
async function removeAttendee(sessionId, attendeeId) {
  const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [attendeeId, sessionId]);
  if (!attendee) return null;
  const extraCerts = await dbAll('SELECT * FROM attendee_certificates WHERE attendee_id = ?', [attendeeId]);
  const recordIds = [attendee.training_record_id, ...extraCerts.map((c) => c.training_record_id)].filter(Boolean);
  const records = recordIds.length
    ? await dbAll(`SELECT record_id, certificate_path FROM employee_training_records WHERE record_id IN (${recordIds.map(() => '?').join(', ')})`, recordIds)
    : [];

  // The attendee row goes first: it (and attendee_certificates, which cascade with it) references
  // the training records, so they can't be deleted while it's still there.
  await dbRun('DELETE FROM session_attendees WHERE attendee_id = ?', [attendeeId]);
  for (const record of records) {
    // eslint-disable-next-line no-await-in-loop
    await dbRun('DELETE FROM employee_training_records WHERE record_id = ?', [record.record_id]);
  }

  const files = new Set([attendee.certificate_path, ...extraCerts.map((c) => c.certificate_path), ...records.map((r) => r.certificate_path)].filter(Boolean));
  for (const file of files) fs.unlink(file, () => {});
  return attendee;
}

module.exports = { findOrCreateEmployee, processAttendee, processAttendeeAdditionalTraining, removeAttendee };
