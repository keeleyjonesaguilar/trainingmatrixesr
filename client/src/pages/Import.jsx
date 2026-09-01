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

  // Commit can be called more than once for the same batch: whatever's resolved right now goes
  // in immediately, and anything still needing review is left for a later commit once it's
  // resolved below - so the review screen stays open after a partial commit instead of closing.
  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.commitImport(preview.batch_id);
      setResult(r);
      if (r.status === 'committed') {
        setPreview(null);
        setFile(null);
      } else {
        await refreshBatch();
      }
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
  // Committing no longer requires every training/client to be resolved first - whatever's
  // resolved goes in now, and rows using anything still unresolved are skipped and picked up
  // by a later commit once resolved (see the server's partial-commit comment for why).
  const canCommit = Boolean(preview) && !busy;
  const fullyResolved = preview && preview.needs_review_count === 0 && clientsNeedingReview.length === 0;

  return (
    <div>
      <h1>Import Client Training Data</h1>
      <p className="page-subtitle">
        Upload a spreadsheet (CSV). Each row names its own client, so one file can cover several clients at once -
        training names and clients are auto-matched where possible; anything ambiguous is queued below for you to
        resolve manually before anything is saved. Nothing is ever guessed silently.
      </p>
      <p className="page-subtitle">
        Two shapes are supported, auto-detected from the header row: one row per <strong>employee</strong> (a
        "Client"/"Employee Name" set of columns, then one column per training holding that training's completion
        date), or one row per <strong>training completion</strong> ("Client", "Employee Full Name", "Name" for the
        training, "Activation"/"Expiration" dates) - the shape a certification tracker or another system's export
        typically comes out in. A long-format row's own Expiration date is kept exactly as given, not recomputed
        from the Master Catalog.
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
            One row per employee (see below) or one row per training completion - the format is auto-detected. {' '}
            <a href={api.importTemplateUrl}>Download a blank one-row-per-employee template</a> to start from.
          </p>
        </div>
      )}

      {result && (
        <div className="card">
          <h2>{result.status === 'committed' ? 'Import Complete' : 'Partial Import Committed'}</h2>
          <p>
            Created {result.employees_created} new employee(s) and {result.records_created} training record(s) this round.
            {result.rows_skipped_no_client > 0 && ` ${result.rows_skipped_no_client} row(s) skipped for having no client resolved yet.`}
            {result.rows_skipped_no_training_name > 0 && ` ${result.rows_skipped_no_training_name} row(s) skipped for having no training name.`}
          </p>
          {result.status !== 'committed' && (
            <p className="page-subtitle" style={{ margin: 0 }}>
              {result.still_needs_review_count} training name(s) still need review below. Resolve them (and any
              clients still needing review) and click Commit Import again to bring in the rest - nothing already
              imported will be duplicated.
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="card">
          <h2>Review Import</h2>
          <p className="page-subtitle">
            {preview.row_count} rows detected, format: <strong>{preview.format === 'long' ? 'one row per training completion' : 'one row per employee'}</strong>.
            {' '}Identity columns: {Object.entries(preview.identity_columns_detected).map(([k, v]) => `${k}=${v}`).join(', ') || 'none detected'}
          </p>

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

          <h3 style={{ fontSize: 14 }}>{preview.format === 'long' ? 'Training Names' : 'Training Columns'}</h3>
          <table>
            <thead>
              <tr>
                <th>{preview.format === 'long' ? 'Training Name (as in file)' : 'Source Column'}</th>
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
            <button disabled={!canCommit} onClick={commit}>
              {busy ? 'Committing...' : fullyResolved ? 'Commit Import' : 'Commit What’s Resolved'}
            </button>{' '}
            <button className="secondary" onClick={cancel}>Cancel Import</button>
            {!fullyResolved && (
              <p className="page-subtitle" style={{ marginTop: 8 }}>
                {preview.needs_review_count > 0 && `${preview.needs_review_count} training name(s) still need review. `}
                {clientsNeedingReview.length > 0 && `${clientsNeedingReview.length} client name(s) still need review. `}
                Rows using them will be skipped for now and can be brought in with another commit once resolved.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
