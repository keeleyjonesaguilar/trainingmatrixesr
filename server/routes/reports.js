// Reports (rebuilt 2026-08-18 per Keeley's request): a single, unified report of trainings
// employees have actually completed. The original 5-tab report system (Client Compliance,
// Employee Training, Training Compliance, Expiring Soon, Client Exceptions) is gone, along with
// the Missing/Not Applicable/etc. summary tiles that came with it - this follows the same
// "completion tracking, not compliance framing" philosophy already applied to Matrix.jsx and
// EmployeeDetail.jsx (Phase 6). If a training hasn't been completed, it never shows up here at
// all - there's no "Missing" row to report on.
const express = require('express');
const { dbAll } = require('../db');
const { logActivity } = require('../lib/activityLog');
const {
  GREEN, NAVY, RED, startReport, drawTiles, drawSectionHeading, drawTable, finishReport, sendAs, safeFilePart,
} = require('../lib/reportPdf');
const monthly = require('../lib/monthlyClientReport');

const router = express.Router();

// Logs a CSV report download from the client (this page, the Employees Matrix, or a client's
// Compliance Overview) - every one of those builds its CSV entirely client-side from data
// already loaded, so this endpoint has no other purpose than recording that someone did it
// (Keeley's request, 2026-09-18).
router.post('/log-download', async (req, res) => {
  const { report_name, details } = req.body || {};
  if (!report_name) return res.status(400).json({ error: 'report_name is required' });
  logActivity({
    actor: req.user, action: 'report_downloaded', entityType: 'report', entityLabel: report_name, details, req,
  });
  res.json({ ok: true });
});

router.get('/completed-trainings', async (req, res) => {
  const { client_id, employee_id, training_id, status } = req.query;

  // is_active_record = 1 excludes only a record superseded by an old merge from before Keeley
  // asked to stop treating repeat completions as duplicates - every completion made since then
  // is its own row and stays active. completion_date IS NOT NULL is what "completed" means: a
  // record with no completion date
  // on file (e.g. an unresolved "YES" from an import, still Pending Review) isn't a confirmed
  // completion yet, so it's excluded rather than shown as an ambiguous row.
  const clauses = ['r.completion_date IS NOT NULL', 'r.is_active_record = 1', 'r.is_inactive = 0', 'c.is_internal = 0'];
  const params = [];
  if (client_id) { clauses.push('r.client_id = ?'); params.push(client_id); }
  if (employee_id) { clauses.push('r.employee_id = ?'); params.push(employee_id); }
  if (training_id) { clauses.push('r.training_id = ?'); params.push(training_id); }
  // Status filter (Keeley's request, 2026-09-21) - e.g. isolate just Expired trainings for a
  // report. Every completed row already has a status, so this is a plain equality match, same
  // as the Employees/Client Compliance pages' own status filter.
  if (status) { clauses.push('r.status = ?'); params.push(status); }

  const rows = await dbAll(
    `SELECT r.record_id, r.employee_id, e.full_name, r.client_id, c.client_name,
            r.training_id, m.training_name, r.completion_date, r.expiration_date, r.status,
            r.certificate_filename
     FROM employee_training_records r
     JOIN employees e ON e.employee_id = r.employee_id
     JOIN clients c ON c.client_id = r.client_id
     JOIN master_trainings m ON m.training_id = r.training_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.completion_date DESC`,
    params
  );

  res.json({ rows });
});

// PDF version of a report page's table (Keeley's request, 2026-10-27) - the Reports page, the
// Employees list and a client's Compliance Overview each send the exact rows they'd put in their
// CSV (already filtered on screen), and this lays them out in the ESR report style. With
// group_by set, rows are listed under one heading per value of that field (e.g. per employee).
router.post('/table.pdf', async (req, res) => {
  const { report_name, title, sub_lines, columns, rows, group_by } = req.body || {};
  if (!title || !Array.isArray(columns) || !columns.length || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'title, columns and rows are required' });
  }
  if (rows.length > 25000) return res.status(400).json({ error: 'Too many rows for one PDF - narrow the filters first' });
  logActivity({
    actor: req.user, action: 'report_downloaded', entityType: 'report', entityLabel: report_name || title, details: `PDF · ${rows.length} row(s)`, req,
  });

  const statuses = rows.map((r) => r.status);
  const tiles = [['Records', rows.length, NAVY]];
  if (rows.some((r) => r.employee)) tiles.push(['Employees', new Set(rows.map((r) => (group_by && r[group_by]) || r.employee)).size, NAVY]);
  if (statuses.some(Boolean)) {
    tiles.push(['Current', statuses.filter((s) => s === 'Current' || s === 'No Expiration').length, GREEN]);
    tiles.push(['Expired', statuses.filter((s) => s === 'Expired').length, RED]);
  }

  sendAs(res, `${safeFilePart(title)} - ${new Date().toISOString().slice(0, 10)}.pdf`, 'application/pdf');
  const ctx = startReport(res, {
    label: 'Training Report', title, subLines: Array.isArray(sub_lines) ? sub_lines.map(String) : [], landscape: columns.length > 6,
  });
  drawTiles(ctx, tiles);
  if (group_by) {
    const shown = columns.filter((c) => c.key !== group_by);
    const groups = new Map();
    for (const r of rows) {
      const key = r[group_by] || '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    if (!groups.size) drawTable(ctx, shown, [], { emptyText: 'No records match these filters.' });
    for (const [key, groupRows] of groups) {
      drawSectionHeading(ctx, key);
      drawTable(ctx, shown, groupRows);
    }
  } else {
    drawTable(ctx, columns, rows, { emptyText: 'No records match these filters.' });
  }
  finishReport(ctx, title);
});

// Training Report for one client, for a month or any From/To range (Keeley's requests, 2026-10-27
// and 10-28) - lib/monthlyClientReport.js.
router.get('/monthly-client.:format(csv|pdf)', async (req, res) => {
  const { month, from, to } = req.query;
  const data = await monthly.monthlyReportData(req.query.client_id, { month, from, to });
  if (data.error) return res.status(data.notFound ? 404 : 400).json({ error: data.error });
  logActivity({
    actor: req.user, action: 'report_downloaded', entityType: 'report', entityLabel: `${data.client.client_name} Training Report`,
    details: `${data.periodLabel} · ${req.params.format.toUpperCase()}`, req,
  });
  sendAs(res, `${monthly.fileBase(data)}.${req.params.format}`, req.params.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
  if (req.params.format === 'csv') res.send(monthly.toCsv(data));
  else monthly.writePdf(data, res);
});

module.exports = router;
