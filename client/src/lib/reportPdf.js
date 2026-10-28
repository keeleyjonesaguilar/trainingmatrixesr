// PDF companion to downloadCsv (Keeley's request, 2026-10-27) - sends the same already-filtered
// rows to the server, which lays them out in the ESR report style (server/routes/reports.js
// POST /table.pdf) and streams the file back. Throws with the server's message on failure.
export async function downloadReportPdf(payload) {
  const res = await fetch('/api/reports/table.pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `PDF failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : `${payload.title}.pdf`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Columns for a compliance/matrix PDF, matching buildComplianceReportRows' CSV but keyed for the
// PDF and grouped one section per employee (group_by: 'group') - "Name — Client" when the rows
// span clients, so two people with the same name at different clients stay apart.
export function compliancePdfRows(csvRows) {
  return csvRows.map((r) => ({
    group: r.Client ? `${r.Employee} — ${r.Client}` : r.Employee,
    employee: r.Employee,
    training: `${r['Training ID']} - ${r.Training}`,
    status: r.Status,
    completed: usDate(r['Completion Date']),
    expires: usDate(r['Expiration Date']),
  }));
}

export const COMPLIANCE_PDF_COLUMNS = [
  { key: 'training', label: 'Training', weight: 3, bold: true },
  { key: 'status', label: 'Status', weight: 1.1 },
  { key: 'completed', label: 'Completed', weight: 1 },
  { key: 'expires', label: 'Expires', weight: 1 },
];

export function usDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (d || '');
}
