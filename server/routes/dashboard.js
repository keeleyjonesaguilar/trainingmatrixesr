const express = require('express');
const db = require('../db');
const repo = require('../lib/repo');
const { computeStatus } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function zeroCounts() {
  return { Current: 0, Expired: 0, Missing: 0, 'Not Applicable': 0, 'No Expiration': 0, 'Pending Review': 0, Ignored: 0 };
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
function bulkComputeForEmployees(
  employees,
  masterTrainings,
  { collectGaps = false, collectPopularity = false, groupByClient = false, collectActionItems = false } = {}
) {
  const counts = zeroCounts();
  const countsByClient = groupByClient ? new Map() : null;
  const gaps = [];
  const popularity = collectPopularity ? new Map() : null;
  const actionItems = collectActionItems ? [] : null;

  if (employees.length === 0) {
    return { counts, gaps, popularity, countsByClient, actionItems };
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

  // Permanently-ignored gaps (Keeley's request) - same bulk-lookup treatment as everything
  // else in this function, so N employees never costs N ignore-table queries.
  const ignoredRows = db
    .prepare(`SELECT employee_id, training_id FROM ignored_compliance_gaps WHERE employee_id IN (${employeeIds.map(() => '?').join(',')})`)
    .all(...employeeIds);
  const ignoredSet = new Set(ignoredRows.map((r) => `${r.employee_id}|${r.training_id}`));

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
      let { status, expirationDate } = computeStatus({ record, requirement, masterTraining: mt });

      if ((status === 'Expired' || status === 'Missing' || status === 'Pending Review') &&
          ignoredSet.has(`${emp.employee_id}|${mt.training_id}`)) {
        status = 'Ignored';
      }

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

      // Everything actually counting against complianceRate/healthStatus below (Expired,
      // Missing, Pending Review) - "Action Required" on a client's dashboard row is only ever
      // true because of cells like these, so this is the exact list that answers "required to
      // do what, exactly." An ignored gap's status is already 'Ignored' by this point, so it
      // naturally never lands here.
      if (collectActionItems && (status === 'Expired' || status === 'Missing' || status === 'Pending Review')) {
        actionItems.push({
          employee_id: emp.employee_id,
          employee_name: emp.full_name,
          training_id: mt.training_id,
          training_name: requirement?.client_training_name || mt.training_name,
          status,
          completion_date: record ? record.completion_date : null,
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

  return { counts, gaps, popularity, countsByClient, actionItems };
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
// and Ignored cells don't count against a client/org either way, so they're excluded from the
// denominator (Ignored the same way NA already was - a permanently-dismissed gap, see repo.js's
// computeCell).
function complianceRate(counts) {
  const compliant = (counts.Current || 0) + (counts['No Expiration'] || 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const applicable = total - (counts['Not Applicable'] || 0) - (counts['Ignored'] || 0);
  return applicable > 0 ? Math.round((compliant / applicable) * 100) : 100;
}

// "Review Pending" used to override this (Keeley's request to remove it: there was no
// dashboard-level action to resolve it from here) - a Pending Review record now just counts
// against the compliance rate like any other non-compliant status, and is actually resolvable
// per-record via the Edit control on Employee Detail.
function healthStatus(counts) {
  return complianceRate(counts) >= 90 ? 'Compliant' : 'Action Required';
}

// Backs the "Action Required" button on a client's dashboard row (Keeley's request): the exact
// list of employee+training gaps behind that client's compliance number, so there's somewhere
// to actually go read what's needed instead of just seeing a status word.
router.get('/action-items', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const employees = db.prepare('SELECT * FROM employees WHERE client_id = ? AND active = 1').all(client_id);
  const masterTrainings = repo.listMasterTrainings({ activeOnly: true });
  const { actionItems } = bulkComputeForEmployees(employees, masterTrainings, { collectActionItems: true });
  actionItems.sort((a, b) => a.employee_name.localeCompare(b.employee_name) || a.training_name.localeCompare(b.training_name));
  res.json({ client, items: actionItems });
});

// Permanently dismiss one employee+training gap (Keeley's request) - never counts against
// compliance again, even if the underlying record is edited or stays Expired/Missing/Pending
// Review. No un-ignore: a real new completion naturally takes back over on its own (see
// repo.computeCell - the override only ever applies to a still-bad status).
router.post('/action-items/ignore', requireAdmin, (req, res) => {
  const { employee_id, training_id } = req.body || {};
  if (!employee_id || !training_id) {
    return res.status(400).json({ error: 'employee_id and training_id are required' });
  }
  const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employee_id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });
  const masterTraining = repo.getMasterTraining(training_id);
  if (!masterTraining) return res.status(404).json({ error: 'Training not found' });

  const { status } = repo.computeCell({ employeeId: employee_id, clientId: employee.client_id, trainingId: training_id, masterTraining });
  if (!['Expired', 'Missing', 'Pending Review'].includes(status)) {
    return res.status(400).json({ error: `Current status is "${status}" — only Expired, Missing, or Pending Review gaps can be ignored.` });
  }
  repo.ignoreComplianceGap(employee_id, training_id, req.user?.username || null);
  res.status(201).json({ ok: true });
});

// Read-only audit trail for ignored gaps (Keeley's design: permanent/no un-ignore, but the
// ignored_at/ignored_by columns exist specifically so this doesn't disappear without a trace).
router.get('/action-items/ignored', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  const rows = db
    .prepare(
      `SELECT g.employee_id, e.full_name AS employee_name, g.training_id, mt.training_name,
              g.ignored_at, g.ignored_by
       FROM ignored_compliance_gaps g
       JOIN employees e ON e.employee_id = g.employee_id
       JOIN master_trainings mt ON mt.training_id = g.training_id
       WHERE e.client_id = ?
       ORDER BY g.ignored_at DESC`
    )
    .all(client_id);
  res.json({ items: rows });
});

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
      complianceRate: complianceRate(counts),
      healthStatus: healthStatus(counts),
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
