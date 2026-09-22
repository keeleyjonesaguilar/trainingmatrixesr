// Certificate ZIPs for a closed session - shared by the admin "Download Certificates" button
// (server/routes/trainingSessions.js GET /:sessionId/certificates.zip) and the close-out email
// that sends the trainer their completed forms (server/routes/publicSessions.js).
const fs = require('fs');
const { PassThrough } = require('stream');
const archiver = require('archiver');
const { dbAll } = require('../db');
const { buildCertificateFilename, stripTrainingIdPrefix, shortClientName } = require('./certificateFilename');

// Every certificate on file for one training on the session - `additionalTraining` null means the
// session's own (primary) training, otherwise a session_additional_trainings row. Skips anyone
// whose certificate generation failed rather than erroring over one bad row.
async function listCertificateFiles(session, additionalTraining = null) {
  if (!additionalTraining) {
    const attendees = (await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]))
      .filter((a) => a.certificate_path && fs.existsSync(a.certificate_path));
    return attendees.map((a) => ({ path: a.certificate_path, name: buildCertificateFilename(session, a) }));
  }
  const trainingSession = { ...session, training_type_label: additionalTraining.training_type_label };
  const rows = (await dbAll(
    `SELECT ac.*, sa.trainee_name FROM attendee_certificates ac
     JOIN session_attendees sa ON sa.attendee_id = ac.attendee_id
     WHERE ac.session_additional_training_id = ? ORDER BY sa.signed_at`,
    [additionalTraining.id]
  )).filter((r) => r.certificate_path && fs.existsSync(r.certificate_path));
  return rows.map((r) => ({ path: r.certificate_path, name: buildCertificateFilename(trainingSession, r) }));
}

function certificateZipName(session, trainingLabel) {
  return ['certificates', stripTrainingIdPrefix(trainingLabel), shortClientName(session.client_name), session.session_date]
    .map((s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim())
    .join('_');
}

// Streams a zip of `files` into `output` (an HTTP response, or any writable stream).
function createCertificateZip(files) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  for (const f of files) archive.file(f.path, { name: f.name });
  return archive;
}

// Same zip, collected in memory - for attaching to an email.
async function certificateZipBuffer(files) {
  const archive = createCertificateZip(files);
  const sink = new PassThrough();
  const chunks = [];
  sink.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    sink.on('end', resolve);
    archive.on('error', reject);
  });
  archive.pipe(sink);
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

module.exports = { listCertificateFiles, certificateZipName, createCertificateZip, certificateZipBuffer };
