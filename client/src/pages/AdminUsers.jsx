import { useEffect, useState } from 'react';
import { api } from '../api';
import { useIsAdmin, useIsSuperAdmin } from '../authContext.jsx';
import { formatEasternDate } from '../lib/dates';
import LoadingState from '../components/LoadingState.jsx';

const ROLE_LABELS = { user: 'User', admin: 'Admin', super_admin: 'Super Admin' };

// A username is a login handle, not a name - full_name is the real human identifier once it's
// on file. A pending (not-yet-claimed) account without one yet falls back to its email; only a
// legacy account with neither falls all the way back to its username.
const displayName = (u) => u.full_name || (u.pending ? u.email : u.username) || 'this account';

export default function AdminUsers({ currentUsername }) {
  const isAdmin = useIsAdmin();
  const isSuperAdmin = useIsSuperAdmin();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [resendingId, setResendingId] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [emailTarget, setEmailTarget] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [fullNameTarget, setFullNameTarget] = useState(null);
  const [fullNameInput, setFullNameInput] = useState('');

  const load = () => api.listUsers().then(setUsers).catch((e) => setError(e.message));
  // Loading only gates the very first fetch - a later refresh (after adding/removing someone)
  // updates the table in place rather than hiding it again, since it's no longer really "loading."
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const addUser = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setCreating(true);
    try {
      const created = await api.createUser({ full_name: newFullName.trim(), email: newEmail.trim(), role: newRole });
      setNewFullName('');
      setNewEmail('');
      setNewRole('user');
      setNotice(
        created.inviteSent
          ? `Invite email sent to ${created.email} - they'll choose their own username and password when they click the link.`
          : `An account for ${created.email} was created, but the invite email failed to send (${created.inviteError || 'unknown error'}). Use "Resend Invite" once that's fixed.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const resendInvite = async (user) => {
    setError('');
    setNotice('');
    setResendingId(user.user_id);
    try {
      await api.resendInvite(user.user_id);
      setNotice(`Invite email re-sent to ${user.email}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setResendingId(null);
    }
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.adminUpdateUserEmail(emailTarget.user_id, emailInput.trim());
      setEmailTarget(null);
      setEmailInput('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitFullName = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.adminUpdateUserFullName(fullNameTarget.user_id, fullNameInput.trim());
      setFullNameTarget(null);
      setFullNameInput('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeUser = async (user) => {
    if (!window.confirm(`Remove login access for "${displayName(user)}"?`)) return;
    setError('');
    try {
      await api.deleteUser(user.user_id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const changeRole = async (user, role) => {
    setError('');
    try {
      await api.updateUserRole(user.user_id, role);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const disableMfaFor = async (user) => {
    if (!window.confirm(`Turn off Two-Factor Authentication for "${displayName(user)}"? Use this only if they've lost access to their authenticator app and backup codes.`)) return;
    setError('');
    try {
      await api.adminDisableMfa(user.user_id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError('');
    if (resetPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    try {
      await api.resetUserPassword(resetTarget.user_id, resetPassword);
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h1>Manage Users</h1>
      <p className="page-subtitle">
        Add or remove login accounts for the Training Matrix. <strong>Admin</strong> accounts can add/edit clients, employees, training
        records, import data, and manage other users. <strong>User</strong> accounts can view everything but can&apos;t make changes.
        {' '}<strong>Super Admin</strong> is everything Admin can do, plus the Security page (login/IP audit log) and the only role that
        can grant or remove Super Admin itself.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      {isAdmin && (
        <div className="card">
          <h2>Add a user</h2>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            They&apos;ll get an email with a link to set their own password - nothing to make up or share yourself.
          </p>
          <form onSubmit={addUser} className="toolbar">
            <input type="text" placeholder="Full Name" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
            <input type="email" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="user">User (view only)</option>
              <option value="admin">Admin (full access)</option>
              {isSuperAdmin && <option value="super_admin">Super Admin (full access + Security)</option>}
            </select>
            <button type="submit" disabled={creating || !newFullName || !newEmail}>{creating ? 'Adding...' : 'Add User & Send Invite'}</button>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Current users</h2>
        {loading ? <LoadingState label="Loading users..." /> : (
        <table>
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>2FA</th>
              <th>Added</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>
                  {u.full_name || <span className="badge badge-notapplicable">None</span>}
                  {isAdmin && (u.role !== 'super_admin' || isSuperAdmin) && (
                    <>
                      {' '}
                      <button className="link-button" onClick={() => { setFullNameTarget(u); setFullNameInput(u.full_name || ''); }}>
                        {u.full_name ? 'Change' : 'Add'}
                      </button>
                    </>
                  )}
                </td>
                <td>
                  {u.pending ? <span className="badge badge-notapplicable">Pending invite</span> : u.username}
                  {u.username === currentUsername ? ' (you)' : ''}
                </td>
                <td>
                  {u.email || <span className="badge badge-notapplicable">None</span>}
                  {isAdmin && (u.role !== 'super_admin' || isSuperAdmin) && (
                    <>
                      {' '}
                      <button className="link-button" onClick={() => { setEmailTarget(u); setEmailInput(u.email || ''); }}>
                        {u.email ? 'Change' : 'Add'}
                      </button>
                    </>
                  )}
                </td>
                <td>
                  {/* Granting/removing Super Admin is Super Admin-only (enforced server-side
                      too) - a regular admin sees a locked badge instead of a dropdown that
                      would just fail, for any row already at Super Admin. */}
                  {isAdmin && (isSuperAdmin || u.role !== 'super_admin') ? (
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                    </select>
                  ) : (
                    <span className={`badge ${u.role === 'user' ? 'badge-notapplicable' : 'badge-current'}`}>{ROLE_LABELS[u.role] || u.role}</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${u.mfa_enabled ? 'badge-current' : 'badge-notapplicable'}`}>{u.mfa_enabled ? 'On' : 'Off'}</span>
                </td>
                <td>{formatEasternDate(u.created_at)}</td>
                {isAdmin && (
                  <td>
                    {u.pending && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => resendInvite(u)}
                          disabled={!u.email || resendingId === u.user_id || (u.role === 'super_admin' && !isSuperAdmin)}
                          title={u.email ? '' : 'Add an email for this user first'}
                        >
                          {resendingId === u.user_id ? 'Sending...' : 'Resend Invite'}
                        </button>
                        {' '}
                      </>
                    )}
                    <button
                      className="secondary"
                      onClick={() => { setResetTarget(u); setResetPassword(''); }}
                      disabled={u.role === 'super_admin' && !isSuperAdmin}
                    >
                      Reset Password
                    </button>
                    {' '}
                    {u.mfa_enabled && (
                      <button
                        className="secondary"
                        onClick={() => disableMfaFor(u)}
                        disabled={u.role === 'super_admin' && !isSuperAdmin}
                      >
                        Disable 2FA
                      </button>
                    )}
                    {' '}
                    <button
                      className="secondary"
                      onClick={() => removeUser(u)}
                      disabled={users.length <= 1 || (u.role === 'super_admin' && !isSuperAdmin)}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {isAdmin && resetTarget && (
        <div className="card">
          <h2>Reset password for {displayName(resetTarget)}</h2>
          <form onSubmit={submitReset} className="toolbar">
            <input type="password" placeholder="New password (8+ characters)" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
            <button type="submit">Save New Password</button>
            <button type="button" className="secondary" onClick={() => setResetTarget(null)}>Cancel</button>
          </form>
        </div>
      )}

      {isAdmin && emailTarget && (
        <div className="card">
          <h2>Email for {displayName(emailTarget)}</h2>
          <form onSubmit={submitEmail} className="toolbar">
            <input type="email" placeholder="you@example.com" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} autoFocus />
            <button type="submit" disabled={!emailInput}>Save Email</button>
            <button type="button" className="secondary" onClick={() => { setEmailTarget(null); setEmailInput(''); }}>Cancel</button>
          </form>
        </div>
      )}

      {isAdmin && fullNameTarget && (
        <div className="card">
          <h2>Full Name for {displayName(fullNameTarget)}</h2>
          <form onSubmit={submitFullName} className="toolbar">
            <input type="text" placeholder="Jane Smith" value={fullNameInput} onChange={(e) => setFullNameInput(e.target.value)} autoFocus />
            <button type="submit" disabled={!fullNameInput}>Save Full Name</button>
            <button type="button" className="secondary" onClick={() => { setFullNameTarget(null); setFullNameInput(''); }}>Cancel</button>
          </form>
        </div>
      )}
    </div>
  );
}
