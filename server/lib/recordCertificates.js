// Auto-generates a certificate of completion for a manually-entered or CSV-imported training
// record (Keeley's request) - reuses the same ESR-branded template as a Training Sign-In
// session's certificate, just without a trainee/trainer signature image since no live sign-in
// ever captured one; the trainer's typed name still appears if one is on file. Never touches a
// certificate an admin uploaded by hand (certificate_auto_generated stays 0 for those) - only
// ones this module generated itself, so a real document is never silently replaced.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const repo = require('./repo');
const { generateCertificate } = require('./pdfGen');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const RECORD_CERT_DIR = path.join(DATA_DIR, 'certificates', 'records');

async function maybeGenerateCertificate(recordId) {
  const record = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(recordId);
  if (!record) return;
  if (record.certificate_path && !record.certificate_auto_generated) return;

  const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(record.employee_id);
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(record.client_id);
  const masterTraining = repo.getMasterTraining(record.training_id);
  if (!employee || !client || !masterTraining) return;

  const trainer = record.trainer_employee_id
    ? db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(record.trainer_employee_id)
    : null;

  const filePath = path.join(RECORD_CERT_DIR, `${record.record_id}.pdf`);

  try {
    await generateCertificate(
      {
        session_id: `record-${record.record_id}`,
        client_name: client.client_name,
        training_type_label: record.original_client_training_name || masterTraining.training_name,
        session_date: record.completion_date,
        trainer_signed_name: trainer ? trainer.full_name : null,
        trainer_name: trainer ? trainer.full_name : null,
        trainer_signature: null,
      },
      { attendee_id: record.record_id, trainee_name: employee.full_name, signature: null },
      filePath
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Certificate auto-generation failed for record ${recordId}:`, err);
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE employee_training_records
     SET certificate_filename = ?, certificate_path = ?, certificate_uploaded_at = ?, certificate_auto_generated = 1, updated_at = ?
     WHERE record_id = ?`
  ).run(`certificate-${employee.full_name}.pdf`, filePath, now, now, recordId);
}

fs.mkdirSync(RECORD_CERT_DIR, { recursive: true });

module.exports = { maybeGenerateCertificate };
