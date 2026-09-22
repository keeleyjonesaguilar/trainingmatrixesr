// Auto-generates a certificate of completion for a manually-entered or CSV-imported training
// record (Keeley's request) - reuses the same ESR-branded template as a Training Sign-In
// session's certificate, just without a trainee/trainer signature image since no live sign-in
// ever captured one; the trainer's typed name still appears if one is on file. Never touches a
// certificate an admin uploaded by hand (certificate_auto_generated stays 0 for those) - only
// ones this module generated itself, so a real document is never silently replaced.
const fs = require('fs');
const path = require('path');
const { dbGet, dbRun } = require('../db');
const repo = require('./repo');
const { generateCertificate } = require('./pdfGen');
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

async function maybeGenerateCertificate(recordId) {
  const record = await dbGet('SELECT * FROM employee_training_records WHERE record_id = ?', [recordId]);
  if (!record) return;
  if (record.certificate_path && !record.certificate_auto_generated) return;

  const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [record.employee_id]);
  const client = await dbGet('SELECT * FROM clients WHERE client_id = ?', [record.client_id]);
  const masterTraining = await repo.getMasterTraining(record.training_id);
  if (!employee || !client || !masterTraining) return;

  const trainer = record.trainer_employee_id
    ? await dbGet('SELECT * FROM employees WHERE employee_id = ?', [record.trainer_employee_id])
    : null;

  const filePath = path.join(RECORD_CERT_DIR, `${record.record_id}.pdf`);

  try {
    await generateCertificate(
      {
        session_id: `record-${record.record_id}`,
        client_name: client.client_name,
        training_type_label: record.original_client_training_name || masterTraining.training_name,
        session_date: record.completion_date,
        trainer_signed_name: trainer ? displayFirstLast(trainer) : null,
        trainer_name: trainer ? displayFirstLast(trainer) : null,
        trainer_signature: null,
      },
      { attendee_id: record.record_id, trainee_name: displayFirstLast(employee), signature: null },
      filePath
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Certificate auto-generation failed for record ${recordId}:`, err);
    return;
  }

  const now = new Date().toISOString();
  const filename = buildCertificateFilename(
    {
      training_type_label: record.original_client_training_name || masterTraining.training_name,
      client_name: client.client_name,
      trainer_signed_name: trainer ? displayFirstLast(trainer) : null,
      trainer_name: trainer ? displayFirstLast(trainer) : null,
      session_date: record.completion_date,
    },
    { trainee_name: displayFirstLast(employee) }
  );
  await dbRun(
    `UPDATE employee_training_records
     SET certificate_filename = ?, certificate_path = ?, certificate_uploaded_at = ?, certificate_auto_generated = 1, updated_at = ?
     WHERE record_id = ?`,
    [filename, filePath, now, now, recordId]
  );
}

fs.mkdirSync(RECORD_CERT_DIR, { recursive: true });

module.exports = { maybeGenerateCertificate, computeFilenameForRecord };
