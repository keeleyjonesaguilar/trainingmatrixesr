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

module.exports = router;
