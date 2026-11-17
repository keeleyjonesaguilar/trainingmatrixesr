// Auto-generates a certificate of completion for a manually-entered or CSV-imported training
// record (Keeley's request) - reuses the same ESR-branded template as a Training Sign-In
// session's certificate, just without a trainee/trainer signature image since no live sign-in
// ever captured one; the trainer's typed name still appears if one is on file. Never touches a
// certificate an admin uploaded by hand (certificate_auto_generated stays 0 for those) - only
// ones this module generated itself, so a real document is never silently replaced.
const fs = require('fs');
const path = require('path');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { generateCertificateBuffer } = require('./pdfGen');
const { buildCertificateFilename } = require('./certificateFilename');
const { displayFirstLast } = require('./names');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const RECORD_CERT_DIR = path.join(DATA_DIR, 'certificates', 'records');

// Same "Training Title_Client_Trainer_Date_Trainee Name.pdf" convention as a Training Sign-In
// certificate (Keeley's request, 2026-09-16) - used both when a record's certificate is first
// auto-generated and by the download route below, computed fresh each time (not trusted from the
// stored certificate_filename column) so it also applies to records generated before this change.
async function computeFilenameForRecord(record) {
  const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [record.employee_id]);
  const client = await dbGet('SELECT * FROM clients WHERE client_id = ?', [record.client_id]);
  const masterTraining = await repo.getMasterTraining(record.training_id);
  if (!employee || !client || !masterTraining) return null;
  const trainer = record.trainer_employee_id
    ? await dbGet('SELECT * FROM employees WHERE employee_id = ?', [record.trainer_employee_id])
    : null;
  return buildCertificateFilename(
    {
      training_type_label: record.original_client_training_name || masterTraining.training_name,
      client_name: client.client_name,
      trainer_signed_name: trainer ? displayFirstLast(trainer) : null,
      trainer_name: trainer ? displayFirstLast(trainer) : null,
      session_date: record.completion_date,
    },
    { trainee_name: displayFirstLast(employee) }
  );
}

// Marks an imported/hand-entered record as having an auto-generated certificate - nothing is
// built or saved here (Keeley's report, 2026-10-01: ~8,000 saved copies filled the live server's
// 1 GB disk). The PDF is built from the record when someone downloads it (sendRecordCertificate
// below), so it always shows the current name, training and trainer. A certificate an admin
// uploaded by hand is never touched; a copy saved by the old version of this code is removed.
async function maybeGenerateCertificate(recordId) {
  const record = await dbGet('SELECT * FROM employee_training_records WHERE record_id = ?', [recordId]);
  if (!record) return;
  if (record.certificate_path && !record.certificate_auto_generated) return;
  const filename = await computeFilenameForRecord(record);
  if (!filename) return;
  if (record.certificate_path && fs.existsSync(record.certificate_path)) fs.unlink(record.certificate_path, () => {});
  const now = new Date().toISOString();
  await dbRun(
    `UPDATE employee_training_records
     SET certificate_filename = ?, certificate_path = NULL, certificate_uploaded_at = COALESCE(certificate_uploaded_at, ?), certificate_auto_generated = 1, updated_at = ?
     WHERE record_id = ?`,
    [filename, now, now, recordId]
  );
}

