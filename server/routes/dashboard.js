const express = require('express');
const db = require('../db');
const repo = require('../lib/repo');
const { computeStatus } = require('../lib/statusEngine');

const router = express.Router();

function zeroCounts() {
  return { Current: 0, Expired: 0, Missing: 0, 'Not Applicable': 0, 'No Expiration': 0, 'Pending Review': 0 };
}

// Performance fix (2026-08-18, Keeley reported the Dashboard loading very slowly): the old
// code called repo.computeCell() once per (employee, training) pair, and each call ran two
// fresh db.prepare(...).get(...) queries - with real data (one client alone had ~159 active
// employees x 52 trainings = ~8,270 cells) that's on the order of 16,000+ synchronous SQLite
// round trips for a SINGLE dashboard load, and the old code did an equivalent full pass THREE
// times over (once for org totals, once summed across all clients for perClient, once again
// for the urgent-gaps scan). This bulk-loads every requirement and active record relevant to
// the given employees in exactly 2 queries total, builds in-memory lookup maps, and then
// computes every cell's status in plain JS (statusEngine.computeStatus, no db calls) in one
// single pass - counts, per-client breakdown, expired-gaps, and training-popularity are all
// derived from that same pass instead of separate full scans.
function bulkComputeForEmployees(employees, masterTrainings, { collectGaps = false, collectPopularity = false, groupByClient = false } = {}) {
  const counts = zeroCounts();
  const countsByClient = groupByClient ? new Map() : null;
  const gaps = [];
  const popularity = collectPopularity ? new Map() : null;

  if (employees.length === 0) {
    return { counts, gaps, popularity, countsByClient };
  }

  const employeeIds = employees.map((e) => e.employee_id);
  const clientIds = [...new Set(employees.map((e) => e.client_id))];

  const requirementRows = db
    .prepare(`SELECT * FROM client_training_requirements WHERE client_id IN (${clientIds.map(() => '?').join(',')})`)
    .all(...clientIds);
  const requirementMap = new Map();
  for (const r of requirementRows) requirementMap.set(`${r.client_id}|${r.training_id}`, r);

  const recordRows = db
    .prepare(
      `SELECT * FROM employee_training_records
       WHERE is_active_record = 1 AND is_inactive = 0 AND employee_id IN (${employeeIds.map(() => '?').join(',')})
       ORDER BY employee_id, training_id, (completion_date IS NULL), completion_date DESC, rowid DESC`
    )
    .all(...employeeIds);
  // First occurrence per (employee_id, training_id) wins - the ORDER BY above puts the same
  // "latest active record" first that repo.getLatestRecord() would pick one at a time.
  const recordMap = new Map();
  for (const r of recordRows) {
    const key = `${r.employee_id}|${r.training_id}`;
    if (!recordMap.has(key)) recordMap.set(key, r);
  }

  for (const emp of employees) {
    let clientCounts = null;
    if (groupByClient) {
      clientCounts = countsByClient.get(emp.client_id);
      if (!clientCounts) {
        clientCounts = zeroCounts();
        countsByClient.set(emp.client_id, clientCounts);
      }
    }
    for (const mt of masterTrainings) {
      const requirement = requirementMap.get(`${emp.client_id}|${mt.training_id}`) || null;
      const record = recordMap.get(`${emp.employee_id}|${mt.training_id}`) || null;
      const { status, expirationDate } = computeStatus({ record, requirement, masterTraining: mt });

      counts[status] = (counts[status] || 0) + 1;
      if (clientCounts) clientCounts[status] = (clientCounts[status] || 0) + 1;

      if (collectGaps && status === 'Expired') {
        gaps.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          training_id: mt.training_id,
          training_name: mt.training_name,
          status,
          expiration_date: expirationDate,
        });
      }

      if (collectPopularity && record && record.completion_date) {
        let set = popularity.get(mt.training_id);
        if (!set) { set = new Set(); popularity.set(mt.training_id, set); }
        set.add(emp.employee_id);
      }
    }
  }

  return { counts, gaps, popularity, countsByClient };
}

