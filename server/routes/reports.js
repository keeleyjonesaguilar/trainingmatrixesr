// Reports (spec section 45): Client Compliance, Employee Training, Training Compliance,
// Expiring Soon, and Client Exception reports. All read-only - built on top of the same
// repo.computeCell()/statusEngine single source of truth used by the matrix/dashboard, so a
// report can never disagree with what the rest of the app shows.
const express = require('express');
const db = require('../db');
const repo = require('../lib/repo');

const router = express.Router();

// 1. Client Compliance Report: every employee x every Required training for their client,
// with Current/Expired/Missing/Pending Review/etc. Scoped to one client, or every client.
router.get('/client-compliance', (req, res) => {
  const { client_id } = req.query;
  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });
  const empClause = client_id ? 'WHERE client_id = ? AND active = 1' : 'WHERE active = 1';
  const employees = db.prepare(`SELECT * FROM employees ${empClause}`).all(...(client_id ? [client_id] : []));
  const clientsById = Object.fromEntries(db.prepare('SELECT * FROM clients').all().map((c) => [c.client_id, c]));

  const rows = [];
  for (const emp of employees) {
    for (const mt of masterTrainings) {
      const { requirement, status, expirationDate, record } = repo.computeCell({
        employeeId: emp.employee_id,
        clientId: emp.client_id,
        trainingId: mt.training_id,
        masterTraining: mt,
      });
      const reqStatus = requirement ? requirement.requirement_status : 'Required';
      if (reqStatus !== 'Required') continue; // report scope is required trainings, per spec 45
      rows.push({
        client_id: emp.client_id,
        client_name: clientsById[emp.client_id]?.client_name,
        employee_id: emp.employee_id,
        full_name: emp.full_name,
        training_id: mt.training_id,
        training_name: mt.training_name,
        status,
        completion_date: record ? record.completion_date : null,
        expiration_date: expirationDate,
      });
    }
  }
  const summary = { Current: 0, Expired: 0, Missing: 0, 'Not Applicable': 0, 'No Expiration': 0, 'Pending Review': 0 };
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
  res.json({ rows, summary });
});

// 2. Employee Training Report: one employee's complete history, including superseded/
// duplicate-flagged records (rule 15 - nothing is ever hidden, just marked).
router.get('/employee/:employeeId', (req, res) => {
  const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(employee.client_id);
  const records = db
    .prepare(
      `SELECT r.*, m.training_name AS master_training_name
       FROM employee_training_records r JOIN master_trainings m ON m.training_id = r.training_id
       WHERE r.employee_id = ? ORDER BY r.training_id, r.completion_date DESC`
    )
    .all(req.params.employeeId);
  res.json({ employee, client, records });
});

// 3. Training Compliance Report: for one Master Training, every employee bucketed by status
// (all 6, not just Current/Expired/Missing), scoped by client if given.
router.get('/training/:trainingId', (req, res) => {
  const mt = repo.getMasterTraining(req.params.trainingId);
  if (!mt) return res.status(404).json({ error: 'Training not found' });
  const { client_id } = req.query;
  const empClause = client_id ? 'WHERE client_id = ? AND active = 1' : 'WHERE active = 1';
  const employees = db.prepare(`SELECT * FROM employees ${empClause}`).all(...(client_id ? [client_id] : []));

  const buckets = { Current: [], Expired: [], Missing: [], 'Not Applicable': [], 'No Expiration': [], 'Pending Review': [] };
  for (const emp of employees) {
    const { status, expirationDate } = repo.computeCell({
      employeeId: emp.employee_id,
      clientId: emp.client_id,
      trainingId: mt.training_id,
      masterTraining: mt,
    });
    buckets[status].push({ employee_id: emp.employee_id, full_name: emp.full_name, client_id: emp.client_id, expiration_date: expirationDate });
  }
  res.json({ training: mt, buckets });
});

