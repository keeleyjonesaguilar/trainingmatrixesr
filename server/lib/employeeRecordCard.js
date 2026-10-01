// An employee's scannable training record (Keeley's request, 2026-09-30): the QR code on their
// profile opens /r/<record_token>, a public read-only page listing their current trainings. No
// contact details are ever included - it's meant to be scanned by whoever is on site.
const crypto = require('crypto');
const QRCode = require('qrcode');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { computeStatus } = require('./statusEngine');
const { displayFirstLast } = require('./names');

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

async function ensureRecordToken(employeeId) {
  const row = await dbGet('SELECT record_token FROM employees WHERE employee_id = ?', [employeeId]);
  if (!row) return null;
  if (row.record_token) return row.record_token;
  const token = crypto.randomBytes(18).toString('base64url');
  await dbRun('UPDATE employees SET record_token = ? WHERE employee_id = ? AND record_token IS NULL', [token, employeeId]);
  return (await dbGet('SELECT record_token FROM employees WHERE employee_id = ?', [employeeId])).record_token;
}

async function resetRecordToken(employeeId) {
  await dbRun('UPDATE employees SET record_token = NULL WHERE employee_id = ?', [employeeId]);
  return ensureRecordToken(employeeId);
}

function recordPath(token) {
  return `/r/${token}`;
}

async function recordQrPng(employeeId, base = publicBaseUrl()) {
  const token = await ensureRecordToken(employeeId);
  return token ? QRCode.toBuffer(`${base.replace(/\/$/, '')}${recordPath(token)}`, { type: 'png', width: 600, margin: 2 }) : null;
}

// The most recent completion of each training on an employee's profile, with its live status
// (same computeStatus every other page uses). Shared by the public QR record and the portal.
async function latestTrainings(employee) {
  const records = await dbAll(
    `SELECT r.*, mt.training_name AS master_training_name FROM employee_training_records r
     JOIN master_trainings mt ON mt.training_id = r.training_id
     WHERE r.employee_id = ? AND r.is_inactive = 0 AND r.completion_date IS NOT NULL
     ORDER BY r.completion_date DESC, r.insert_seq DESC`,
    [employee.employee_id]
  );
  const latest = new Map();
  for (const r of records) if (!latest.has(r.training_id)) latest.set(r.training_id, r);
  const trainings = [];
  for (const r of latest.values()) {
    // eslint-disable-next-line no-await-in-loop
    const requirement = await repo.getRequirement(employee.client_id, r.training_id);
    // eslint-disable-next-line no-await-in-loop
    const masterTraining = await repo.getMasterTraining(r.training_id);
    const { status, expirationDate } = computeStatus({ record: r, requirement, masterTraining });
    trainings.push({
      record_id: r.record_id,
      has_certificate: Boolean(r.certificate_path || r.certificate_auto_generated),
      training_id: r.training_id,
      training_name: (r.source === 'Toolbox Talk Sign-In' && r.original_client_training_name)
        || requirement?.client_training_name || r.master_training_name,
      completion_date: r.completion_date,
      expiration_date: expirationDate,
      status,
    });
  }
  trainings.sort((a, b) => a.training_name.localeCompare(b.training_name));
  return trainings;
}

// The public record: name, company, and each training's latest completion and status.
async function publicRecord(token) {
  const employee = await dbGet('SELECT * FROM employees WHERE record_token = ?', [String(token || '')]);
  if (!employee) return null;
  const client = await dbGet('SELECT client_id, client_name, is_internal FROM clients WHERE client_id = ?', [employee.client_id]);
  const logo = await dbGet('SELECT updated_at FROM client_logos WHERE client_id = ?', [employee.client_id]);
  const trainings = (await latestTrainings(employee)).map(({ training_id, training_name, completion_date, expiration_date, status }) => ({
    training_id, training_name, completion_date, expiration_date, status,
  }));
  return {
    name: displayFirstLast(employee),
    job_title: employee.job_title || null,
    company: client && !client.is_internal ? client.client_name : 'Evolution Safety Resources',
    company_logo_url: logo ? `/api/public-record/${encodeURIComponent(token)}/logo?v=${encodeURIComponent(logo.updated_at)}` : null,
    is_trainer: Boolean(employee.is_trainer) || employee.employee_type === 'trainer',
    active: Boolean(employee.active),
    trainings,
  };
}

module.exports = { ensureRecordToken, resetRecordToken, recordPath, recordQrPng, publicRecord, latestTrainings };
