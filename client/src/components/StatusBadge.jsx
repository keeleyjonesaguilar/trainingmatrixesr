const CLASS_MAP = {
  Current: 'badge-current',
  Expired: 'badge-expired',
  Missing: 'badge-missing',
  'Not Applicable': 'badge-notapplicable',
  'No Expiration': 'badge-noexpiration',
  'Pending Review': 'badge-pendingreview',
  Ignored: 'badge-ignored',
};

export default function StatusBadge({ status }) {
  if (!status) return null;
  const cls = CLASS_MAP[status] || 'badge-notapplicable';
  return <span className={`badge ${cls}`}>{status}</span>;
}
