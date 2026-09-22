// Shared by every place that renders a Matrix-style employee x training grid (the standalone
// Employees/Matrix page and the per-client grid on the Client Compliance Overview page) so the
// status -> badge mapping only lives in one place.
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

export function daysBetween(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Keeley's call: the matrix tracks completion, not compliance-against-requirements. A
// training that hasn't been completed just shows as a plain dash - it's not flagged as
// "Missing," since most trainings aren't required for most employees. Completed trainings
// show the actual completion date instead of a generic "Valid" label.
export function formatCell(cell) {
  if (!cell) return { text: '—', plain: true };
  switch (cell.status) {
    case 'Current': {
      const dateText = formatDate(cell.completion_date);
      if (cell.expiring_soon) {
        const d = daysBetween(cell.expiration_date);
        return { text: `${dateText} (expires in ${d}d)`, className: 'badge-expiringsoon' };
      }
      return { text: dateText, className: 'badge-current' };
    }
    case 'No Expiration':
      return { text: formatDate(cell.completion_date), className: 'badge-noexpiration' };
    case 'Expired': {
      const d = daysBetween(cell.expiration_date);
      return { text: `${formatDate(cell.completion_date)} (expired ${d !== null ? `${Math.abs(d)}d ago` : ''})`, className: 'badge-expired' };
    }
    case 'Not Applicable':
      return { text: 'N/A', className: 'badge-notapplicable' };
    case 'Pending Review':
      return { text: 'Pending Review', className: 'badge-pendingreview' };
    case 'Ignored':
      return { text: 'Ignored', className: 'badge-ignored' };
    case 'Missing':
    default:
      return { text: '-', plain: true };
  }
}

// Every distinct status a cell can have (server/lib/statusEngine.js + the "Ignored" override
// applied at the repo layer) - used to populate the status filter dropdown on the Employees
// Matrix and the per-client Compliance Overview (Keeley's request, 2026-09-17).
export const STATUS_OPTIONS = ['Current', 'Expired', 'Missing', 'No Expiration', 'Pending Review', 'Not Applicable', 'Ignored'];

// Flattens the employee x training grid into one row per (employee, training) cell, for the
// "Download Report" button on those same two pages - a wide grid doesn't export usefully as a
// CSV, but a flat list of exactly the cells that matter does. With no status filter, Missing/Not
// Applicable/Ignored cells are left out (nothing was actually completed or requires action -
// same "just a dash" philosophy formatCell() already applies to the on-screen grid); picking one
// of those statuses explicitly still lists them.
export function buildComplianceReportRows(employees, masterTrainings, { status, includeClient = true } = {}) {
  const rows = [];
  for (const emp of employees) {
    for (const mt of masterTrainings) {
      const cell = emp.cells[mt.training_id];
      if (!cell) continue;
      if (status) {
        // Same rule as server/routes/matrix.js: "Current" includes never-expiring trainings.
        if (cell.status !== status && !(status === 'Current' && cell.status === 'No Expiration')) continue;
      } else if (['Missing', 'Not Applicable', 'Ignored'].includes(cell.status)) {
        continue;
      }
      rows.push({
        Employee: emp.full_name,
        ...(includeClient ? { Client: emp.client_name } : {}),
        'Training ID': mt.training_id,
        Training: mt.training_name,
        Status: cell.status,
        'Completion Date': cell.completion_date || '',
        'Expiration Date': cell.expiration_date || '',
      });
    }
  }
  return rows;
}

// Explains an empty Expired filter (Keeley's report, 2026-09-22: #9 "still an empty list") -
// most catalog trainings are set to never expire, so nobody can ever be Expired on them. Only
// shown when every selected training is "None" in the catalog; a client-level override could
// still make one expire, which is why this is a hint on the empty state, not a disabled option.
export function emptyFilterHint(status, trainingIds, masterTrainings) {
  if (status !== 'Expired' || !trainingIds.length) return null;
  const picked = trainingIds.map((tid) => masterTrainings.find((mt) => mt.training_id === tid)).filter(Boolean);
  if (!picked.length || !picked.every((mt) => mt.default_expiration === 'None')) return null;
  const names = picked.map((mt) => mt.training_name).join(', ');
  return `${names} ${picked.length === 1 ? 'is' : 'are'} set to never expire in the Training Catalog, so no one can be Expired on ${picked.length === 1 ? 'it' : 'them'}. If ${picked.length === 1 ? 'it' : 'they'} should expire, set an expiration period on the training in the catalog.`;
}
