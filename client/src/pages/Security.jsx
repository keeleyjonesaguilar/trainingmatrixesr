import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatEasternDate, formatEasternDateTime } from '../lib/dates';
import LoadingState from '../components/LoadingState.jsx';

const PAGE_SIZE = 25;

const ACCOUNT_ACTION_LABELS = {
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

// Everything server/lib/activityLog.js's logActivity() calls have used an `action` string for -
// kept as a flat lookup here (not derived from entity_type) since a few actions apply to more
// than one entity type and the wording differs slightly by context.
const ACTIVITY_ACTION_LABELS = {
  session_created: 'Training session created',
  session_updated: 'Training session updated',
  session_deleted: 'Training session deleted',
  session_link_copied: 'Sign-in/feedback link copied',
  qr_code_downloaded: 'QR code downloaded',
  roster_downloaded: 'Roster downloaded',
  aha_roster_downloaded: 'AHA roster downloaded',
  certificate_downloaded: 'Certificate downloaded',
  certificates_zip_downloaded: 'Certificates ZIP downloaded',
  client_created: 'Client created',
  client_updated: 'Client updated',
  client_deleted: 'Client deleted',
  clients_merged: 'Clients merged',
  employee_created: 'Employee created',
  employee_updated: 'Employee updated',
  employee_deleted: 'Employee deleted',
  employees_merged: 'Employees merged',
  trainer_created: 'Trainer created',
  training_type_created: 'Training type created',
  training_type_updated: 'Training type updated',
  training_type_deleted: 'Training type deleted',
  import_committed: 'Import committed',
  import_discarded: 'Import discarded',
  feedback_settings_updated: 'Feedback questions updated',
  trainer_pin_updated: 'Trainer close PIN updated',
  report_downloaded: 'Report downloaded',
};

// Prev/Next over a fixed page size, not an ever-growing LIMIT (Keeley's request, 2026-09-17: the
// page had grown into one long continuously-scrolling list) - shared by all three log tables below.
function Pager({ offset, setOffset, count, total }) {
  const start = total === 0 ? 0 : offset + 1;
  const end = offset + count;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
      <button
        type="button"
        className="secondary"
        disabled={offset === 0}
        onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
      >
        ← Prev
      </button>
      <button type="button" className="secondary" disabled={end >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
        Next →
      </button>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {total === 0 ? 'No rows' : `Showing ${start}–${end} of ${total}`}
      </span>
    </div>
  );
}

function RetentionNote({ days }) {
  return (
    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '2px 0 12px' }}>
      Only stored for {days} days, then automatically removed.
    </p>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'login', label: 'Login Attempts' },
  { key: 'account', label: 'Account Changes' },
  { key: 'activity', label: 'Activity Log' },
];

