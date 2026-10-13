// Corrects one of a closed session's extra trainings (session_additional_trainings) that was
// entered as the wrong catalog training (Keeley's request, 2026-10-13: LeoTerra's 10/12 class was
// TRN-092 Silica, not TRN-099 Trenching). Each attendee's certificate for it is rewritten over the
// same file, so no copy of the wrong one is left on disk; their training record for it is moved to
// the right training (same record, expiration recalculated); and the roster is rebuilt. Writes PDFs
// under DATA_DIR - run it on the live server only (see lib/oneTimeFixes.js).
const path = require('path');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { DATA_DIR } = require('./paths');
const { generateCertificate } = require('./pdfGen');
const { buildCertificateFilename } = require('./certificateFilename');
const { withDayTrainers } = require('./sessionDays');
const { regenerateRosters } = require('./sessionCloseOut');

// Returns how many attendees' certificates were rewritten, or null if the training wasn't
// `fromTrainingId` any more (already corrected by hand - left alone).
async function switchSessionTraining(sessionId, additionalTrainingId, fromTrainingId, toTrainingId) {
  const extra = await dbGet('SELECT * FROM session_additional_trainings WHERE id = ? AND session_id = ?', [additionalTrainingId, sessionId]);
  const master = await repo.getMasterTraining(toTrainingId);
  if (!extra || extra.master_training_id !== fromTrainingId || !master) return null;
  const label = `${master.training_id} - ${master.training_name}`;
  await dbRun('UPDATE session_additional_trainings SET master_training_id = ?, training_type_label = ? WHERE id = ?', [toTrainingId, label, extra.id]);

  const sessionRow = await dbGet(
    'SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?',
    [sessionId]
  );
  const trainingSession = { ...(await withDayTrainers(sessionRow)), training_type_label: label };
  const certs = await dbAll('SELECT * FROM attendee_certificates WHERE session_additional_training_id = ?', [extra.id]);
  let rewritten = 0;
  for (const cert of certs) {
    /* eslint-disable no-await-in-loop */
    const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ?', [cert.attendee_id]);
    const outputPath = path.join(DATA_DIR, 'certificates', 'sign-in-sessions', sessionId, `${cert.attendee_id}-${extra.id}.pdf`);
    let certPath = null;
    try {
      certPath = await generateCertificate(trainingSession, attendee, outputPath);
    } catch (err) {
      console.error(`Certificate rewrite failed for attendee ${cert.attendee_id}:`, err); // eslint-disable-line no-console
    }
    const filename = certPath ? buildCertificateFilename(trainingSession, attendee) : null;
    await dbRun('UPDATE attendee_certificates SET certificate_path = ?, certificate_filename = ? WHERE id = ?', [certPath, filename, cert.id]);
    const record = cert.training_record_id
      ? await dbGet('SELECT * FROM employee_training_records WHERE record_id = ?', [cert.training_record_id])
      : null;
    if (record) {
      await repo.saveTrainingRecord({
        record_id: record.record_id,
        client_id: record.client_id,
        employee_id: record.employee_id,
        training_id: toTrainingId,
        completion_date: record.completion_date,
        source: record.source,
        notes: record.notes,
      });
      await repo.attachCertificateFile(record.record_id, { filename, filePath: certPath });
    }
    if (certPath) rewritten += 1;
    /* eslint-enable no-await-in-loop */
  }

  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [sessionId]);
  const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  await regenerateRosters(sessionRow, attendees, additionalTrainings);
  return rewritten;
}

module.exports = { switchSessionTraining };