// Most Popular Trainings (Keeley's request, 2026-08-18; extended to per-client scope
// 2026-08-19): the trainings with the most employees who have actually completed them, by
// headcount - ranked highest first, top 6. Shared by both the org-wide dashboard and the
// per-client drilldown, since it's the same computation over a different employee set.
function topPopularTrainings(masterTrainings, popularity) {
  return masterTrainings
    .map((mt) => ({
      training_id: mt.training_id,
      training_name: mt.training_name,
      completed_count: popularity.get(mt.training_id)?.size || 0,
    }))
    .sort((a, b) => b.completed_count - a.completed_count)
    .slice(0, 6);
}

// "Compliant" = Current or No Expiration (already satisfied, nothing more to do). Not Applicable
// cells don't count against a client/org either way, so they're excluded from the denominator.
function complianceRate(counts) {
  const compliant = (counts.Current || 0) + (counts['No Expiration'] || 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const applicable = total - (counts['Not Applicable'] || 0);
  return applicable > 0 ? Math.round((compliant / applicable) * 100) : 100;
}

// "Review Pending" used to override this (Keeley's request to remove it: there was no
// dashboard-level action to resolve it from here) - a Pending Review record now just counts
// against the compliance rate like any other non-compliant status, and is actually resolvable
// per-record via the Edit control on Employee Detail.
function healthStatus(counts) {
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
    const recordCount = db.prepare('SELECT COUNT(*) AS n FROM employee_training_records WHERE client_id = ? AND is_inactive = 0').get(client_id).n;
    const { counts, popularity } = bulkComputeForEmployees(employees, masterTrainings, { collectPopularity: true });
    return res.json({
      scope: 'client',
      client,
      totalActiveEmployees: employees.length,
      totalTrainingRecords: recordCount,
      counts,
      // Most Popular Trainings, scoped to just this client's employees (Keeley's request,
      // 2026-08-19) - "what does this client most often do," same ranking logic as the
      // org-wide dashboard tile.
      mostPopularTrainings: topPopularTrainings(masterTrainings, popularity),
    });
  }

  const totalClients = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE active = 1 AND is_internal = 0').get().n;
  const allEmployees = db
    .prepare(
      `SELECT e.* FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.active = 1 AND c.is_internal = 0`
    )
    .all();
  const totalRecords = db
    .prepare(
      `SELECT COUNT(*) AS n FROM employee_training_records r JOIN clients c ON c.client_id = r.client_id
       WHERE c.is_internal = 0 AND r.is_inactive = 0`
    )
    .get().n;

  // One single pass over every employee x training cell drives org totals, the per-client
  // breakdown, the expired-training gaps list, and training popularity all at once.
  const { counts, gaps, popularity, countsByClient } = bulkComputeForEmployees(allEmployees, masterTrainings, {
    collectGaps: true,
    collectPopularity: true,
    groupByClient: true,
  });

  // "Missing" is intentionally excluded from gaps - Keeley's call: the app tracks completions,
  // it doesn't flag every training nobody's done as a gap, since most trainings aren't required.
  gaps.sort((a, b) => (a.expiration_date || '9999').localeCompare(b.expiration_date || '9999'));

  const clients = db.prepare('SELECT * FROM clients WHERE is_internal = 0 ORDER BY client_name').all();
  const perClient = clients.map((c) => {
    const totalActiveEmployees = allEmployees.reduce((n, e) => n + (e.client_id === c.client_id ? 1 : 0), 0);
    const recordCount = db.prepare('SELECT COUNT(*) AS n FROM employee_training_records WHERE client_id = ? AND is_inactive = 0').get(c.client_id).n;
    const clientCounts = countsByClient.get(c.client_id) || zeroCounts();
    return {
      client_id: c.client_id,
      client_name: c.client_name,
      totalActiveEmployees,
      totalTrainingRecords: recordCount,
      counts: clientCounts,
      complianceRate: complianceRate(clientCounts),
      flaggedCount: (clientCounts.Expired || 0) + (clientCounts.Missing || 0),
      healthStatus: healthStatus(clientCounts),
    };
  });

  const mostPopularTrainings = topPopularTrainings(masterTrainings, popularity);

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
