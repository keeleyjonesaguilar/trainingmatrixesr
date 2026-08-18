import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

// Nicer "add a client" UI (Keeley's request, 2026-08-18): a small "+ Add Client" button that
// expands into a proper form card, instead of a plain inline text-input-and-button toolbar.
function AddClientForm({ onAdded, onCancel }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.createClient({ client_name: name.trim(), notes: notes.trim() || null });
      onAdded();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card add-client-card" onSubmit={submit}>
      <h2>Add a New Client</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="field-row">
        <label>Client Name</label>
        <input
          type="text"
          autoFocus
          placeholder="e.g. Resolute Builders"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="field-row">
        <label>Notes (optional)</label>
        <input
          type="text"
          placeholder="Internal notes about this client"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <button type="submit" disabled={saving || !name.trim()}>{saving ? 'Adding...' : 'Add Client'}</button>{' '}
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// Main Client Settings page (restructured 2026-08-18 per Keeley's request): this is now a
// running directory of clients. Click into one to view/edit that client's training
// requirements and expiration overrides on its own page (see ClientDetail.jsx).
export default function ClientSettings() {
  const isAdmin = useIsAdmin();
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);

  const load = () => api.listClients().then(setClients).catch((e) => setError(e.message));
  // NOTE: useEffect(load, []) directly (load as the effect callback) was the bug here - load()
  // returns the Promise from .catch(), and React tries to call that returned value as the
  // effect's cleanup function on unmount, which throws "destroy is not a function" and crashes
  // the whole app (blank screen until a hard refresh) every time you navigate away from this
  // page. Wrapping it in a block body discards that return value so there's nothing for React
  // to mistake for a cleanup function.
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Clients</h1>
          <p className="page-subtitle">Every client on the Training Matrix. Click a client to view or edit their training requirements and expiration overrides.</p>
        </div>
        {isAdmin && !addingOpen && (
          <div className="page-header-actions">
            <button onClick={() => setAddingOpen(true)}>+ Add Client</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {addingOpen && (
        <AddClientForm
          onAdded={() => { setAddingOpen(false); load(); }}
          onCancel={() => setAddingOpen(false)}
        />
      )}

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Client Name</th>
                <th>Employees</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.client_id}>
                  <td><Link to={`/clients/${c.client_id}`}>{c.client_name}</Link></td>
                  <td>{c.employee_count ?? 0}</td>
                  <td><span className={`badge ${c.active ? 'badge-current' : 'badge-notapplicable'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                  <td><Link to={`/clients/${c.client_id}`}>View Settings &rarr;</Link></td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={4} className="empty-state">No clients yet{isAdmin ? ' — add one above.' : '.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
