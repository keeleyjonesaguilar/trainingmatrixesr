import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

// Collapsed audit list of everything permanently ignored (Keeley's design: no un-ignore, but
// the ignored_at/ignored_by columns exist specifically so this isn't invisible after the fact).
function IgnoredItemsSection({ clientId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!open || items) return;
    api.getIgnoredActionItems(clientId).then((d) => setItems(d.items)).catch(() => setItems([]));
  }, [open, items, clientId]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <button type="button" className="link-button" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} Permanently Ignored{items ? ` (${items.length})` : ''}
      </button>
      {open && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Training</th>
                <th>Ignored</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {!items && <tr><td colSpan={4} className="empty-state">Loading...</td></tr>}
              {items && items.map((item) => (
                <tr key={`${item.employee_id}-${item.training_id}`}>
                  <td><Link to={`/employees/${item.employee_id}`}>{item.employee_name}</Link></td>
                  <td>{item.training_id} - {item.training_name}</td>
                  <td>{formatDateTime(item.ignored_at)}</td>
                  <td>{item.ignored_by || '—'}</td>
                </tr>
              ))}
              {items && items.length === 0 && (
                <tr><td colSpan={4} className="empty-state">Nothing has been ignored for this client.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ActionRequired() {
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get('client_id') || '';
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ignoringKey, setIgnoringKey] = useState('');

  const load = () => api.getActionItems(clientId).then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    if (!clientId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return <div className="error-banner">No client specified.</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  const { client, items } = data;

  const ignore = async (item) => {
    if (!window.confirm(
      `Permanently ignore this gap?\n\n${item.employee_name} — ${item.training_id} ${item.training_name}\n\n` +
      `This pairing will never count against ${client.client_name}'s compliance percentage again, even if it stays ${item.status} ` +
      `or the underlying record is edited. There is no way to undo this from the app.`
    )) return;
    const key = `${item.employee_id}-${item.training_id}`;
    setIgnoringKey(key);
    try {
      await api.ignoreComplianceGap(item.employee_id, item.training_id);
      setData((d) => ({ ...d, items: d.items.filter((i) => `${i.employee_id}-${i.training_id}` !== key) }));
    } catch (e) {
      setError(e.message);
    } finally {
      setIgnoringKey('');
    }
  };

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
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.employee_id}-${item.training_id}`}>
                  <td><Link to={`/employees/${item.employee_id}`}>{item.employee_name}</Link></td>
                  <td>{item.training_id} - {item.training_name}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>{actionDescription(item)}</td>
                  {isAdmin && (
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        disabled={ignoringKey === `${item.employee_id}-${item.training_id}`}
                        onClick={() => ignore(item)}
                      >
                        Ignore
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={isAdmin ? 5 : 4} className="empty-state">Nothing outstanding — this client is fully compliant.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && <IgnoredItemsSection clientId={clientId} />}
    </div>
  );
}
