import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Import() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [masterTrainings, setMasterTrainings] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

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

      {!preview && (
        <div className="card">
          {clients.length === 0 ? (
            <p className="page-subtitle">
              No clients yet. Add one on the <a href="/clients">Client Settings</a> page first, then come back here to import their data.
            </p>
          ) : (
            <>
              <div className="toolbar">
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Select client...</option>
                  {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
                </select>
                <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
                <button disabled={!clientId || !file || busy} onClick={upload}>{busy ? 'Uploading...' : 'Preview Import'}</button>
              </div>
              <p className="page-subtitle">CSV should have one row per employee. Include columns like Employee Number, Full Name, Job Title, Department, plus one column per training.</p>
            </>
          )}
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
