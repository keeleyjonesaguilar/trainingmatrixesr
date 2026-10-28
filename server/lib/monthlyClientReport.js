// Monthly Training Report for one client (Keeley's request, 2026-10-27): every training their
// people completed in a calendar month, class by class, with who attended and whether their
// certificate is on file. Built from the training records themselves (completion_date in the
// month), so imported and hand-entered completions count too, not only sign-in sessions; a record
// that came from a sign-in session is grouped with the rest of that class and picks up its
// trainer(s) and location. Built on request and streamed back - nothing is saved.
const { dbGet, dbAll } = require('../db');
const repo = require('./repo');
const { computeStatus } = require('./statusEngine');
const { displayFirstLast } = require('./names');
const {
  GREEN, NAVY, GOLD_INK, usDate, startReport, drawTiles, drawSectionHeading, drawTable, finishReport, safeFilePart,
} = require('./reportPdf');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}`, label: `${MONTH_NAMES[mon - 1]} ${year}` };
}

async function monthlyReportData(clientId, month) {
  const bounds = monthBounds(month);
  if (!bounds) return { error: 'Pick a month (YYYY-MM)' };
  const client = await dbGet('SELECT client_id, client_name FROM clients WHERE client_id = ?', [clientId]);
  if (!client) return { error: 'Client not found', notFound: true };

  const records = await dbAll(
    `SELECT r.*, e.full_name, e.first_name, e.last_name, e.job_title, mt.training_name AS master_training_name,
            t.first_name AS trainer_first, t.last_name AS trainer_last, t.full_name AS trainer_full,
            s.session_id, s.trainer_name AS session_trainer, s.location AS session_location, s.training_type_label
     FROM employee_training_records r
     JOIN employees e ON e.employee_id = r.employee_id
     JOIN master_trainings mt ON mt.training_id = r.training_id
     LEFT JOIN employees t ON t.employee_id = r.trainer_employee_id
     LEFT JOIN session_attendees a ON a.training_record_id = r.record_id
     LEFT JOIN attendee_certificates ac ON ac.training_record_id = r.record_id
     LEFT JOIN session_attendees a2 ON a2.attendee_id = ac.attendee_id
     LEFT JOIN training_sessions s ON s.session_id = COALESCE(a.session_id, a2.session_id)
     WHERE r.client_id = ? AND r.completion_date BETWEEN ? AND ?
       AND r.is_active_record = 1 AND r.is_inactive = 0`,
    [clientId, bounds.start, bounds.end]
  );

  const sessionIds = [...new Set(records.map((r) => r.session_id).filter(Boolean))];
  const coTrainers = new Map();
  if (sessionIds.length) {
    const rows = await dbAll(
      `SELECT session_id, trainer_name FROM session_co_trainers WHERE session_id IN (${sessionIds.map(() => '?').join(',')}) ORDER BY display_order`,
      sessionIds
    );
    for (const row of rows) coTrainers.set(row.session_id, [...(coTrainers.get(row.session_id) || []), row.trainer_name]);
  }
  const requirements = new Map((await dbAll('SELECT * FROM client_training_requirements WHERE client_id = ?', [clientId])).map((q) => [q.training_id, q]));
  const masterById = new Map((await repo.listMasterTrainings({ activeOnly: false })).map((mt) => [mt.training_id, mt]));

  // One class per sign-in session and training (a session teaching two trainings together lists
  // each one); anything else (imports, manual entries) is grouped by training + date + trainer,
  // which is how those arrive.
  const classes = new Map();
  const seenRecords = new Set();
  for (const r of records) {
    if (seenRecords.has(r.record_id)) continue; // a record linked from two attendee rows
    seenRecords.add(r.record_id);
    const requirement = requirements.get(r.training_id) || null;
    const recordTrainer = r.trainer_employee_id ? displayFirstLast({ first_name: r.trainer_first, last_name: r.trainer_last, full_name: r.trainer_full }) : '';
    const key = r.session_id ? `${r.session_id}|${r.training_id}` : `${r.training_id}|${r.completion_date}|${r.trainer_employee_id || ''}`;
    if (!classes.has(key)) {
      const trainers = r.session_id ? [r.session_trainer, ...(coTrainers.get(r.session_id) || [])].filter(Boolean) : [recordTrainer].filter(Boolean);
      classes.set(key, {
        training: (r.source === 'Toolbox Talk Sign-In' && r.original_client_training_name) || requirement?.client_training_name || r.master_training_name,
        training_id: r.training_id,
        date: r.completion_date,
        trainers: trainers.join(', '),
        location: r.session_location || '',
        trainees: [],
      });
    }
    const { expirationDate } = computeStatus({ record: r, requirement, masterTraining: masterById.get(r.training_id) || null });
    classes.get(key).trainees.push({
      sortName: (r.full_name || '').toLowerCase(),
      name: displayFirstLast(r) || r.full_name,
      job_title: r.job_title || '',
      // Same test as the profile's training record export: a saved certificate, or one built on download.
      certificate: r.certificate_path || r.certificate_auto_generated ? 'Issued' : 'Not on file',
      expires: expirationDate ? usDate(expirationDate) : 'No expiration',
    });
  }

  const list = [...classes.values()];
  for (const c of list) c.trainees.sort((a, b) => a.sortName.localeCompare(b.sortName));
  list.sort((a, b) => a.date.localeCompare(b.date) || a.training.localeCompare(b.training));
  const allTrainees = list.flatMap((c) => c.trainees);
  const summary = {
    classes: list.length,
    people: new Set(records.map((r) => r.employee_id)).size,
    completions: allTrainees.length,
    certificates: allTrainees.filter((t) => t.certificate === 'Issued').length,
  };
  return { client, month, monthLabel: bounds.label, classes: list, summary };
}

function fileBase(data) {
  return `${safeFilePart(data.client.client_name)} - Monthly Training Report - ${data.month}`;
}

function toCsv(data) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Client', 'Month', 'Training', 'Date', 'Trainer', 'Location', 'Trainee', 'Job Title', 'Certificate', 'Expires'];
  const lines = data.classes.flatMap((c) => c.trainees.map((t) => [
    data.client.client_name, data.monthLabel, c.training, usDate(c.date), c.trainers, c.location, t.name, t.job_title, t.certificate, t.expires,
  ].map(escape).join(',')));
  // BOM so Excel opens accented names correctly.
  return `﻿${[header.map(escape).join(','), ...lines].join('\r\n')}`;
}

function writePdf(data, out) {
  const ctx = startReport(out, {
    label: 'Monthly Training Report',
    title: data.client.client_name,
    subLines: [`Trainings completed in ${data.monthLabel}`],
    docTitle: `${data.client.client_name} - Monthly Training Report - ${data.monthLabel}`,
  });
  drawTiles(ctx, [
    ['Classes', data.summary.classes, NAVY],
    ['People trained', data.summary.people, GREEN],
    ['Trainings completed', data.summary.completions, GREEN],
    ['Certificates issued', data.summary.certificates, GOLD_INK],
  ]);

  if (!data.classes.length) {
    drawTable(ctx, [{ key: 'x', label: '' }], [], { emptyText: `No trainings were completed in ${data.monthLabel}.` });
    return finishReport(ctx, `${data.client.client_name} · ${data.monthLabel}`);
  }

  // Overview: one line per class.
  drawSectionHeading(ctx, 'Trainings this month');
  drawTable(ctx, [
    { key: 'date', label: 'Date', weight: 0.8 },
    { key: 'training', label: 'Training', weight: 2.6, bold: true },
    { key: 'trainers', label: 'Trainer', weight: 1.6 },
    { key: 'count', label: 'Trainees', weight: 0.75 },
    { key: 'certs', label: 'Certificates', weight: 1.05 },
  ], data.classes.map((c) => ({
    date: usDate(c.date),
    training: c.training,
    trainers: c.trainers,
    count: c.trainees.length,
    certs: `${c.trainees.filter((t) => t.certificate === 'Issued').length} of ${c.trainees.length}`,
  })));

  // Then each class with its attendees.
  for (const c of data.classes) {
    const sub = [usDate(c.date), c.trainers && `Trainer: ${c.trainers}`, c.location, `${c.trainees.length} trainee${c.trainees.length === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ');
    drawSectionHeading(ctx, c.training, sub);
    drawTable(ctx, [
      { key: 'n', label: '#', weight: 0.35 },
      { key: 'name', label: 'Trainee', weight: 2.2, bold: true },
      { key: 'job_title', label: 'Job Title', weight: 1.8 },
      { key: 'certificate', label: 'Certificate', weight: 1.1 },
      { key: 'expires', label: 'Expires', weight: 1.1 },
    ], c.trainees.map((t, i) => ({ ...t, n: i + 1 })));
  }
  finishReport(ctx, `${data.client.client_name} · ${data.monthLabel}`);
}

module.exports = { monthlyReportData, fileBase, toCsv, writePdf };
