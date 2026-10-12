// Export an employee's training record as CSV or PDF (Keeley's request, 2026-10-12) - the
// "Export" buttons on their profile. Every completed training on file, the same list as the
// profile's Completed Trainings table (a training taken more than once has a row each time), with
// status worked out live the way every other page does. Built on request and streamed back -
// nothing is saved to disk or the database.
const path = require('path');
const PDFDocument = require('pdfkit');
const { dbGet, dbAll } = require('../db');
const repo = require('./repo');
const { computeStatus } = require('./statusEngine');
const { displayFirstLast } = require('./names');

const ASSETS = path.join(__dirname, '..', 'assets');
const GREEN = '#026754';
const GOLD = '#c49b0d';
const GOLD_INK = '#8a6c05';
const NAVY = '#1f3a53';
const TINT = '#eaf2ef';
const MUTED = '#62676f';
const RED = '#b42318';

function usDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (d || '');
}

function statusLabel(status, expiringSoon) {
  return expiringSoon ? 'Expiring Soon' : status;
}

async function exportData(employeeId) {
  const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [employeeId]);
  if (!employee) return null;
  const client = await dbGet('SELECT client_name, is_internal FROM clients WHERE client_id = ?', [employee.client_id]);
  const masterById = new Map((await repo.listMasterTrainings({ activeOnly: false })).map((mt) => [mt.training_id, mt]));
  const lookups = await repo.loadCellLookups([employee.employee_id], [employee.client_id]);
  const records = await dbAll(
    `SELECT r.*, mt.training_name AS master_training_name, t.first_name AS trainer_first, t.last_name AS trainer_last, t.full_name AS trainer_full
     FROM employee_training_records r
     JOIN master_trainings mt ON mt.training_id = r.training_id
     LEFT JOIN employees t ON t.employee_id = r.trainer_employee_id
     WHERE r.employee_id = ? AND r.is_inactive = 0 AND r.completion_date IS NOT NULL
     ORDER BY r.completion_date DESC, r.insert_seq DESC`,
    [employee.employee_id]
  );
  const rows = records.map((r) => {
    const requirement = lookups.requirementMap.get(`${employee.client_id}|${r.training_id}`) || null;
    const { status, expirationDate } = computeStatus({ record: r, requirement, masterTraining: masterById.get(r.training_id) || null });
    return {
      training_id: r.training_id,
      training: (r.source === 'Toolbox Talk Sign-In' && r.original_client_training_name) || requirement?.client_training_name || r.master_training_name,
      completed: r.completion_date,
      expires: expirationDate,
      status: statusLabel(status, repo.isExpiringSoon(status, expirationDate)),
      trainer: r.trainer_employee_id ? displayFirstLast({ first_name: r.trainer_first, last_name: r.trainer_last, full_name: r.trainer_full }) : '',
      certificate: Boolean(r.certificate_path || r.certificate_auto_generated),
      notes: r.notes || '',
    };
  });
  // A-Z by training, newest first within a training.
  rows.sort((a, b) => a.training.localeCompare(b.training) || String(b.completed).localeCompare(String(a.completed)));
  // Summary counts per training type (the latest completion of each), like the profile's tiles.
  const latest = new Map();
  for (const r of [...rows].sort((a, b) => String(b.completed).localeCompare(String(a.completed)))) if (!latest.has(r.training_id)) latest.set(r.training_id, r);
  const summary = { current: 0, expiringSoon: 0, expired: 0 };
  for (const r of latest.values()) {
    if (r.status === 'Current' || r.status === 'No Expiration') summary.current += 1;
    else if (r.status === 'Expiring Soon') { summary.current += 1; summary.expiringSoon += 1; } else if (r.status === 'Expired') summary.expired += 1;
  }
  const isTrainer = employee.employee_type === 'trainer';
  const company = isTrainer || employee.client_id === repo.INTERNAL_CLIENT_ID || client?.is_internal ? 'Evolution Safety Resources' : client?.client_name || '';
  return { employee, name: displayFirstLast(employee) || employee.full_name, company, rows, summary };
}

