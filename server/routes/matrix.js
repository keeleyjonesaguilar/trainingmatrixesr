const express = require('express');
const db = require('../db');
const repo = require('../lib/repo');

const router = express.Router();

// Training Matrix Screen (spec section 7/8): rows = employees, columns = the 52 Master
// Training IDs, cells show status/completion/expiration. Supports client/department/job
// title/search/status filtering, plus an implicit "All Clients" view when client_id is omitted.
router.get('/', (req, res) => {
  const { client_id, department, job_title, search, status } = req.query;

  const clauses = ['e.active = 1'];
  const params = [];
  if (client_id) { clauses.push('e.client_id = ?'); params.push(client_id); }
  if (department) { clauses.push('e.department = ?'); params.push(department); }
  if (job_title) { clauses.push('e.job_title = ?'); params.push(job_title); }
  if (search) { clauses.push('LOWER(e.full_name) LIKE ?'); params.push(`%${search.toLowerCase()}%`); }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const employees = db
    .prepare(
      `SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id ${where} ORDER BY c.client_name, e.full_name`
    )
    .all(...params);

  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });

  const rows = employees.map((emp) => {
    const cells = {};
    for (const mt of masterTrainings) {
      const { status: cellStatus, expirationDate, record } = repo.computeCell({
        employeeId: emp.employee_id,
        clientId: emp.client_id,
        trainingId: mt.training_id,
        masterTraining: mt,
      });
      cells[mt.training_id] = {
        status: cellStatus,
        expiration_date: expirationDate,
        completion_date: record ? record.completion_date : null,
        original_client_training_name: record ? record.original_client_training_name : null,
      };
    }
    return {
      employee_id: emp.employee_id,
      full_name: emp.full_name,
      job_title: emp.job_title,
      department: emp.department,
      client_id: emp.client_id,
      client_name: emp.client_name,
      cells,
    };
  });

  const filteredRows = status ? rows.filter((r) => Object.values(r.cells).some((c) => c.status === status)) : rows;

  res.json({ masterTrainings, employees: filteredRows });
});

module.exports = router;