// Super Admin only security overview (Keeley's request, 2026-09-09/10, reorganized into tabs +
// pagination 2026-09-17 so it stops being one long continuously-scrolling page): (1) who
// currently holds admin/super_admin access and whether that's protected by MFA, (2) every login
// attempt with IP/device, (3) every privileged account-access action (creation/deletion, role
// changes, password resets, MFA/email changes), and (4) general app activity (sessions created,
// QR codes/certificates/rosters downloaded, records created/edited/deleted, imports committed).
// Reads GET /api/audit/*, all of which are themselves gated server-side to super_admin regardless
// of whether this page ever gets linked to or guessed at by anyone else.
export default function Security() {
  const [tab, setTab] = useState('overview');

  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [loginOffset, setLoginOffset] = useState(0);

  const [changes, setChanges] = useState(null);
  const [changesLoading, setChangesLoading] = useState(true);
  const [changesError, setChangesError] = useState('');
  const [changesUsernameFilter, setChangesUsernameFilter] = useState('');
  const [changesOffset, setChangesOffset] = useState(0);

  const [activity, setActivity] = useState(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [activityUsernameFilter, setActivityUsernameFilter] = useState('');
  const [activityOffset, setActivityOffset] = useState(0);

  const load = () => {
    setLoading(true);
    setLoginError('');
    api
      .getLoginAttempts({
        username: usernameFilter.trim() || undefined,
        outcome: outcomeFilter === 'all' ? undefined : outcomeFilter,
        offset: loginOffset,
      })
      .then(setData)
      .catch((e) => setLoginError(e.message))
      .finally(() => setLoading(false));
  };

  const loadChanges = () => {
    setChangesLoading(true);
    setChangesError('');
    api
      .getAccountChanges({ username: changesUsernameFilter.trim() || undefined, offset: changesOffset })
      .then(setChanges)
      .catch((e) => setChangesError(e.message))
      .finally(() => setChangesLoading(false));
  };

  const loadActivity = () => {
    setActivityLoading(true);
    setActivityError('');
    api
      .getActivityLog({ username: activityUsernameFilter.trim() || undefined, offset: activityOffset })
      .then(setActivity)
      .catch((e) => setActivityError(e.message))
      .finally(() => setActivityLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [loginOffset]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadChanges(); }, [changesOffset]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadActivity(); }, [activityOffset]);
  useEffect(() => { api.getAccessRoster().then(setRoster).catch((e) => setRosterError(e.message)); }, []);

  const submitFilters = (e) => {
    e.preventDefault();
    setLoginOffset(0);
    load();
  };

  const submitChangesFilter = (e) => {
    e.preventDefault();
    setChangesOffset(0);
    loadChanges();
  };

  const submitActivityFilter = (e) => {
    e.preventDefault();
    setActivityOffset(0);
    loadActivity();
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
        Login activity, account access changes, and general app activity - the record a security
        team (or you) would need after a suspected breach, or just to see what someone's been up
        to. Super Admin only.
      </p>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'btn' : 'btn btn-secondary'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {rosterError && <div className="error-banner">{rosterError}</div>}
          {!roster && !rosterError && <LoadingState label="Loading privileged accounts..." />}
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
                      <td>{formatEasternDate(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <div className="card">
              <h2>Login Activity (last 24h)</h2>
              <div className="toolbar" style={{ gap: 24 }}>
                <div>
                  <div className="page-subtitle" style={{ margin: 0 }}>Successful logins</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary.success_24h}</div>
                </div>
                <div>
                  <div className="page-subtitle" style={{ margin: 0 }}>Failed attempts</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{data.summary.failed_24h}</div>
                </div>
                <div>
                  <div className="page-subtitle" style={{ margin: 0 }}>Distinct IPs</div>
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
        </>
      )}

      {tab === 'login' && (
        <div className="card">
          <h2>Login Attempts</h2>
          <RetentionNote days={90} />
          {loginError && <div className="error-banner">{loginError}</div>}
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
                  <td>{formatEasternDateTime(row.attempted_at)}</td>
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
          {data && <Pager offset={loginOffset} setOffset={setLoginOffset} count={data.attempts.length} total={data.total} />}
        </div>
      )}

      {tab === 'account' && (
        <div className="card">
          <h2>Account &amp; Access Changes</h2>
          <RetentionNote days={90} />
          <p className="page-subtitle">
            Every account-affecting action taken by a logged-in session: user creation/deletion,
            role changes, password resets, and 2FA/email changes - who did it, to which account, and from what IP.
          </p>
          {changesError && <div className="error-banner">{changesError}</div>}
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
                  <td>{formatEasternDateTime(row.created_at)}</td>
                  <td><span className="badge badge-current">{ACCOUNT_ACTION_LABELS[row.action] || row.action}</span></td>
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
          {changes && <Pager offset={changesOffset} setOffset={setChangesOffset} count={changes.changes.length} total={changes.total} />}
        </div>
      )}

      {tab === 'activity' && (
        <div className="card">
          <h2>Activity Log</h2>
          <RetentionNote days={30} />
          <p className="page-subtitle">
            Routine usage across the app: training sessions created/edited/deleted, QR codes and
            certificates downloaded, rosters exported, clients/employees/trainers/training types
            created or changed, and imports committed.
          </p>
          {activityError && <div className="error-banner">{activityError}</div>}
          <form onSubmit={submitActivityFilter} className="toolbar">
            <input
              type="text"
              placeholder="Filter by username"
              value={activityUsernameFilter}
              onChange={(e) => setActivityUsernameFilter(e.target.value)}
            />
            <button type="submit" disabled={activityLoading}>{activityLoading ? 'Loading...' : 'Apply Filter'}</button>
          </form>

          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Performed By</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activity?.activity.map((row) => (
                <tr key={row.activity_id}>
                  <td>{formatEasternDateTime(row.created_at)}</td>
                  <td><span className="badge badge-current">{ACTIVITY_ACTION_LABELS[row.action] || row.action}</span></td>
                  <td>{row.actor_username}</td>
                  <td>{row.entity_label || '—'}</td>
                  <td>{row.details || '—'}</td>
                </tr>
              ))}
              {activity && activity.activity.length === 0 && (
                <tr><td colSpan={5}>No activity matches this filter.</td></tr>
              )}
            </tbody>
          </table>
          {activity && <Pager offset={activityOffset} setOffset={setActivityOffset} count={activity.activity.length} total={activity.total} />}
        </div>
      )}
    </div>
  );
}
