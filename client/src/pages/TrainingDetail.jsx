import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

// Editable training outline (Keeley's request, 2026-08-19): a free-text description of what
// the training actually covers, editable right from this page via a small "Edit outline"
// link next to the category/type/expiration subtitle line. Reuses the existing
// api.updateMasterTraining() endpoint (PUT /api/master-trainings/:id) - admin-gated
// server-side the same way every other master-training edit already is.
function TrainingOutline({ training, isAdmin, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(training.outline || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setText(training.outline || ''); }, [training.outline]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateMasterTraining(training.training_id, { outline: text });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setText(training.outline || '');
    setError('');
  };

  if (editing) {
    return (
      <div className="card outline-card">
        <textarea
          rows={5}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe what this training covers..."
        />
        {error && <div className="error-banner">{error}</div>}
        <div style={{ marginTop: 8 }}>
          <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save Outline'}</button>{' '}
          <button type="button" className="secondary" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card outline-card">
      <p className="outline-text">{training.outline || 'No outline yet.'}</p>
      {isAdmin && <button type="button" className="link-button" onClick={() => setEditing(true)}>Edit outline</button>}
    </div>
  );
}

export default function TrainingDetail() {
  const { trainingId } = useParams();
  const isAdmin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const clientId = searchParams.get('client_id') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
  }, []);

  const load = () => api.getTrainingDetail(trainingId, clientId || undefined).then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    setError('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingId, clientId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  const { training, expired } = data;

  return (
    <div>
      <h1>{training.training_id} — {training.training_name}</h1>
      <p className="page-subtitle">
        {training.category} · {training.training_type} · Default Expiration: {training.default_expiration} · {training.active ? 'Active' : 'Inactive'}
      </p>

      <TrainingOutline training={training} isAdmin={isAdmin} onSaved={load} />

      <div className="toolbar">
        <select value={clientId} onChange={(e) => setSearchParams(e.target.value ? { client_id: e.target.value } : {}, { replace: true })}>
          <option value="">All Clients</option>
          {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
        </select>
      </div>

      {/* Current/Completed-No-Expiration/Pending Review/Missing sections removed 2026-08-19
          per Keeley's explicit request - Expired is the only status list shown here now. */}
      <div className="card">
        <h2>Expired ({expired.length})</h2>
        <EmployeeList rows={expired} />
      </div>
    </div>
  );
}

function EmployeeList({ rows }) {
  if (!rows.length) return <div className="empty-state">None</div>;
  return (
    <table>
      <thead><tr><th>Employee</th><th>Completed</th><th>Expiration Date</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employee_id}>
            <td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td>
            <td>{r.completion_date || '—'}</td>
            <td>{r.expiration_date || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
