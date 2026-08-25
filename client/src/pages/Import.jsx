import { useEffect, useState } from 'react';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

const CONFIDENCE_LABELS = {
  exact_alias: 'Exact match',
  fuzzy: 'Fuzzy match',
  manual: 'Manual',
  unmatched: 'No match',
};

// One raw "Client" value from the sheet that didn't exactly match an existing client - pick
// an existing one, or create a new client from the raw name as typed. Every row that used
// this exact raw name resolves together, since it's almost always the same client typed once
// and pasted down a column.
function ClientResolveRow({ entry, clients, onResolved }) {
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resolve = async () => {
    if (!choice) return;
    setSaving(true);
    setError('');
    try {
      if (choice === '__create_new__') {
        await api.resolveImportClient(entry.batchId, { client_name_raw: entry.client_name_raw, create_new: true });
      } else {
        await api.resolveImportClient(entry.batchId, { client_name_raw: entry.client_name_raw, client_id: choice });
      }
      onResolved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>"{entry.client_name_raw}"</td>
      <td>{entry.row_count}</td>
      <td>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Select...</option>
          <option value="__create_new__">+ Create new client "{entry.client_name_raw}"</option>
          {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
        </select>{' '}
        <button className="secondary" disabled={!choice || saving} onClick={resolve}>{saving ? 'Saving...' : 'Resolve'}</button>
        {error && <div className="error-banner" style={{ marginTop: 4 }}>{error}</div>}
      </td>
    </tr>
  );
}

export default function Import() {
  const isAdmin = useIsAdmin();
  const [clients, setClients] = useState([]);
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
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const p = await api.previewImport(file);
      setPreview(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshBatch = async () => {
    const b = await api.getImportBatch(preview.batch_id);
    setPreview({
      ...preview,
      column_map: b.column_map,
      needs_review_count: b.column_map.filter((c) => c.resolution_status === 'needs_review').length,
      clients_needing_review: b.clients_needing_review,
    });
    // A client just got resolved - refresh the client list too so it shows up as a pick option
    // for any other still-unresolved raw name, and in the "+ Create new" case going forward.
    api.listClients().then(setClients).catch(() => {});
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

  const clientsNeedingReview = preview?.clients_needing_review || [];
  const canCommit = preview && preview.needs_review_count === 0 && clientsNeedingReview.length === 0;

  return (
    <div>
      <h1>Import Client Training Data</h1>
      <p className="page-subtitle">
        Upload a spreadsheet (CSV). Each row names its own client, so one file can cover several clients at once -
        columns are auto-matched to the Master Training Catalog and clients are auto-matched by name where possible;
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

      {isAdmin && !preview && (
        <div className="card">
          <div className="toolbar">
            <label className="file-picker-button">
              Choose File
              <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
            </label>
            {file && <span className="file-picker-name">{file.name}</span>}
            <button disabled={!file || busy} onClick={upload}>{busy ? 'Uploading...' : 'Preview Import'}</button>
          </div>
          <p className="page-subtitle">
            CSV should have one row per employee, with columns "Client", "Employee First Name", "Employee Last Name",
            "Trainer", then one column per training (put that training's completion date in the cell). {' '}
            <a href={api.importTemplateUrl}>Download a blank template</a> to start from.
          </p>
        </div>
      )}

      {result && (
        <div className="card">
          <h2>Import Complete</h2>
          <p>
            Created {result.employees_created} new employee(s) and {result.records_created} training record(s).
            {result.rows_skipped_no_client > 0 && ` ${result.rows_skipped_no_client} row(s) were skipped for having no client.`}
          </p>
        </div>
      )}

      {preview && (
        <div className="card">
          <h2>Review Import</h2>
          <p className="page-subtitle">{preview.row_count} rows detected. Identity columns: {Object.entries(preview.identity_columns_detected).map(([k, v]) => `${k}=${v}`).join(', ') || 'none detected'}</p>

          {clientsNeedingReview.length > 0 && (
            <>
              <h3 style={{ fontSize: 14 }}>Clients Needing Review ({clientsNeedingReview.length})</h3>
              <table>
                <thead><tr><th>Client (as typed in the sheet)</th><th>Rows</th><th>Resolve</th></tr></thead>
                <tbody>
                  {clientsNeedingReview.map((entry) => (
                    <ClientResolveRow
                      key={entry.client_name_raw}
                      entry={{ ...entry, batchId: preview.batch_id }}
                      clients={clients}
                      onResolved={refreshBatch}
                    />
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 style={{ fontSize: 14 }}>Training Columns</h3>
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
                  <td>
                    {CONFIDENCE_LABELS[col.match_confidence] || col.match_confidence}
                    {col.match_confidence === 'fuzzy' && (
                      <span style={{ color: 'var(--status-expiringsoon-text, #a15c00)', marginLeft: 4 }}>(double-check)</span>
                    )}
                  </td>
                  <td>{col.resolution_status}</td>
                  <td>
                    {/* Exact catalog-name/alias matches and already human-confirmed rows stay
                        locked - anything looser (fuzzy/ID match, or genuinely unmatched) always
                        gets a correction control, even once auto-matched, since a fuzzy guess
                        can be wrong and there'd otherwise be no way to fix it before committing. */}
                    {col.resolution_status !== 'resolved' && col.match_confidence !== 'exact_alias' ? (
                      <>
                        <select
                          onChange={(e) => e.target.value && resolveColumn(col.map_id, e.target.value, false)}
                          defaultValue={col.matched_training_id || ''}
                        >
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
            <button disabled={!canCommit || busy} onClick={commit}>
              {busy
                ? 'Committing...'
                : `Commit Import${!canCommit ? ` (${preview.needs_review_count} column(s), ${clientsNeedingReview.length} client(s) need review)` : ''}`}
            </button>{' '}
            <button className="secondary" onClick={cancel}>Cancel Import</button>
          </div>
        </div>
      )}
    </div>
  );
}
