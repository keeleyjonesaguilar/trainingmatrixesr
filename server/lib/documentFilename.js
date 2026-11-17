// The name an uploaded employee document (a scanned OSHA/AHA card, a medical eval...) downloads
// under - "Label_Client_Date_Trainee Name.pdf", the same convention as certificates (Keeley's
// request, 2026-11-17). Worked out fresh on every download, so documents uploaded before this
// change get it too; the stored original filename is only used for its extension and as a fallback.
const path = require('path');
const { dbGet } = require('../db');
const { buildDocumentFilename } = require('./certificateFilename');
const { displayFirstLast } = require('./names');

async function documentDownloadName(document) {
  const fallback = document.filename || 'document.pdf';
  try {
    const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [document.employee_id]);
    if (!employee) return fallback;
    // The class the card is from: the employee's latest completion of that training on or before
    // the day it was uploaded (a card is scanned after the class), else their latest one at all.
    let record = null;
    if (document.training_id) {
      const uploadedDay = String(document.uploaded_at || '').slice(0, 10) || '9999-12-31';
      record = await dbGet(
        `SELECT client_id, completion_date FROM employee_training_records
          WHERE employee_id = ? AND training_id = ? AND completion_date <= ?
          ORDER BY completion_date DESC LIMIT 1`,
        [employee.employee_id, document.training_id, uploadedDay]
      ) || await dbGet(
        `SELECT client_id, completion_date FROM employee_training_records
          WHERE employee_id = ? AND training_id = ? ORDER BY completion_date DESC LIMIT 1`,
        [employee.employee_id, document.training_id]
      );
    }
    const client = await dbGet('SELECT client_name FROM clients WHERE client_id = ?', [record?.client_id || employee.client_id]);
    const ext = path.extname(document.filename || document.file_path || '').toLowerCase() || '.pdf';
    return buildDocumentFilename({
      label: document.label,
      client_name: client?.client_name,
      date: record?.completion_date,
      trainee_name: displayFirstLast(employee),
    }, ext);
  } catch (e) {
    console.error('documentDownloadName failed:', e.message);
    return fallback;
  }
}

module.exports = { documentDownloadName };
