import { useEffect, useState } from 'react';
import { api } from '../api';
import { useIsAdmin, useIsSuperAdmin } from '../authContext.jsx';

const ROLE_LABELS = { user: 'User', admin: 'Admin', super_admin: 'Super Admin' };

export default function AdminUsers({ currentUsername }) {
  const isAdmin = useIsAdmin();
  const isSuperAdmin = useIsSuperAdmin();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = () => api.listUsers().then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const addUser = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setCreating(true);
    try {
      await api.createUser({ username: newUsername.trim(), password: newPassword, role: newRole });
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const removeUser = async (user) => {
    if (!window.confirm(`Remove login access for "${user.username}"?`)) return;
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

      {isAdmin && (
        <div className="card">
          <h2>Add a user</h2>
          <form onSubmit={addUser} className="toolbar">
            <input type="text" placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
            <input type="password" placeholder="Password (8+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="user">User (view only)</option>
              <option value="admin">Admin (full access)</option>
              {isSuperAdmin && <option value="super_admin">Super Admin (full access + Security)</option>}
            </select>
            <button type="submit" disabled={creating || !newUsername || !newPassword}>{creating ? 'Adding...' : 'Add User'}</button>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Current users</h2>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Added</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>{u.username}{u.username === currentUsername ? ' (you)' : ''}</td>
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
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="secondary"
                      onClick={() => { setResetTarget(u); setResetPassword(''); }}
                      disabled={u.role === 'super_admin' && !isSuperAdmin}
                    >
                      Reset Password
                    </button>
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
      </div>

      {isAdmin && resetTarget && (
        <div className="card">
          <h2>Reset password for {resetTarget.username}</h2>
          <form onSubmit={submitReset} className="toolbar">
            <input type="password" placeholder="New password (8+ characters)" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
            <button type="submit">Save New Password</button>
            <button type="button" className="secondary" onClick={() => setResetTarget(null)}>Cancel</button>
          </form>
        </div>
      )}
    </div>
  );
}
