import { useEffect, useState } from 'react';
import { api } from '../api';

const ACTION_LABELS = {
  user_created: 'User created',
  user_deleted: 'User deleted',
  role_changed: 'Role changed',
  password_reset_by_admin: 'Password reset (by admin)',
  password_reset_via_email_link: 'Password reset (via email link)',
  mfa_disabled_by_admin: '2FA disabled (by admin)',
  mfa_enabled: '2FA enabled',
  mfa_disabled: '2FA disabled',
  email_changed: 'Email changed',
  email_changed_by_admin: 'Email changed (by admin)',
};

// Super Admin only security overview (Keeley's request, 2026-09-09/10) - three things a security
// team investigating a suspected breach would actually want: (1) every login attempt with IP/
// device, (2) every privileged action taken against account access afterward (not just logins -
// user creation/deletion, role changes, password resets, MFA/email changes), and (3) who
// currently holds admin/super_admin access and whether that access is actually protected by MFA.
// Reads GET /api/audit/*, all of which are themselves gated server-side to super_admin regardless
// of whether this page ever gets linked to or guessed at by anyone else.
export default function Security() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [usernameFilter, setUsernameFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const [roster, setRoster] = useState(null);
  const [changes, setChanges] = useState(null);
  const [changesUsernameFilter, setChangesUsernameFilter] = useState('');
  const [changesLoading, setChangesLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    api.getLoginAttempts({ username: usernameFilter.trim() || undefined, outcome: outcomeFilter === 'all' ? undefined : outcomeFilter })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadChanges = () => {
    setChangesLoading(true);
    api.getAccountChanges({ username: changesUsernameFilter.trim() || undefined })
      .then(setChanges)
      .catch((e) => setError(e.message))
      .finally(() => setChangesLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadChanges(); }, []);
  useEffect(() => { api.getAccessRoster().then(setRoster).catch((e) => setError(e.message)); }, []);

  const submitFilters = (e) => {
    e.preventDefault();
    load();
  };

  const submitChangesFilter = (e) => {
    e.preventDefault();
    loadChanges();
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
        Login activity, account access changes, and current privileged-account protection - the
        record a security team would need after a suspected breach. Super Admin only.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {roster && (
        <div className="card">
          <h2>Privileged Accounts</h2>
          <p className="page-subtitle">
            {roster.privileged_accounts.length} of {roster.total_accounts} accounts hold Admin or Super Admin access.
          </p>
          {roster.privileged_without_mfa.length > 0 && (
            <div className="error-banner">
              Without Two-Factor Authentication: <strong>{roster.privileged_without_mfa.join(', ')}</strong>
            </div>
          )}
          {roster.privileged_without_email.length > 0 && (
            <div className="error-banner" style={{ marginTop: roster.privileged_without_mfa.length > 0 ? 8 : 0 }}>
              Without an email on file (can&apos;t use &quot;forgot password&quot;): <strong>{roster.privileged_without_email.join(', ')}</strong>
            </div>
          )}
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Email</th>
                <th>2FA</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {roster.privileged_accounts.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td><span className="badge badge-current">{u.role === 'super_admin' ? 'Super Admin' : 'Admin'}</span></td>
                  <td>{u.email || <span className="badge badge-notapplicable">None</span>}</td>
                  <td><span className={`badge ${u.mfa_enabled ? 'badge-current' : 'badge-expiringsoon'}`}>{u.mfa_enabled ? 'On' : 'Off'}</span></td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="card">
          <h2>Login Activity</h2>
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
        <h2>Login Attempts</h2>
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

      <div className="card">
        <h2>Account &amp; Access Changes</h2>
        <p className="page-subtitle">
          Every account-affecting action taken by a logged-in session: user creation/deletion,
          role changes, password resets, and 2FA/email changes - who did it, to which account, and from what IP.
        </p>
        <form onSubmit={submitChangesFilter} className="toolbar">
          <input
            type="text"
            placeholder="Filter by username (actor or target)"
            value={changesUsernameFilter}
            onChange={(e) => setChangesUsernameFilter(e.target.value)}
          />
          <button type="submit" disabled={changesLoading}>{changesLoading ? 'Loading...' : 'Apply Filter'}</button>
        </form>

        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Performed By</th>
              <th>Account Affected</th>
              <th>Details</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {changes?.changes.map((row) => (
              <tr key={row.action_id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td><span className="badge badge-current">{ACTION_LABELS[row.action] || row.action}</span></td>
                <td>{row.actor_username}</td>
                <td>{row.target_username || '—'}</td>
                <td>{row.details || '—'}</td>
                <td>{row.ip_address || '—'}</td>
              </tr>
            ))}
            {changes && changes.changes.length === 0 && (
              <tr><td colSpan={6}>No account changes match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
