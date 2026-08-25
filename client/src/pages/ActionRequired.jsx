import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge.jsx';

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Plain-English "what actually needs to happen" per status - this page exists specifically to
// answer that question, since the Dashboard's "Action Required" badge alone doesn't say what's
// required (Keeley's request).
function actionDescription(item) {
  switch (item.status) {
    case 'Expired':
      return `Certification expired ${formatDate(item.expiration_date)} — needs to be renewed.`;
    case 'Missing':
      return "Required training hasn't been completed yet — needs to be scheduled.";
    case 'Pending Review':
      return "A completion date couldn't be determined from the source data — review and correct this record.";
    default:
      return '';
  }
}

export default function ActionRequired() {
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get('client_id') || '';
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) return;
    api.getActionItems(clientId).then(setData).catch((e) => setError(e.message));
  }, [clientId]);

  if (!clientId) return <div className="error-banner">No client specified.</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  const { client, items } = data;

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← Back to Dashboard</Link>
      <div className="page-header" style={{ marginTop: 8 }}>
        <div>
          <h1>Action Required — {client.client_name}</h1>
          <p className="page-subtitle">
            Every employee/training combination pulling this client's compliance below the mark, and what's needed to resolve each one.
            Nothing here is deleted or overridden by fixing another — resolve them one at a time from each employee's own page.
          </p>
        </div>
        <div className="page-header-actions">
          <button className="secondary" onClick={() => navigate(`/?client_id=${clientId}`)}>View Client Overview</button>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Training</th>
                <th>Status</th>
                <th>What's Needed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.employee_id}-${item.training_id}`}>
                  <td><Link to={`/employees/${item.employee_id}`}>{item.employee_name}</Link></td>
                  <td>{item.training_id} - {item.training_name}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>{actionDescription(item)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} className="empty-state">Nothing outstanding — this client is fully compliant.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
