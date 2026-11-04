// One grid cell's contents from formatCell() (lib/matrixCell.js) - shared by the Employees grid and
// the client overview grid. N/A is a faint dot (2026-11-04) that still says "Not applicable" on
// hover and to screen readers.
export default function MatrixCellContent({ formatted }) {
  if (formatted.dot) return <span className="matrix-na-dot" role="img" aria-label="Not applicable" title="Not applicable" />;
  if (formatted.plain) return formatted.text;
  return <span className={`badge ${formatted.className}`}>{formatted.text}</span>;
}
