// Training Report for one client (Keeley's request, 2026-10-27; any date range since 10/28): every
// training their people completed in the period, class by class, with who attended and whether their
// certificate is on file. Built from the training records themselves (completion_date in the
// period), so imported and hand-entered completions count too, not only sign-in sessions; a record
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

function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

// Any From/To date range (Keeley's request, 2026-10-28), or a whole month (YYYY-MM). A range that
// is exactly one calendar month is labeled by the month name.
function periodBounds({ month, from, to }) {
  if (month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    const lastDay = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    from = `${month}-01`;
    to = `${month}-${String(lastDay).padStart(2, '0')}`;
  }
  if (!isDate(from) || !isDate(to) || from > to) return null;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const wholeMonth = fy === ty && fm === tm && fd === 1 && td === new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return {
    start: from,
    end: to,
    key: wholeMonth ? from.slice(0, 7) : from === to ? from : `${from} to ${to}`,
    label: wholeMonth ? `${MONTH_NAMES[fm - 1]} ${fy}` : from === to ? usDate(from) : `${usDate(from)} – ${usDate(to)}`,
  };
}

// No clientId = every client (not the internal trainers' account), each class labeled with its client.
async function monthlyReportData(clientId, period) {
  const bounds = periodBounds(period);
  if (!bounds) return { error: 'Pick a From and To date (From can\'t be after To)' };
  const client = clientId
    ? await dbGet('SELECT client_id, client_name FROM clients WHERE client_id = ?', [clientId])
    : { client_id: null, client_name: 'All Clients' };
  if (!client) return { error: 'Client not found', notFound: true };

  const records = await dbAll(
    `SELECT r.*, e.full_name, e.first_name, e.last_name, e.job_title, mt.training_name AS master_training_name,
            t.first_name AS trainer_first, t.last_name AS trainer_last, t.full_name AS trainer_full,
            s.session_id, s.trainer_name AS session_trainer, s.location AS session_location, s.training_type_label,
            c.client_name
     FROM employee_training_records r
     JOIN clients c ON c.client_id = r.client_id
     JOIN employees e ON e.employee_id = r.employee_id
     JOIN master_trainings mt ON mt.training_id = r.training_id
     LEFT JOIN employees t ON t.employee_id = r.trainer_employee_id
     LEFT JOIN session_attendees a ON a.training_record_id = r.record_id
     LEFT JOIN attendee_certificates ac ON ac.training_record_id = r.record_id
     LEFT JOIN session_attendees a2 ON a2.attendee_id = ac.attendee_id
     LEFT JOIN training_sessions s ON s.session_id = COALESCE(a.session_id, a2.session_id)
     WHERE ${clientId ? 'r.client_id = ?' : 'c.is_internal = 0'} AND r.completion_date BETWEEN ? AND ?
       AND r.is_active_record = 1 AND r.is_inactive = 0`,
    clientId ? [clientId, bounds.start, bounds.end] : [bounds.start, bounds.end]
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
  const requirements = new Map((await dbAll(
    `SELECT * FROM client_training_requirements${clientId ? ' WHERE client_id = ?' : ''}`, clientId ? [clientId] : []
  )).map((q) => [`${q.client_id}|${q.training_id}`, q]));
  const masterById = new Map((await repo.listMasterTrainings({ activeOnly: false })).map((mt) => [mt.training_id, mt]));

  // One class per sign-in session and training (a session teaching two trainings together lists
  // each one); anything else (imports, manual entries) is grouped by training + date + trainer,
  // which is how those arrive.
  const classes = new Map();
  const seenRecords = new Set();
  for (const r of records) {
    if (seenRecords.has(r.record_id)) continue; // a record linked from two attendee rows
    seenRecords.add(r.record_id);
    const requirement = requirements.get(`${r.client_id}|${r.training_id}`) || null;
    const recordTrainer = r.trainer_employee_id ? displayFirstLast({ first_name: r.trainer_first, last_name: r.trainer_last, full_name: r.trainer_full }) : '';
    const key = r.session_id ? `${r.session_id}|${r.training_id}` : `${r.client_id}|${r.training_id}|${r.completion_date}|${r.trainer_employee_id || ''}`;
    if (!classes.has(key)) {
      const trainers = r.session_id ? [r.session_trainer, ...(coTrainers.get(r.session_id) || [])].filter(Boolean) : [recordTrainer].filter(Boolean);
      classes.set(key, {
        training: (r.source === 'Toolbox Talk Sign-In' && r.original_client_training_name) || requirement?.client_training_name || r.master_training_name,
        training_id: r.training_id,
        client: r.client_name,
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
  list.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client) || a.training.localeCompare(b.training));
  const allTrainees = list.flatMap((c) => c.trainees);
  const summary = {
    classes: list.length,
    people: new Set(records.map((r) => r.employee_id)).size,
    completions: allTrainees.length,
    certificates: allTrainees.filter((t) => t.certificate === 'Issued').length,
  };
  return { client, periodKey: bounds.key, periodLabel: bounds.label, classes: list, summary };
}

function fileBase(data) {
  return `${safeFilePart(data.client.client_name)} - Training Report - ${data.periodKey}`;
}

function toCsv(data) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Client', 'Period', 'Training', 'Date', 'Trainer', 'Location', 'Trainee', 'Job Title', 'Certificate', 'Expires'];
  const lines = data.classes.flatMap((c) => c.trainees.map((t) => [
    c.client, data.periodLabel, c.training, usDate(c.date), c.trainers, c.location, t.name, t.job_title, t.certificate, t.expires,
  ].map(escape).join(',')));
  // BOM so Excel opens accented names correctly.
  return `﻿${[header.map(escape).join(','), ...lines].join('\r\n')}`;
}

function writePdf(data, out) {
  const ctx = startReport(out, {
    label: 'Training Report',
    title: data.client.client_name,
    subLines: [`Trainings completed: ${data.periodLabel}`],
    docTitle: `${data.client.client_name} - Training Report - ${data.periodLabel}`,
  });
  drawTiles(ctx, [
    ['Classes', data.summary.classes, NAVY],
    ['People trained', data.summary.people, GREEN],
    ['Trainings completed', data.summary.completions, GREEN],
    ['Certificates issued', data.summary.certificates, GOLD_INK],
  ]);

  if (!data.classes.length) {
    drawTable(ctx, [{ key: 'x', label: '' }], [], { emptyText: `No trainings were completed in this period (${data.periodLabel}).` });
    return finishReport(ctx, `${data.client.client_name} · ${data.periodLabel}`);
  }

  // Overview: one line per class.
  const allClients = !data.client.client_id;
  drawSectionHeading(ctx, 'Trainings completed');
  drawTable(ctx, [
    { key: 'date', label: 'Date', weight: 1 },
    ...(allClients ? [{ key: 'client', label: 'Client', weight: 1.3 }] : []),
    { key: 'training', label: 'Training', weight: 2.5, bold: true },
    { key: 'trainers', label: 'Trainer', weight: 1.5 },
    { key: 'count', label: 'Trainees', weight: 0.75 },
    { key: 'certs', label: 'Certificates', weight: 1.05 },
  ], data.classes.map((c) => ({
    date: usDate(c.date),
    client: c.client,
    training: c.training,
    trainers: c.trainers,
    count: c.trainees.length,
    certs: `${c.trainees.filter((t) => t.certificate === 'Issued').length} of ${c.trainees.length}`,
  })));

  // Then each class with its attendees.
  for (const c of data.classes) {
    const sub = [usDate(c.date), allClients && c.client, c.trainers && `Trainer: ${c.trainers}`, c.location, `${c.trainees.length} trainee${c.trainees.length === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ');
    drawSectionHeading(ctx, c.training, sub);
    drawTable(ctx, [
      { key: 'n', label: '#', weight: 0.35 },
      { key: 'name', label: 'Trainee', weight: 2.2, bold: true },
      { key: 'job_title', label: 'Job Title', weight: 1.8 },
      { key: 'certificate', label: 'Certificate', weight: 1.1 },
      { key: 'expires', label: 'Expires', weight: 1.1 },
    ], c.trainees.map((t, i) => ({ ...t, n: i + 1 })));
  }
  finishReport(ctx, `${data.client.client_name} · ${data.periodLabel}`);
}

module.exports = { monthlyReportData, fileBase, toCsv, writePdf };
