const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const repo = require('../lib/repo');

const router = express.Router();

router.get('/', (req, res) => {
  const { client_id, department, job_title, search, activeOnly } = req.query;
  const clauses = [];
  const params = [];
  if (client_id) { clauses.push('client_id = ?'); params.push(client_id); }
  if (department) { clauses.push('department = ?'); params.push(department); }
  if (job_title) { clauses.push('job_title = ?'); params.push(job_title); }
  if (search) { clauses.push('LOWER(full_name) LIKE ?'); params.push(`%${search.toLowerCase()}%`); }
  if (activeOnly === 'true') { clauses.push('active = 1'); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM employees ${where} ORDER BY full_name ASC`).all(...params);
  res.json(rows);
});

// Distinct department/job title lists, used to populate matrix filter dropdowns (spec section 8).
router.get('/facets/list', (req, res) => {
  const { client_id } = req.query;
  const where = client_id ? 'WHERE client_id = ?' : '';
  const params = client_id ? [client_id] : [];
  const departments = db
    .prepare(`SELECT DISTINCT department FROM employees ${where} ${client_id ? 'AND' : 'WHERE'} department IS NOT NULL AND department != '' ORDER BY department`)
    .all(...params)
    .map((r) => r.department);
  const jobTitles = db
    .prepare(`SELECT DISTINCT job_title FROM employees ${where} ${client_id ? 'AND' : 'WHERE'} job_title IS NOT NULL AND job_title != '' ORDER BY job_title`)
    .all(...params)
    .map((r) => r.job_title);
  res.json({ departments, jobTitles });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Employee not found' });
  res.json(row);
});

// Employee Detail Page (spec section 9): all 52 (or however many active) Master Trainings
// with this employee's corresponding record, status, and original client wording.
router.get('/:id/full-detail', (req, res) => {
  const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(employee.client_id);
  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });
  const trainings = masterTrainings.map((mt) => {
    const { requirement, record, status, expirationDate } = repo.computeCell({
      employeeId: employee.employee_id,
      clientId: employee.client_id,
      trainingId: mt.training_id,
      masterTraining: mt,
    });
    return {
      training_id: mt.training_id,
      training_name: requirement?.client_training_name || mt.training_name,
      master_training_name: mt.training_name,
      category: mt.category,
      training_type: mt.training_type,
      requirement_status: requirement ? requirement.requirement_status : 'Required',
      original_client_training_name: record ? record.original_client_training_name : null,
      completion_date: record ? record.completion_date : null,
      expiration_date: expirationDate,
      status,
      expiring_soon: repo.isExpiringSoon(status, expirationDate),
      notes: record ? record.notes : null,
      record_id: record ? record.record_id : null,
      duplicate_status: record ? record.duplicate_status : 'none',
    };
  });
  res.json({ employee, client, trainings });
});

router.post('/', (req, res) => {
  const {
    client_id, employee_number = null, full_name, job_title = null, department = null, active = 1, notes = null,
  } = req.body;
  if (!client_id || !full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'client_id and full_name are required' });
  }
  const client = db.prepare('SELECT client_id FROM clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'client_id does not exist' });
  const employee_id = uuidv4();
  db.prepare(
    `INSERT INTO employees (employee_id, client_id, employee_number, full_name, job_title, department, active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(employee_id, client_id, employee_number, full_name.trim(), job_title, department, active ? 1 : 0, notes);
  res.status(201).json(db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employee_id));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });
  const merged = { ...existing, ...req.body };
  db.prepare(
    `UPDATE employees SET employee_number=?, full_name=?, job_title=?, department=?, active=?, notes=? WHERE employee_id=?`
  ).run(
    merged.employee_number, merged.full_name, merged.job_title, merged.department, merged.active ? 1 : 0, merged.notes,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(req.params.id));
});

module.exports = router;
