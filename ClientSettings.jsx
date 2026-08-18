import { useEffect, useState } from 'react';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

const REQUIREMENT_OPTIONS = ['Required', 'Not Required', 'Optional', 'Not Applicable'];
const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];

function RequirementRow({ clientId, row, onSaved, isAdmin }) {
  const [requirementStatus, setRequirementStatus] = useState(row.requirement_status);
  const [expirationUnit, setExpirationUnit] = useState(row.client_expiration_unit || '');
  const [notes, setNotes] = useState(row.client_notes || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const markDirty = (setter) => (value) => { setter(value); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      await api.setClientRequirement(clientId, row.training_id, {
        requirement_status: requirementStatus,
        client_expiration_unit: expirationUnit || null,
        client_notes: notes || null,
        // effective_date intentionally omitted - the backend defaults it to today.
        // Rule 9: records completed before this date keep whatever they already had.
      });
      setDirty(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <tr>
        <td>{row.training_id}</td>
        <td>{row.master_training_name}</td>
        <td>{requirementStatus}</td>
        <td>
          {expirationUnit || `Master Default (${row.master_default_expiration})`}
          {' '}
          <span className="badge badge-notapplicable" style={{ marginLeft: 4 }}>{row.expiration_source}</span>
        </td>
        <td>{notes || '—'}</td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{row.training_id}</td>
      <td>{row.master_training_name}</td>
      <td>
        <select value={requirementStatus} onChange={(e) => markDirty(setRequirementStatus)(e.target.value)}>
          {REQUIREMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td>
        <select value={expirationUnit} onChange={(e) => markDirty(setExpirationUnit)(e.target.value)}>
          <option value="">Master Default ({row.master_default_expiration})</option>
          {EXPIRATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {' '}
        <span className="badge badge-notapplicable" style={{ marginLeft: 4 }}>{row.expiration_source}</span>
      </td>
      <td>
        <input type="text" placeholder="Client notes" value={notes} onChange={(e) => markDirty(setNotes)(e.target.value)} />
      </td>
      <td>
        <button disabled={!dirty || saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
      </td>
    </tr>
  );
}

export default function ClientSettings() {
  const isAdmin = useIsAdmin();
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [rows, setRows] = useState([]);
  const [newClientName, setNewClientName] = useState('');
  const [error, setError] = useState('');

  const loadClients = () => api.listClients().then(setClients).catch((e) => setError(e.message));
  useEffect(() => { loadClients(); }, []);

  const loadRequirements = (clientId) => {
    if (!clientId) return;
    api.getClientRequirements(clientId).then(setRows).catch((e) => setError(e.message));
  };

  useEffect(() => { loadRequirements(selectedClientId); }, [selectedClientId]);

  const [addingClient, setAddingClient] = useState(false);

  const addClient = async () => {
    if (!newClientName.trim()) return;
    setError('');
    setAddingClient(true);
    try {
      const client = await api.createClient({ client_name: newClientName.trim() });
      setNewClientName('');
      await loadClients();
      setSelectedClientId(client.client_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingClient(false);
    }
  };

  return (
    <div>
      <h1>Client Settings</h1>
      <p className="page-subtitle">Per-client training requirements and expiration overrides. Overrides never affect the Master Catalog or other clients.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="toolbar">
          <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}>
            <option value="">Select a client...</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          {isAdmin && (
            <>
              <input type="text" placeholder="New client name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
              <button onClick={addClient} disabled={!newClientName.trim() || addingClient}>{addingClient ? 'Adding...' : 'Add Client'}</button>
            </>
          )}
        </div>
      </div>

      {selectedClientId && (
        <div className="card">
          <h2>Training Requirements</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Training ID</th>
                  <th>Master Training</th>
                  <th>Requirement</th>
                  <th>Expiration</th>
                  <th>Client Notes</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RequirementRow key={row.training_id} clientId={selectedClientId} row={row} isAdmin={isAdmin} onSaved={() => loadRequirements(selectedClientId)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