// 4. Expiring Soon Report: every Current record whose expiration falls within N days
// (default 30; caller can pass 30/60/90/custom), optionally scoped to one client.
router.get('/expiring-soon', (req, res) => {
  const days = Number(req.query.days) || 30;
  const { client_id } = req.query;
  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });
  const empClause = client_id ? 'WHERE client_id = ? AND active = 1' : 'WHERE active = 1';
  const employees = db.prepare(`SELECT * FROM employees ${empClause}`).all(...(client_id ? [client_id] : []));
  const clientsById = Object.fromEntries(db.prepare('SELECT * FROM clients').all().map((c) => [c.client_id, c]));

  const rows = [];
  for (const emp of employees) {
    for (const mt of masterTrainings) {
      const { status, expirationDate } = repo.computeCell({
        employeeId: emp.employee_id,
        clientId: emp.client_id,
        trainingId: mt.training_id,
        masterTraining: mt,
      });
      if (repo.isExpiringSoon(status, expirationDate, days)) {
        rows.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          client_id: emp.client_id,
          client_name: clientsById[emp.client_id]?.client_name,
          training_id: mt.training_id,
          training_name: mt.training_name,
          expiration_date: expirationDate,
        });
      }
    }
  }
  rows.sort((a, b) => (a.expiration_date || '').localeCompare(b.expiration_date || ''));
  res.json({ days, rows });
});

// 5. Client Exception Report: client-specific overrides, pending import mapping reviews,
// duplicate-flagged records, and Pending Review records with insufficient source info -
// everything a client admin should double-check, in one place.
router.get('/exceptions', (req, res) => {
  const { client_id } = req.query;

  const overrideClause = client_id ? 'WHERE ctr.client_id = ? AND ctr.client_expiration_unit IS NOT NULL' : 'WHERE ctr.client_expiration_unit IS NOT NULL';
  const expirationOverrides = db
    .prepare(
      `SELECT ctr.*, c.client_name, m.training_name FROM client_training_requirements ctr
       JOIN clients c ON c.client_id = ctr.client_id
       JOIN master_trainings m ON m.training_id = ctr.training_id
       ${overrideClause}`
    )
    .all(...(client_id ? [client_id] : []));

  const batchClause = client_id ? 'WHERE ib.client_id = ?' : '';
  const pendingMappings = db
    .prepare(
      `SELECT icm.*, ib.filename, ib.client_id, c.client_name FROM import_column_map icm
       JOIN import_batches ib ON ib.batch_id = icm.batch_id
       JOIN clients c ON c.client_id = ib.client_id
       ${batchClause} ${batchClause ? 'AND' : 'WHERE'} icm.resolution_status = 'needs_review'`
    )
    .all(...(client_id ? [client_id] : []));

  const dupClause = client_id ? 'WHERE r.client_id = ? AND r.duplicate_status = ?' : 'WHERE r.duplicate_status = ?';
  const duplicateRecords = db
    .prepare(
      `SELECT r.*, e.full_name, c.client_name, m.training_name FROM employee_training_records r
       JOIN employees e ON e.employee_id = r.employee_id
       JOIN clients c ON c.client_id = r.client_id
       JOIN master_trainings m ON m.training_id = r.training_id
       ${dupClause}`
    )
    .all(...(client_id ? [client_id, 'flagged'] : ['flagged']));

  const pendingClause = client_id ? 'WHERE r.client_id = ? AND r.status = ?' : 'WHERE r.status = ?';
  const pendingReviewRecords = db
    .prepare(
      `SELECT r.*, e.full_name, c.client_name, m.training_name FROM employee_training_records r
       JOIN employees e ON e.employee_id = r.employee_id
       JOIN clients c ON c.client_id = r.client_id
       JOIN master_trainings m ON m.training_id = r.training_id
       ${pendingClause}`
    )
    .all(...(client_id ? [client_id, 'Pending Review'] : ['Pending Review']));

  res.json({ expirationOverrides, pendingMappings, duplicateRecords, pendingReviewRecords });
});

module.exports = router;
