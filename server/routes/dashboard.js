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

// "Compliant" = Current or No Expiration (already satisfied, nothing more to do). Not Applicable
// cells don't count against a client/org either way, so they're excluded from the denominator.
function complianceRate(counts) {
  const compliant = (counts.Current || 0) + (counts['No Expiration'] || 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const applicable = total - (counts['Not Applicable'] || 0);
  return applicable > 0 ? Math.round((compliant / applicable) * 100) : 100;
}

function healthStatus(counts) {
  if ((counts['Pending Review'] || 0) > 0) return 'Review Pending';
  return complianceRate(counts) >= 90 ? 'Compliant' : 'Action Required';
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
    const clientCounts = computeCountsForEmployees(emps, masterTrainings);
    return {
      client_id: c.client_id,
      client_name: c.client_name,
      totalActiveEmployees: emps.length,
      totalTrainingRecords: recordCount,
      counts: clientCounts,
      complianceRate: complianceRate(clientCounts),
      flaggedCount: (clientCounts.Expired || 0) + (clientCounts.Missing || 0),
      healthStatus: healthStatus(clientCounts),
    };
  });

  // Urgent Training Gaps: expired (employee, training) pairs, most recently lapsed first.
  // "Missing" is intentionally excluded here - Keeley's call: the app tracks completions, it
  // doesn't flag every training nobody's done as a gap, since most trainings aren't required.
  const gaps = [];
  for (const emp of allEmployees) {
    for (const mt of masterTrainings) {
      const { status, expirationDate } = repo.computeCell({
        employeeId: emp.employee_id,
        clientId: emp.client_id,
        trainingId: mt.training_id,
        masterTraining: mt,
      });
      if (status === 'Expired') {
        gaps.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          training_id: mt.training_id,
          training_name: mt.training_name,
          status,
          expiration_date: expirationDate,
        });
      }
    }
  }
  gaps.sort((a, b) => (a.expiration_date || '9999').localeCompare(b.expiration_date || '9999'));

  // Most Popular Trainings (Keeley's request, 2026-08-18 - replaces the old "High-Priority
  // Catalog Modules" tile, which just showed the first 6 trainings by catalog order and a
  // percent-current figure): the trainings with the most employees who have actually
  // completed them, by headcount - a distinct-employee count of active records with a
  // completion date on file, ranked highest first, top 6 shown.
  const mostPopularTrainings = masterTrainings
    .map((mt) => {
      const completedCount = db
        .prepare(
          `SELECT COUNT(DISTINCT employee_id) AS n FROM employee_training_records
           WHERE training_id = ? AND completion_date IS NOT NULL AND is_active_record = 1`
        )
        .get(mt.training_id).n;
      return { training_id: mt.training_id, training_name: mt.training_name, completed_count: completedCount };
    })
    .sort((a, b) => b.completed_count - a.completed_count)
    .slice(0, 6);

  res.json({
    scope: 'all',
    totalClients,
    totalActiveEmployees: allEmployees.length,
    totalTrainingRecords: totalRecords,
    counts,
    averageCompliance: complianceRate(counts),
    expiredOrMissing: (counts.Expired || 0) + (counts.Missing || 0),
    perClient,
    urgentGaps: gaps.slice(0, 8),
    mostPopularTrainings,
  });
});

module.exports = router;