function fileBase(data) {
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${safe(data.name)} - Training Record${data.company ? ` - ${safe(data.company)}` : ''} - ${new Date().toISOString().slice(0, 10)}`;
}

function toCsv(data) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Employee', 'Company', 'Training', 'Completed', 'Expires', 'Status', 'Trainer', 'Certificate on file', 'Notes'];
  const lines = data.rows.map((r) => [
    data.name, data.company, r.training, usDate(r.completed), r.expires ? usDate(r.expires) : 'No expiration', r.status, r.trainer, r.certificate ? 'Yes' : 'No', r.notes,
  ].map(escape).join(','));
  // BOM so Excel opens accented names correctly.
  return `﻿${[header.map(escape).join(','), ...lines].join('\r\n')}`;
}

// Letter portrait, ESR theme: logo, gold rule, Montserrat headings over Open Sans text.
function writePdf(data, out) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true, info: { Title: `${data.name} - Training Record`, Author: 'Evolution Safety Resources' } });
  doc.registerFont('Head', path.join(ASSETS, 'fonts', 'Montserrat-Bold.woff'));
  doc.registerFont('HeadSemi', path.join(ASSETS, 'fonts', 'Montserrat-SemiBold.woff'));
  doc.registerFont('Body', path.join(ASSETS, 'fonts', 'OpenSans-Regular.woff'));
  doc.registerFont('BodySemi', path.join(ASSETS, 'fonts', 'OpenSans-SemiBold.woff'));
  doc.pipe(out);

  const left = 40;
  const width = doc.page.width - 80;
  const bottom = doc.page.height - 56;

  // Header
  doc.image(path.join(ASSETS, 'esr-logo-full.png'), left, 36, { height: 40 });
  doc.font('Head').fontSize(9).fillColor(GOLD_INK).text('TRAINING RECORD', left, 50, { width, align: 'right', characterSpacing: 1.6 });
  doc.rect(left, 86, width, 3).fill(GOLD);

  doc.font('Head').fontSize(20).fillColor(NAVY).text(data.name, left, 102, { width });
  const sub = [data.company, data.employee.job_title].filter(Boolean).join('  ·  ');
  if (sub) doc.font('Body').fontSize(10.5).fillColor(MUTED).text(sub, left, doc.y + 2, { width });
  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  doc.font('Body').fontSize(9).fillColor(MUTED).text(`Generated ${generated}`, left, doc.y + 2, { width });

  // Summary tiles
  let y = doc.y + 12;
  const tiles = [
    ['Current trainings', data.summary.current, GREEN],
    ['Expiring within 30 days', data.summary.expiringSoon, GOLD_INK],
    ['Expired', data.summary.expired, RED],
    ['Completions on file', data.rows.length, NAVY],
  ];
  const tileW = (width - 3 * 10) / 4;
  tiles.forEach(([label, value, color], i) => {
    const x = left + i * (tileW + 10);
    doc.rect(x, y, tileW, 50).fill(TINT);
    doc.rect(x, y, 3, 50).fill(color);
    doc.font('Head').fontSize(18).fillColor(color).text(String(value), x + 12, y + 7, { width: tileW - 16 });
    doc.font('HeadSemi').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x + 12, y + 32, { width: tileW - 16, characterSpacing: 0.6 });
  });
  y += 66;

  // Table
  const cols = [
    { key: 'training', label: 'Training', w: width - 70 - 75 - 82 - 120 },
    { key: 'completed', label: 'Completed', w: 70 },
    { key: 'expires', label: 'Expires', w: 75 },
    { key: 'status', label: 'Status', w: 82 },
    { key: 'trainer', label: 'Trainer', w: 120 },
  ];
  const statusColor = (s) => ({ Current: GREEN, 'No Expiration': GREEN, 'Expiring Soon': GOLD_INK, Expired: RED }[s] || NAVY);
  const cell = (r, key) => {
    if (key === 'completed') return usDate(r.completed);
    if (key === 'expires') return r.expires ? usDate(r.expires) : 'No expiration';
    return r[key] || '—';
  };
  const headerRow = () => {
    doc.rect(left, y, width, 20).fill(GREEN);
    let x = left;
    for (const c of cols) {
      doc.font('Head').fontSize(7.5).fillColor('#ffffff').text(c.label.toUpperCase(), x + 6, y + 6.5, { width: c.w - 12, characterSpacing: 0.6, lineBreak: false });
      x += c.w;
    }
    y += 20;
  };

  if (!data.rows.length) {
    doc.font('Body').fontSize(10.5).fillColor(MUTED).text('No completed trainings on file.', left, y);
  } else {
    headerRow();
    data.rows.forEach((r, i) => {
      doc.font('Body').fontSize(9);
      const h = Math.max(...cols.map((c) => doc.heightOfString(cell(r, c.key), { width: c.w - 12 }))) + 10;
      if (y + h > bottom) {
        doc.addPage();
        y = 40;
        headerRow();
      }
      if (i % 2 === 1) doc.rect(left, y, width, h).fill('#f6f7f9');
      let x = left;
      for (const c of cols) {
        const isStatus = c.key === 'status';
        doc.font(isStatus || c.key === 'training' ? 'BodySemi' : 'Body').fontSize(9)
          .fillColor(isStatus ? statusColor(r.status) : '#1a1d21')
          .text(cell(r, c.key), x + 6, y + 5, { width: c.w - 12 });
        x += c.w;
      }
      y += h;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor('#e2e5e9').stroke();
    });
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing below the margin would otherwise start a new page
    const fy = doc.page.height - 36;
    doc.rect(left, fy - 8, width, 0.75).fill(GOLD);
    doc.font('HeadSemi').fontSize(7.5).fillColor(GREEN).text('EVOLUTION SAFETY RESOURCES', left, fy, { width: width / 2, characterSpacing: 0.8, lineBreak: false });
    doc.font('Body').fontSize(7.5).fillColor(MUTED).text(`${data.name} · Page ${i - range.start + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
  }
  doc.end();
}

module.exports = { exportData, fileBase, toCsv, writePdf };