// The same as maybeGenerateCertificate, for every imported/hand-entered record that never got one
// (Keeley's report, 2026-11-17: 7,747 records written straight to the database by the Z: drive
// sign-in check and Vairkko syncs skipped the import page, so they had no certificate to
// download). One read and a few batched updates instead of ~5 queries per record, since this runs
// while the live server starts up. `dryRun` only counts and returns a few sample names.
async function markMissingRecordCertificates({ dryRun = false } = {}) {
  const rows = await dbAll(
    `SELECT r.record_id, r.original_client_training_name, r.completion_date, mt.training_name, c.client_name,
            e.first_name, e.last_name, e.full_name
       FROM employee_training_records r
       JOIN employees e ON e.employee_id = r.employee_id
       JOIN clients c ON c.client_id = r.client_id
       JOIN master_trainings mt ON mt.training_id = r.training_id
      WHERE COALESCE(r.certificate_auto_generated, 0) = 0 AND r.certificate_path IS NULL
        AND (r.source LIKE 'Import:%' OR r.source = 'Manual Entry')`
  );
  const named = rows.map((r) => ({
    id: r.record_id,
    filename: buildCertificateFilename(
      { training_type_label: r.original_client_training_name || r.training_name, client_name: r.client_name, session_date: r.completion_date },
      { trainee_name: displayFirstLast(r) }
    ),
  }));
  if (dryRun) return { count: named.length, samples: named.slice(0, 5).map((n) => n.filename) };
  const now = new Date().toISOString();
  for (let i = 0; i < named.length; i += 500) {
    const batch = named.slice(i, i + 500);
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `UPDATE employee_training_records AS r
          SET certificate_filename = v.filename, certificate_auto_generated = 1,
              certificate_uploaded_at = COALESCE(r.certificate_uploaded_at, ?)
         FROM (VALUES ${batch.map(() => '(?, ?)').join(', ')}) AS v(record_id, filename)
        WHERE r.record_id = v.record_id AND COALESCE(r.certificate_auto_generated, 0) = 0 AND r.certificate_path IS NULL`,
      [now, ...batch.flatMap((n) => [n.id, n.filename])]
    );
  }
  return { count: named.length };
}

// Builds an auto-generated certificate in memory from the record as it is right now.
async function buildRecordCertificate(record) {
  const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [record.employee_id]);
  const client = await dbGet('SELECT * FROM clients WHERE client_id = ?', [record.client_id]);
  const masterTraining = await repo.getMasterTraining(record.training_id);
  if (!employee || !client || !masterTraining) return null;
  const trainer = record.trainer_employee_id
    ? await dbGet('SELECT * FROM employees WHERE employee_id = ?', [record.trainer_employee_id])
    : null;
  return generateCertificateBuffer(
    {
      session_id: `record-${record.record_id}`,
      client_name: client.client_name,
      training_type_label: record.original_client_training_name || masterTraining.training_name,
      session_date: record.completion_date,
      trainer_signed_name: trainer ? displayFirstLast(trainer) : null,
      trainer_name: trainer ? displayFirstLast(trainer) : null,
      trainer_signature: null,
    },
    { attendee_id: record.record_id, trainee_name: displayFirstLast(employee), signature: null }
  );
}

// Whether a record has a certificate to download: a saved file (uploaded by hand, or a signed
// sign-in certificate), or an auto-generated one built on download.
function recordHasCertificate(record) {
  return Boolean(record.certificate_auto_generated || (record.certificate_path && fs.existsSync(record.certificate_path)));
}

// Sends a record's certificate - the saved file when there is one, otherwise the auto-generated
// one built on the spot. Responds 404 when the record has neither.
// `inline` opens it in the browser instead of downloading (the public QR record page, viewed on a
// phone on site).
async function sendRecordCertificate(res, record, { inline = false } = {}) {
  const setName = (filename) => {
    res.attachment(filename);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  };
  if (record.certificate_path && fs.existsSync(record.certificate_path)) {
    const filename = record.certificate_auto_generated
      ? (await computeFilenameForRecord(record)) || record.certificate_filename || 'certificate.pdf'
      : record.certificate_filename || 'certificate.pdf';
    if (!inline) return res.download(record.certificate_path, filename);
    setName(filename);
    return res.sendFile(path.resolve(record.certificate_path));
  }
  if (!record.certificate_auto_generated) return res.status(404).json({ error: 'No certificate on file for this record' });
  const pdf = await buildRecordCertificate(record);
  if (!pdf) return res.status(404).json({ error: 'No certificate on file for this record' });
  const filename = (await computeFilenameForRecord(record)) || record.certificate_filename || 'certificate.pdf';
  setName(filename);
  res.type('application/pdf');
  return res.send(pdf);
}

module.exports = { maybeGenerateCertificate, markMissingRecordCertificates, computeFilenameForRecord, buildRecordCertificate, recordHasCertificate, sendRecordCertificate, RECORD_CERT_DIR };
