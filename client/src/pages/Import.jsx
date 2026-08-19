import { useEffect, useState } from 'react';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

// Small inline "add a client" form, same pattern as ClientSettings.jsx's AddClientForm, so an
// admin who doesn't yet have the client they're importing for can create it right here instead
// of bouncing to the Clients page and back.
function NewClientForm({ onCreated, onCancel }) {
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
      const client = await api.createClient({ client_name: name.trim(), notes: notes.trim() || null });
      onCreated(client);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card add-client-card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <h2>New Client</h2>
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

export default function Import() {
  const isAdmin = useIsAdmin();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [masterTrainings, setMasterTrainings] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [addingClient, setAddingClient] = useState(false);

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
    api.listMasterTrainings(true).then(setMasterTrainings).catch(() => {});
  }, []);

  const upload = async () => {
    if (!clientId || !file) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const p = await api.previewImport(clientId, file);
      setPreview(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshBatch = async () => {
    const b = await api.getImportBatch(preview.batch_id);
    setPreview({ ...preview, column_map: b.column_map, needs_review_count: b.column_map.filter((c) => c.resolution_status === 'needs_review').length });
  };

  const resolveColumn = async (mapId, trainingId, ignore) => {
    await api.resolveImportColumn(preview.batch_id, mapId, ignore ? { ignore: true } : { training_id: trainingId });
    refreshBatch();
  };

  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.commitImport(preview.batch_id);
      setResult(r);
      setPreview(null);
      setFile(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await api.cancelImport(preview.batch_id);
    setPreview(null);
    setFile(null);
  };

  return (
    <div>
      <h1>Import Client Training Data</h1>
      <p className="page-subtitle">
        Upload a client spreadsheet (CSV). Columns are auto-matched to the Master Training Catalog where possible;
        anything ambiguous is queued below for you to resolve manually before anything is saved. Nothing is ever guessed silently.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {!isAdmin && (
        <div className="card">
          <p className="page-subtitle" style={{ margin: 0 }}>
            Your account has view-only access. Ask an admin to import client rosters.
          </p>
        </div>
      )}

      {isAdmin && !preview && addingClient && (
        <NewClientForm
          onCreated={(client) => {
            setClients((prev) => [...prev, client]);
            setClientId(client.client_id);
            setAddingClient(false);
          }}
          onCancel={() => setAddingClient(false)}
        />
      )}

      {isAdmin && !preview && !addingClient && (
        <div className="card">
          <div className="toolbar">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select client...</option>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
            <button type="button" className="secondary" onClick={() => setAddingClient(true)}>+ New Client</button>
            <label className="file-picker-button">
              Choose File
              <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
            </label>
            {file && <span className="file-picker-name">{file.name}</span>}
            <button disabled={!clientId || !file || busy} onClick={upload}>{busy ? 'Uploading...' : 'Preview Import'}</button>
          </div>
          {clients.length === 0 && (
            <p className="page-subtitle">No clients yet — use "+ New Client" above to add one.</p>
          )}
          <p className="page-subtitle">CSV should have one row per employee. Include columns like Employee Phone Number, Full Name, Job Title, Department, plus one column per training.</p>
        </div>
      )}

      {result && (
        <div className="card">
          <h2>Import Complete</h2>
          <p>Created {result.employees_created} new employee(s) and {result.records_created} training record(s).</p>
        </div>
      )}

      {preview && (
        <div className="card">
          <h2>Review: {preview.client.client_name}</h2>
          <p className="page-subtitle">{preview.row_count} rows detected. Identity columns: {Object.entries(preview.identity_columns_detected).map(([k, v]) => `${k}=${v}`).join(', ') || 'none detected'}</p>

          <table>
            <thead>
              <tr>
                <th>Source Column</th>
                <th>Matched Training</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Resolve</th>
              </tr>
            </thead>
            <tbody>
              {preview.column_map.map((col) => (
                <tr key={col.map_id}>
                  <td>{col.source_column_header}</td>
                  <td>{col.matched_training_id || '—'}</td>
                  <td>{col.match_confidence}</td>
                  <td>{col.resolution_status}</td>
                  <td>
                    {col.resolution_status !== 'auto_matched' && col.resolution_status !== 'resolved' ? (
                      <>
                        <select onChange={(e) => e.target.value && resolveColumn(col.map_id, e.target.value, false)} defaultValue="">
                          <option value="" disabled>Assign training...</option>
                          {masterTrainings.map((mt) => (
                            <option key={mt.training_id} value={mt.training_id}>{mt.training_id} - {mt.training_name}</option>
                          ))}
                        </select>
                        {' '}
                        <button className="secondary" onClick={() => resolveColumn(col.map_id, null, true)}>Ignore column</button>
                      </>
                    ) : (
                      <em>—</em>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <button disabled={preview.needs_review_count > 0 || busy} onClick={commit}>
              {busy ? 'Committing...' : `Commit Import${preview.needs_review_count > 0 ? ` (${preview.needs_review_count} column(s) need review)` : ''}`}
            </button>{' '}
            <button className="secondary" onClick={cancel}>Cancel Import</button>
          </div>
        </div>
      )}
    </div>
  );
}
