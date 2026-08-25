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
