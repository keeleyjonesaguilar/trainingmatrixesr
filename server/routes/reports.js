// Reports (rebuilt 2026-08-18 per Keeley's request): a single, unified report of trainings
// employees have actually completed. The original 5-tab report system (Client Compliance,
// Employee Training, Training Compliance, Expiring Soon, Client Exceptions) is gone, along with
// the Missing/Not Applicable/etc. summary tiles that came with it - this follows the same
// "completion tracking, not compliance framing" philosophy already applied to Matrix.jsx and
// EmployeeDetail.jsx (Phase 6). If a training hasn't been completed, it never shows up here at
// all - there's no "Missing" row to report on.
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/completed-trainings', (req, res) => {
  const { client_id, employee_id, training_id } = req.query;

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

  const rows = db
    .prepare(
      `SELECT r.record_id, r.employee_id, e.full_name, r.client_id, c.client_name,
              r.training_id, m.training_name, r.completion_date, r.expiration_date, r.status,
              r.certificate_filename
       FROM employee_training_records r
       JOIN employees e ON e.employee_id = r.employee_id
       JOIN clients c ON c.client_id = r.client_id
       JOIN master_trainings m ON m.training_id = r.training_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.completion_date DESC`
    )
    .all(...params);

  res.json({ rows });
});

module.exports = router;
