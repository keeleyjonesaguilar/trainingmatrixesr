import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

function healthPillClass(health) {
  if (health === 'Compliant') return 'pill-compliant';
  if (health === 'Review Pending') return 'pill-review-pending';
  return 'pill-action-required';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const days = Math.round((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `in ${Math.abs(days)}d`;
  if (days === 0) return 'today';
  return `${days}d ago`;
}

// Shared between the org-wide dashboard and the per-client drilldown (Keeley's request,
// 2026-08-19: "add the same table for Most Popular Trainings but only for that client") -
// same ranked-bar rendering either way, just fed a different (already server-scoped) list.
function PopularityList({ items }) {
  const maxCount = Math.max(1, ...items.map((m) => m.completed_count));
  return (
    <div className="popularity-list">
      {items.map((m) => (
        <div key={m.training_id} className="popularity-row">
          <div className="popularity-name">{m.training_id} &mdash; {m.training_name}</div>
          <div className="popularity-track">
            <div className="popularity-fill" style={{ width: `${Math.max((m.completed_count / maxCount) * 100, 12)}%` }}>
              <span className="popularity-count">{m.completed_count}</span>
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>No trainings completed yet.</p>}
    </div>
  );
}

export default function Dashboard() {
  const isAdmin = useIsAdmin();
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // NOTE (2026-08-18): this used to also fetch the full client list here just to show a
  // "clients.length" caption, but the dashboard already gets data.totalClients from the
  // /api/dashboard response - the extra api.listClients() call was dead weight on every
  // dashboard load and part of why it felt slow. Removed.
  useEffect(() => {
    setError('');
    api.getDashboard(clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [clientId]);

  const goToMatrix = (status, forClientId) => {
    const params = new URLSearchParams();
    if (forClientId || clientId) params.set('client_id', forClientId || clientId);
    if (status) params.set('status', status);
    navigate(`/matrix?${params.toString()}`);
  };

  if (clientId && data && data.scope === 'client') {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{data.client.client_name}</h1>
            <p className="page-subtitle">Client compliance overview.</p>
          </div>
          <div className="page-header-actions">
            <button className="secondary" onClick={() => setClientId('')}>Back to All Clients</button>
            <button onClick={() => goToMatrix(undefined, clientId)}>Open Training Matrix</button>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {/* Keeley's call, 2026-08-18: dropped the Current/Expired/Missing/Not Applicable/
            No Expiration/Pending Review summary tiles here for now - she's going to spec out
            what this client compliance overview should actually show next. */}
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Active Employees</div>
            <div className="value">{data.totalActiveEmployees}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Training Records</div>
            <div className="value">{data.totalTrainingRecords}</div>
          </div>
        </div>

        <div className="card">
          <h2>Most Popular Trainings</h2>
          <p className="page-subtitle" style={{ margin: '0 0 12px' }}>Ranked by how many of {data.client.client_name}'s employees have completed each one.</p>
          <PopularityList items={data.mostPopularTrainings} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Safety Training Dashboard</h1>
          <p className="page-subtitle">Compliance overview across all clients.</p>
        </div>
        <div className="page-header-actions">
          <button onClick={() => navigate('/matrix')}>Open Training Matrix</button>
          {isAdmin && <button className="secondary" onClick={() => navigate('/import')}>Import Client Roster</button>}
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {data && data.scope === 'all' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile clickable" onClick={() => navigate('/clients')}>
              <div className="stat-label">Client Companies</div>
              <div className="value">{data.totalClients}</div>
              <span className="caption">View Clients</span>
            </div>
            <div className="stat-tile clickable" onClick={() => navigate('/matrix')}>
              <div className="stat-label">Active Employees</div>
              <div className="value">{data.totalActiveEmployees}</div>
              <span className="caption">Open Training Matrix</span>
            </div>
          </div>

          <div className="layout-2col">
            <div className="card">
              <h2>Client Portfolios &amp; Matrix Access</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Company Name</th>
                      <th>Employees</th>
                      <th>Compliance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perClient.map((c) => (
                      <tr key={c.client_id} style={{ cursor: 'pointer' }} onClick={() => setClientId(c.client_id)}>
                        <td>{c.client_name}</td>
                        <td>{c.totalActiveEmployees}</td>
                        <td>{c.complianceRate}%</td>
                        <td><span className={`badge ${healthPillClass(c.healthStatus)}`}>{c.healthStatus}</span></td>
                      </tr>
                    ))}
                    {data.perClient.length === 0 && (
                      <tr><td colSpan={4} className="empty-state">No clients yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="card">
                <h2>Recently Expired Trainings</h2>
                <div className="activity-feed">
                  {data.urgentGaps.map((g, i) => (
                    <div key={i} className="activity-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`/employees/${g.employee_id}`)}>
                      <div>
                        <div className="activity-item-title">{g.full_name}</div>
                        <div className="activity-item-desc">{g.training_id} {g.training_name}</div>
                      </div>
                      <div className="activity-item-time">
                        {`Expired ${timeAgo(g.expiration_date)}`}
                      </div>
                    </div>
                  ))}
                  {data.urgentGaps.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>Nothing expired right now.</p>}
                </div>
              </div>

              <div className="card">
                <h2>Most Popular Trainings</h2>
                <p className="page-subtitle" style={{ margin: '0 0 12px' }}>Ranked by how many employees have completed each one.</p>
                <PopularityList items={data.mostPopularTrainings} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
