const express = require('express');
const db = require('../db');
const repo = require('../lib/repo');

const router = express.Router();

// Training Matrix Screen (spec section 7/8): rows = employees, columns = the 52 Master
// Training IDs, cells show status/completion/expiration. Supports client/department/job
// title/search/status filtering, plus an implicit "All Clients" view when client_id is omitted.
//
// training_ids (repeatable query param, e.g. ?training_ids=TRN-001&training_ids=TRN-006):
// job-site placement filter (Keeley's request) - only return employees who currently hold
// EVERY listed training (status Current or No Expiration - an expired one doesn't count),
// so she can quickly find someone who has, say, OSHA 30 AND First Aid AND Fall Protection.
router.get('/', (req, res) => {
  const { client_id, department, job_title, search, status } = req.query;
  const trainingIdsFilter = [req.query.training_ids || []].flat().filter(Boolean);
  // Which set the grid itself shows - defaults to active, switches to inactive when the
  // "Inactive Employees" stat tile is clicked (Keeley's request: make that tile clickable).
  const activeFilter = req.query.active === '0' ? 0 : 1;

  const sharedClauses = ['c.is_internal = 0'];
  const params = [];
  if (client_id) { sharedClauses.push('e.client_id = ?'); params.push(client_id); }
  if (department) { sharedClauses.push('e.department = ?'); params.push(department); }
  if (job_title) { sharedClauses.push('e.job_title = ?'); params.push(job_title); }
  if (search) { sharedClauses.push('LOWER(e.full_name) LIKE ?'); params.push(`%${search.toLowerCase()}%`); }
  const where = `WHERE e.active = ? AND ${sharedClauses.join(' AND ')}`;

  const employees = db
    .prepare(
      `SELECT e.*, c.client_name FROM employees e JOIN clients c ON c.client_id = e.client_id ${where} ORDER BY c.client_name, e.full_name`
    )
    .all(activeFilter, ...params);

  // Both counts are always computed regardless of which set the grid is currently showing, so
  // the two stat tiles stay accurate no matter which one is currently selected.
  const activeCount = activeFilter === 1 ? employees.length : db
    .prepare(`SELECT COUNT(*) AS n FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.active = 1 AND ${sharedClauses.join(' AND ')}`)
    .get(...params).n;
  const inactiveCount = activeFilter === 0 ? employees.length : db
    .prepare(`SELECT COUNT(*) AS n FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.active = 0 AND ${sharedClauses.join(' AND ')}`)
    .get(...params).n;

  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });

  let orgCurrent = 0;
  let orgExpiringSoon = 0;
  let orgExpiredOrMissing = 0;
  let orgApplicable = 0;

  const rows = employees.map((emp) => {
    const cells = {};
    let empCurrent = 0;
    let empApplicable = 0;
    let empIssues = 0;
    for (const mt of masterTrainings) {
      const { status: cellStatus, expirationDate, record } = repo.computeCell({
        employeeId: emp.employee_id,
        clientId: emp.client_id,
        trainingId: mt.training_id,
        masterTraining: mt,
      });
      const expiringSoon = repo.isExpiringSoon(cellStatus, expirationDate);
      cells[mt.training_id] = {
        status: cellStatus,
        expiration_date: expirationDate,
        completion_date: record ? record.completion_date : null,
        original_client_training_name: record ? record.original_client_training_name : null,
        expiring_soon: expiringSoon,
      };

      if (cellStatus !== 'Not Applicable') {
        empApplicable += 1;
        orgApplicable += 1;
        if (cellStatus === 'Current' || cellStatus === 'No Expiration') { empCurrent += 1; orgCurrent += 1; }
        if (cellStatus === 'Expired' || cellStatus === 'Missing') { empIssues += 1; orgExpiredOrMissing += 1; }
      }
      if (expiringSoon) orgExpiringSoon += 1;
    }
    return {
      employee_id: emp.employee_id,
      full_name: emp.full_name,
      job_title: emp.job_title,
      department: emp.department,
      client_id: emp.client_id,
      client_name: emp.client_name,
      cells,
      audit_health_percent: empApplicable > 0 ? Math.round((empCurrent / empApplicable) * 100) : 100,
      issue_count: empIssues,
    };
  });

  let filteredRows = status ? rows.filter((r) => Object.values(r.cells).some((c) => c.status === status)) : rows;
  if (trainingIdsFilter.length) {
    filteredRows = filteredRows.filter((r) =>
      trainingIdsFilter.every((tid) => {
        const cell = r.cells[tid];
        return cell && (cell.status === 'Current' || cell.status === 'No Expiration');
      })
    );
  }

  res.json({
    masterTrainings,
    employees: filteredRows,
    stats: {
      audited_employees: activeCount,
      inactive_employees: inactiveCount,
      current_percent: orgApplicable > 0 ? Math.round((orgCurrent / orgApplicable) * 100) : 100,
      expiring_soon_count: orgExpiringSoon,
      expired_or_missing_count: orgExpiredOrMissing,
    },
  });
});

module.exports = router;
