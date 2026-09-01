// Bridges a Training Sign-In session's attendees into the Matrix's own employee records -
// this is what used to be a separate app calling this one over HTTP (matrixSync.js, now
// deleted). Since the merge, it's just direct database calls in the same process: find-or-
// create the employee, save their training record via repo.saveTrainingRecord (the exact same
// path a manual entry uses), and attach the generated certificate. Nothing here is optional/
// toggleable anymore - it runs every time a session is closed.
const { dbAll, dbRun } = require('./../db');
const { v4: uuidv4 } = require('uuid');
const repo = require('./repo');
const { formatPhoneNumber } = require('./phone');

// Matches an attendee to an existing employee at this client by name or phone, or creates a
// new one - same matching rule the old cross-app sync used (name OR phone, scoped to the
// client), just running in-process now instead of over HTTP.
async function findOrCreateEmployee(clientId, attendee) {
  const normalizedPhone = (attendee.trainee_phone || '').replace(/\D/g, '');
  const candidates = await dbAll('SELECT * FROM employees WHERE client_id = ?', [clientId]);
  const match = candidates.find((e) => {
    const nameMatch = (e.full_name || '').trim().toLowerCase() === attendee.trainee_name.trim().toLowerCase();
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
    `INSERT INTO employees (employee_id, client_id, employee_number, full_name, job_title, active, notes)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [
      employee_id,
      clientId,
      formatPhoneNumber(attendee.trainee_phone || null),
      attendee.trainee_name.trim(),
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
  if (certificatePath) {
    await dbRun('UPDATE session_attendees SET certificate_path = ?, certificate_filename = ? WHERE attendee_id = ?', [
      certificatePath,
      `certificate-${attendee.trainee_name}.pdf`,
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
        filename: `certificate-${attendee.trainee_name}.pdf`,
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

module.exports = { findOrCreateEmployee, processAttendee };
