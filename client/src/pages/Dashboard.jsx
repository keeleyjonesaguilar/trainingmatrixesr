import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import { formatCell, STATUS_OPTIONS, buildComplianceReportRows } from '../lib/matrixCell.js';
import { downloadCsv } from '../lib/csv.js';
import TrainingFilterDropdown from '../components/TrainingFilterDropdown.jsx';
import LoadingState from '../components/LoadingState.jsx';

function healthPillClass(health) {
  return health === 'Compliant' ? 'pill-compliant' : 'pill-action-required';
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
// Each row links to that training's own page (Keeley's request, 2026-08-19); when shown on a
// client drilldown, the link carries client_id along so the Training page opens already
// scoped to that client instead of showing everyone.
function PopularityList({ items, forClientId }) {
  const maxCount = Math.max(1, ...items.map((m) => m.completed_count));
  return (
    <div className="popularity-list">
      {items.map((m) => (
        <Link
          key={m.training_id}
          to={`/training-types/${m.training_id}${forClientId ? `?client_id=${forClientId}` : ''}`}
          className="popularity-row"
        >
          <div className="popularity-name">{m.training_id} &mdash; {m.training_name}</div>
          <div className="popularity-track">
            <div className="popularity-fill" style={{ width: `${Math.max((m.completed_count / maxCount) * 100, 12)}%` }}>
              <span className="popularity-count">{m.completed_count}</span>
            </div>
          </div>
        </Link>
      ))}
      {items.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>No trainings completed yet.</p>}
    </div>
  );
}

const UPCOMING_PER_PAGE = 5;
const UPCOMING_MAX = 20;

// Upcoming Trainings Scheduled (Keeley's request): open sessions dated today or later, soonest
// first, capped at 20 and paginated 5-per-page with numbered page buttons (not Prev/Next) -
// naturally caps at 4 pages given the 20-item limit. Past-dated open sessions (never closed
// out) are excluded so this stays a clean "what's coming up" list, not a backlog of stale ones.
function UpcomingTrainingsBox({ clientId }) {
  const [sessions, setSessions] = useState([]);
  const [page, setPage] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    api.listTrainingSessions({ status: 'open', client_id: clientId || undefined }).then((rows) => {
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = rows
        .filter((s) => s.session_date >= today)
        .sort((a, b) => a.session_date.localeCompare(b.session_date))
        .slice(0, UPCOMING_MAX);
      setSessions(upcoming);
      setPage(0);
    }).catch(() => {});
  }, [clientId]);

  const totalPages = Math.max(1, Math.ceil(sessions.length / UPCOMING_PER_PAGE));
  const pageRows = sessions.slice(page * UPCOMING_PER_PAGE, page * UPCOMING_PER_PAGE + UPCOMING_PER_PAGE);

  return (
    <div className="card">
      <h2>Upcoming Trainings Scheduled</h2>
      <div className="activity-feed">
        {pageRows.map((s) => (
          <div key={s.session_id} className="activity-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`/sessions/${s.session_id}`)}>
            <div>
              <div className="activity-item-title">{s.training_type_label}</div>
              <div className="activity-item-desc">{s.client_name} &middot; {s.trainer_name}</div>
            </div>
            <div className="activity-item-time">{s.session_date}</div>
          </div>
        ))}
        {sessions.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>Nothing scheduled right now.</p>}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              type="button"
              className={page === i ? '' : 'secondary'}
              style={{ padding: '4px 10px' }}
              onClick={() => setPage(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact flags on the Dashboard, one box, two separate notifications (Keeley's request) -
// the actual review/merge UI lives on the Employees and Clients pages; this is just a
// heads-up with a link to each.
function DuplicatesSummaryBox() {
  const [employeeCount, setEmployeeCount] = useState(0);
  const [clientCount, setClientCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    api.getPossibleDuplicateEmployees().then((clusters) => setEmployeeCount(clusters.length)).catch(() => {});
    api.getPossibleDuplicateClients().then((clusters) => setClientCount(clusters.length)).catch(() => {});
  }, []);

  if (employeeCount === 0 && clientCount === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {employeeCount > 0 && (
        <div style={{ cursor: 'pointer', marginBottom: clientCount > 0 ? 10 : 0 }} onClick={() => navigate('/matrix')}>
          <strong>{employeeCount} possible duplicate employee{employeeCount === 1 ? '' : 's'} found</strong>
          <p className="page-subtitle" style={{ margin: '2px 0 0' }}>Review and merge them on the Employees page.</p>
        </div>
      )}
      {clientCount > 0 && (
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/clients')}>
          <strong>{clientCount} possible duplicate client{clientCount === 1 ? '' : 's'} found</strong>
          <p className="page-subtitle" style={{ margin: '2px 0 0' }}>Review and merge them on the Clients page.</p>
        </div>
      )}
    </div>
  );
}

// Every employee at this client against the Master Training Catalog, right on the Client
// Compliance Overview page (Keeley's request, part of a nav consolidation: fewer top-level
// pages, more depth per client instead) - deliberately the same grid as the old standalone
// Employees/Matrix page (same columns, same status badges via formatCell) rather than a new
// layout, since that's the view admins already know. Reuses the existing /matrix endpoint
// scoped to this client, so it costs nothing beyond what that page already does.
//
// Carries the same filter options and Active/Inactive summary tiles as the main Employee Matrix
// page (Keeley's request, 2026-09-16) - this used to be just a bare name search, noticeably
// weaker than what /matrix itself offers for the exact same data. No Client Account filter here
// since this section is already scoped to one client.
function ClientEmployeesSection({ clientId, clientName }) {
  const [allMasterTrainings, setAllMasterTrainings] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [trainingIds, setTrainingIds] = useState([]);
  const [activeParam, setActiveParam] = useState('1');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.listMasterTrainings(true).then(setAllMasterTrainings).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ client_id: clientId, active: activeParam });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    for (const tid of trainingIds) params.append('training_ids', tid);
    api.getMatrix(params).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [clientId, search, trainingIds.join(','), activeParam, status]);

  if (error) return <div className="error-banner">{error}</div>;
  if (loading || !data) return <div className="card" style={{ marginTop: 16 }}><h2>Employees</h2><LoadingState label="Loading employees..." /></div>;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Employees</h2>
        {/* Exports the currently filtered/visible rows, flattened one row per (employee,
            training) cell rather than the wide on-screen grid (Keeley's request, 2026-09-18). */}
        <button
          className="secondary"
          disabled={data.employees.length === 0}
          onClick={() => downloadCsv(
            `${clientName}-training-report${status ? `_${status.toLowerCase().replace(/\s+/g, '-')}` : ''}.csv`,
            buildComplianceReportRows(data.employees, data.masterTrainings, { status, includeClient: false })
          )}
        >
          Download Report
        </button>
      </div>

      <div className="stat-grid">
        <div className={`stat-tile clickable${activeParam === '1' ? ' selected' : ''}`} onClick={() => setActiveParam('1')}>
          <div className="stat-label">Active Employees</div>
          <div className="value">{data.stats.audited_employees}</div>
        </div>
        <div className={`stat-tile clickable${activeParam === '0' ? ' selected' : ''}`} onClick={() => setActiveParam('0')}>
          <div className="stat-label">Inactive Employees</div>
          <div className="value">{data.stats.inactive_employees}</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="field-row">
          <label>Search Employee</label>
          <input
            type="search"
            placeholder="Type name..."
            defaultValue={search}
            onKeyDown={(e) => { if (e.key === 'Enter') setSearch(e.target.value); }}
            onBlur={(e) => setSearch(e.target.value)}
          />
        </div>
        <TrainingFilterDropdown masterTrainings={allMasterTrainings} selected={trainingIds} onChange={setTrainingIds} />
        <div className="field-row">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any Status</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => { setSearch(''); setTrainingIds([]); setActiveParam('1'); setStatus(''); }}
        >
          Reset Filters
        </button>
      </div>
      {status && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          Showing employees with at least one training marked <strong>{status}</strong>.
        </p>
      )}

      {trainingIds.length > 0 && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          Showing employees who currently hold <strong>all</strong> of:{' '}
          {trainingIds.map((tid) => allMasterTrainings.find((mt) => mt.training_id === tid)?.training_name || tid).join(', ')}
        </p>
      )}

      {data.employees.length === 0 ? (
        <div className="empty-state">No employees match these filters.</div>
      ) : (
        <div className="matrix-scroll">
          <table>
            <thead>
              <tr>
                <th>Employee / Badge</th>
                <th>Role / Trade</th>
                {data.masterTrainings.map((mt) => (
                  <th key={mt.training_id} className="matrix-vertical-th" title={mt.training_name}>
                    <div className="matrix-vertical-name">{mt.training_name}</div>
                    <Link to={`/training-types/${mt.training_id}?client_id=${clientId}`} className="matrix-vertical-code">
                      {mt.training_id}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr key={emp.employee_id}>
                  <td><Link to={`/employees/${emp.employee_id}`}>{emp.full_name}</Link></td>
                  <td>{emp.job_title || '—'}</td>
                  {data.masterTrainings.map((mt) => {
                    const cell = emp.cells[mt.training_id];
                    const formatted = formatCell(cell);
                    return (
                      <td key={mt.training_id}>
                        {formatted.plain ? formatted.text : <span className={`badge ${formatted.className}`}>{formatted.text}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const isAdmin = useIsAdmin();
  // client_id lives in the URL, not local state (Keeley's request, 2026-08-19): the Clients
  // directory links straight into a specific client's Compliance Overview
  // (e.g. /?client_id=<id>), which only works if this page's drilldown is addressable by URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const clientId = searchParams.get('client_id') || '';
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

  if (clientId && data && data.scope === 'client') {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>{data.client.client_name}</h1>
            <p className="page-subtitle">Client compliance overview.</p>
          </div>
          <div className="page-header-actions">
            <button className="secondary" onClick={() => setSearchParams({})}>Back to All Clients</button>
            {/* "Settings" (Keeley's request, 2026-08-19): takes you to this client's training
                requirements/overrides page - renamed from "View Settings" for consistency with
                the same link on the Clients directory. */}
            <button className="secondary" onClick={() => navigate(`/clients/${clientId}`)}>Settings</button>
            {/* Reports moved out of the main nav (Keeley's request) - generated in context from
                here instead, pre-scoped to this client via the same ?client_id= filter the
                Reports page already supported. */}
            <button className="secondary" onClick={() => navigate(`/reports?client_id=${clientId}`)}>Generate Report</button>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Active Employees</div>
            <div className="value">{data.totalActiveEmployees}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Training Records</div>
            <div className="value">{data.totalTrainingRecords}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Compliance</div>
            <div className="value">{data.complianceRate}%</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Status</div>
            {data.healthStatus === 'Action Required' ? (
              <button
                type="button"
                className="badge pill-action-required"
                style={{ border: 'none', cursor: 'pointer', marginTop: 4 }}
                onClick={() => navigate(`/action-required?client_id=${clientId}`)}
              >
                Action Required →
              </button>
            ) : (
              <span className="badge pill-compliant" style={{ marginTop: 4 }}>Compliant</span>
            )}
          </div>
        </div>

        <UpcomingTrainingsBox clientId={clientId} />

        <div className="card">
          <h2>Most Popular Trainings</h2>
          <p className="page-subtitle" style={{ margin: '0 0 12px' }}>Ranked by how many of {data.client.client_name}'s employees have completed each one. Click a training to view its page.</p>
          <PopularityList items={data.mostPopularTrainings} forClientId={clientId} />
        </div>

        <ClientEmployeesSection clientId={clientId} clientName={data.client.client_name} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Safety Training Dashboard</h1>
        </div>
        <div className="page-header-actions">
          <button onClick={() => navigate('/sessions?new=1')}>Create New Training Session</button>
          <button className="secondary" onClick={() => navigate('/clients?new=1')}>Create a New Client</button>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {data && data.scope === 'all' && (
        <>
          <div className="stat-grid">
            <div className="stat-tile clickable" onClick={() => navigate('/clients')}>
              <div className="stat-label">Clients</div>
              <div className="value">{data.totalClients}</div>
              <span className="caption">View Clients</span>
            </div>
            <div className="stat-tile clickable" onClick={() => navigate('/matrix')}>
              <div className="stat-label">Active Employees</div>
              <div className="value">{data.totalActiveEmployees}</div>
              <span className="caption">View Employees</span>
            </div>
          </div>

          {isAdmin && <DuplicatesSummaryBox />}

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
                      <tr key={c.client_id} style={{ cursor: 'pointer' }} onClick={() => setSearchParams({ client_id: c.client_id })}>
                        <td>{c.client_name}</td>
                        <td>{c.totalActiveEmployees}</td>
                        <td>{c.complianceRate}%</td>
                        <td>
                          {c.healthStatus === 'Action Required' ? (
                            <button
                              type="button"
                              className={`badge ${healthPillClass(c.healthStatus)}`}
                              style={{ border: 'none', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); navigate(`/action-required?client_id=${c.client_id}`); }}
                            >
                              Action Required →
                            </button>
                          ) : (
                            <span className={`badge ${healthPillClass(c.healthStatus)}`}>{c.healthStatus}</span>
                          )}
                        </td>
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
              <UpcomingTrainingsBox />

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
                <p className="page-subtitle" style={{ margin: '0 0 12px' }}>Ranked by how many employees have completed each one. Click a training to view its page.</p>
                <PopularityList items={data.mostPopularTrainings} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
