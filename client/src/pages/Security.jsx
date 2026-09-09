import { useEffect, useState } from 'react';
import { api } from '../api';

// Super Admin only login/IP audit view (Keeley's request, 2026-09-09) - reads
// GET /api/audit/login-attempts, which is itself gated server-side to super_admin regardless
// of whether this page ever gets linked to or guessed at by anyone else.
export default function Security() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [usernameFilter, setUsernameFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const load = () => {
    setLoading(true);
    setError('');
    api.getLoginAttempts({ username: usernameFilter.trim() || undefined, outcome: outcomeFilter === 'all' ? undefined : outcomeFilter })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const submitFilters = (e) => {
    e.preventDefault();
    load();
  };

  const outcomeLabel = (row) => {
    if (row.blocked) return 'Blocked (lockout)';
    return row.success ? 'Success' : 'Failed';
  };

  const outcomeBadgeClass = (row) => {
    if (row.blocked) return 'badge-expired';
    return row.success ? 'badge-current' : 'badge-expiringsoon';
  };

  return (
    <div>
      <h1>Security</h1>
      <p className="page-subtitle">
        Every login attempt against this app - success, failure, or blocked by a lockout - with
        the IP address and browser it came from. Super Admin only.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {data && (
        <div className="card">
          <div className="toolbar" style={{ gap: 24 }}>
            <div>
              <div className="page-subtitle" style={{ margin: 0 }}>Successful logins (24h)</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary.success_24h}</div>
            </div>
            <div>
              <div className="page-subtitle" style={{ margin: 0 }}>Failed attempts (24h)</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary.failed_24h}</div>
            </div>
            <div>
              <div className="page-subtitle" style={{ margin: 0 }}>Distinct IPs (24h)</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary.distinct_ips_24h}</div>
            </div>
          </div>
          {data.currently_locked.length > 0 && (
            <div className="error-banner" style={{ marginTop: 12 }}>
              Currently locked out (too many failed attempts in the last 15 minutes): {data.currently_locked.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <form onSubmit={submitFilters} className="toolbar">
          <input
            type="text"
            placeholder="Filter by username"
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
          />
          <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}>
            <option value="all">All outcomes</option>
            <option value="success">Success only</option>
            <option value="failed">Failed only</option>
            <option value="blocked">Blocked (lockout) only</option>
          </select>
          <button type="submit" disabled={loading}>{loading ? 'Loading...' : 'Apply Filters'}</button>
        </form>

        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Username</th>
              <th>Outcome</th>
              <th>IP Address</th>
              <th>Browser / Device</th>
            </tr>
          </thead>
          <tbody>
            {data?.attempts.map((row) => (
              <tr key={row.attempt_id}>
                <td>{new Date(row.attempted_at).toLocaleString()}</td>
                <td>{row.username_attempted}</td>
                <td><span className={`badge ${outcomeBadgeClass(row)}`}>{outcomeLabel(row)}</span></td>
                <td>{row.ip_address || '—'}</td>
                <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.user_agent || ''}>
                  {row.user_agent || '—'}
                </td>
              </tr>
            ))}
            {data && data.attempts.length === 0 && (
              <tr><td colSpan={5}>No login attempts match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
