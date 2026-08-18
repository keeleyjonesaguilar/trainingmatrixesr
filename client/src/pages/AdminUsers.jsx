import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AdminUsers({ currentUsername }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
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
      await api.createUser({ username: newUsername.trim(), password: newPassword });
      setNewUsername('');
      setNewPassword('');
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
      <p className="page-subtitle">Add or remove login accounts for the Training Matrix. Anyone listed here signs in with their own username and password.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h2>Add a user</h2>
        <form onSubmit={addUser} className="toolbar">
          <input type="text" placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          <input type="password" placeholder="Password (8+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <button type="submit" disabled={creating || !newUsername || !newPassword}>{creating ? 'Adding...' : 'Add User'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Current users</h2>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>{u.username}{u.username === currentUsername ? ' (you)' : ''}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="secondary" onClick={() => { setResetTarget(u); setResetPassword(''); }}>Reset Password</button>
                  {' '}
                  <button className="secondary" onClick={() => removeUser(u)} disabled={users.length <= 1}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget && (
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
