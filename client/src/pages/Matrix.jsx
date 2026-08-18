import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

const ALL_STATUSES = ['Current', 'Expired', 'Missing', 'Not Applicable', 'No Expiration', 'Pending Review'];

function daysBetween(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatCell(cell) {
  if (!cell) return { text: '—', className: 'badge-notapplicable' };
  switch (cell.status) {
    case 'Current': {
      if (cell.expiring_soon) {
        const d = daysBetween(cell.expiration_date);
        return { text: `Expiring (${d}d)`, className: 'badge-expiringsoon' };
      }
      if (cell.expiration_date) {
        const d = new Date(cell.expiration_date);
        return { text: `Valid (${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()})`, className: 'badge-current' };
      }
      return { text: 'Valid', className: 'badge-current' };
    }
    case 'Expired': {
      const d = daysBetween(cell.expiration_date);
      return { text: d !== null ? `Expired (${Math.abs(d)}d ago)` : 'Expired', className: 'badge-expired' };
    }
    case 'Missing':
      return { text: 'Missing', className: 'badge-missing' };
    case 'Not Applicable':
      return { text: 'N/A', className: 'badge-notapplicable' };
    case 'No Expiration':
      return { text: 'Valid', className: 'badge-noexpiration' };
    case 'Pending Review':
      return { text: 'Pending', className: 'badge-pendingreview' };
    default:
      return { text: '—', className: 'badge-notapplicable' };
  }
}

export default function Matrix() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const clientId = searchParams.get('client_id') || '';
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (clientId) params.client_id = clientId;
    if (search) params.search = search;
    if (status) params.status = status;
    api.getMatrix(params).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [clientId, search, status]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Master Training Matrix</h1>
          <p className="page-subtitle">Every employee against the Master Training Catalog. Click a name or training column for details.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {data && (
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Audited Employees</div>
            <div className="value">{data.stats.audited_employees}</div>
            <span className="caption">Across {clients.length} clients</span>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Current / Certified</div>
            <div className="value">{data.stats.current_percent}%</div>
            <span className={`caption ${data.stats.current_percent >= 90 ? 'good' : ''}`}>&nbsp;</span>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Expiring &lt; 30 Days</div>
            <div className="value">{data.stats.expiring_soon_count}</div>
            <span className="caption warn">Requires scheduling</span>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Expired or Missing</div>
            <div className="value">{data.stats.expired_or_missing_count}</div>
            <span className="caption warn">Immediate action</span>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div className="field-row">
          <label>Search Employee</label>
          <input
            type="search"
            placeholder="Type name..."
            defaultValue={search}
            onKeyDown={(e) => { if (e.key === 'Enter') updateParam('search', e.target.value); }}
            onBlur={(e) => updateParam('search', e.target.value)}
          />
        </div>
        <div className="field-row">
          <label>Client Account</label>
          <select value={clientId} onChange={(e) => updateParam('client_id', e.target.value)}>
            <option value="">All Clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Status Scope</label>
          <select value={status} onChange={(e) => updateParam('status', e.target.value)}>
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button type="button" className="secondary" onClick={() => setSearchParams({})}>Reset Filters</button>
      </div>

      <div className="pill-list" style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
        <span><span className="badge badge-current">●</span> Current / Valid</span>
        <span><span className="badge badge-expiringsoon">●</span> Expiring (&lt;30d)</span>
        <span><span className="badge badge-expired">●</span> Expired</span>
        <span><span className="badge badge-missing">●</span> Missing / Required</span>
        <span><span className="badge badge-notapplicable">●</span> N/A</span>
      </div>

      {loading && <div className="empty-state">Loading matrix...</div>}

      {data && !loading && (
        data.employees.length === 0 ? (
          <div className="empty-state">No employees match these filters.</div>
        ) : (
          <div className="matrix-scroll">
            <table>
              <thead>
                <tr>
                  <th>Employee / Badge</th>
                  <th>Client Company</th>
                  <th>Role / Trade</th>
                  {data.masterTrainings.map((mt) => (
                    <th key={mt.training_id} title={mt.training_name}>
                      <Link to={`/trainings/${mt.training_id}`}>{mt.training_id}</Link>
                    </th>
                  ))}
                  <th>Audit Health</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp) => (
                  <tr key={emp.employee_id}>
                    <td><Link to={`/employees/${emp.employee_id}`}>{emp.full_name}</Link></td>
                    <td>{emp.client_name}</td>
                    <td>{emp.job_title || '—'}</td>
                    {data.masterTrainings.map((mt) => {
                      const cell = emp.cells[mt.training_id];
                      const formatted = formatCell(cell);
                      return (
                        <td key={mt.training_id}>
                          <span className={`badge ${formatted.className}`}>{formatted.text}</span>
                        </td>
                      );
                    })}
                    <td>{emp.audit_health_percent}% {emp.issue_count > 0 ? `(${emp.issue_count} issue${emp.issue_count === 1 ? '' : 's'})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
