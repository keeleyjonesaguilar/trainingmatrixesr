const express = require('express');
const db = require('../db');
const repo = require('../lib/repo');

const router = express.Router();

function computeCountsForEmployees(employees, masterTrainings) {
  const counts = { Current: 0, Expired: 0, Missing: 0, 'Not Applicable': 0, 'No Expiration': 0, 'Pending Review': 0 };
  for (const emp of employees) {
    for (const mt of masterTrainings) {
      const { status } = repo.computeCell({
        employeeId: emp.employee_id,
        clientId: emp.client_id,
        trainingId: mt.training_id,
        masterTraining: mt,
      });
      counts[status] = (counts[status] || 0) + 1;
    }
  }
  return counts;
}

// Dashboard (spec section 11): org-wide totals, drillable per client via ?client_id=.
router.get('/', (req, res) => {
  const { client_id } = req.query;
  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });

  if (client_id) {
    const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const employees = db.prepare('SELECT * FROM employees WHERE client_id = ? AND active = 1').all(client_id);
    const recordCount = db.prepare('SELECT COUNT(*) AS n FROM employee_training_records WHERE client_id = ?').get(client_id).n;
    const counts = computeCountsForEmployees(employees, masterTrainings);
    return res.json({
      scope: 'client',
      client,
      totalActiveEmployees: employees.length,
      totalTrainingRecords: recordCount,
      counts,
    });
  }

  const totalClients = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE active = 1').get().n;
  const allEmployees = db.prepare('SELECT * FROM employees WHERE active = 1').all();
  const totalRecords = db.prepare('SELECT COUNT(*) AS n FROM employee_training_records').get().n;
  const counts = computeCountsForEmployees(allEmployees, masterTrainings);

  const clients = db.prepare('SELECT * FROM clients ORDER BY client_name').all();
  const perClient = clients.map((c) => {
    const emps = allEmployees.filter((e) => e.client_id === c.client_id);
    const recordCount = db.prepare('SELECT COUNT(*) AS n FROM employee_training_records WHERE client_id = ?').get(c.client_id).n;
    return {
      client_id: c.client_id,
      client_name: c.client_name,
      totalActiveEmployees: emps.length,
      totalTrainingRecords: recordCount,
      counts: computeCountsForEmployees(emps, masterTrainings),
    };
  });

  res.json({
    scope: 'all',
    totalClients,
    totalActiveEmployees: allEmployees.length,
    totalTrainingRecords: totalRecords,
    counts,
    perClient,
  });
});

module.exports = router;
