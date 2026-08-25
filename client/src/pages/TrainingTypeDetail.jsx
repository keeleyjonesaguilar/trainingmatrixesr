import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];
const TYPE_OPTIONS = ['Training', 'Fit Test', 'Certification', 'License', 'Orientation'];
const SESSIONS_PER_PAGE = 5;

// Settings panel (moved from the old Master Trainings page's inline row-editor): the same
// Name/Category/Type/Default Expiration/Active fields, just living on the training's own page.
function SettingsPanel({ training, isAdmin, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(training);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setForm(training), [training]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateMasterTraining(training.training_id, form);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteTraining = async () => {
    if (!window.confirm(`Permanently delete ${training.training_id} — ${training.training_name}? This cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteMasterTraining(training.training_id);
      onDeleted();
    } catch (e) {
      setDeleteError(e.message);
      setDeleting(false);
    }
  };

  if (!editing) {
    return (
      <div className="card">
        <h2>Settings</h2>
        {deleteError && <div className="error-banner">{deleteError}</div>}
        <p className="page-subtitle" style={{ margin: 0 }}>
          {training.category} · {training.training_type} · Default Expiration: {training.default_expiration}
          {training.default_duration ? ` · Default Duration: ${training.default_duration}` : ''} · {training.active ? 'Active' : 'Inactive'}
        </p>
        {isAdmin && <button type="button" className="link-button" onClick={() => setEditing(true)}>Edit Settings</button>}
        {isAdmin && (
          <>
            {' · '}
            <button type="button" className="link-button" style={{ color: 'var(--status-expired-text)' }} disabled={deleting} onClick={deleteTraining}>
              {deleting ? 'Deleting...' : 'Delete Training'}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Settings</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="toolbar">
        <div className="field-row">
          <label>Training Name</label>
          <input type="text" value={form.training_name} onChange={(e) => setForm({ ...form, training_name: e.target.value })} />
        </div>
        <div className="field-row">
          <label>Category</label>
          <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </div>
        <div className="field-row">
          <label>Training Type</label>
          <select value={form.training_type} onChange={(e) => setForm({ ...form, training_type: e.target.value })}>
            {TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Default Expiration</label>
          <select value={form.default_expiration} onChange={(e) => setForm({ ...form, default_expiration: e.target.value })}>
            {EXPIRATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Default Duration</label>
          <input
            type="text"
            placeholder="e.g. 4 hours, Half day"
            value={form.default_duration || ''}
            onChange={(e) => setForm({ ...form, default_duration: e.target.value })}
          />
        </div>
        <div className="field-row">
          <label>Active</label>
          <select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>
      </div>
      <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>{' '}
      <button type="button" className="secondary" onClick={() => { setEditing(false); setForm(training); }}>Cancel</button>
    </div>
  );
}

// Editable training outline (moved verbatim from the old Training Detail page).
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
        <textarea rows={5} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe what this training covers..." />
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

// "Everyone with this training" (Keeley's request): replaces the old Expired-only view with
// everyone who has any real status for it - Current, Expired, No Expiration, Pending Review.
function EveryoneList({ rows }) {
  if (!rows.length) return <div className="empty-state">No one has this training on file yet.</div>;
  return (
    <table>
      <thead><tr><th>Employee</th><th>Status</th><th>Completed</th><th>Expiration Date</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employee_id}>
            <td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td>
            <td><StatusBadge status={r.status} /></td>
            <td>{r.completion_date || '—'}</td>
            <td>{r.expiration_date || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SessionList({ title, sessions, showRosterLinks, emptyText }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  const pageRows = sessions.slice(page * SESSIONS_PER_PAGE, page * SESSIONS_PER_PAGE + SESSIONS_PER_PAGE);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: 14 }}>{title} ({sessions.length})</h3>
      {pageRows.length === 0 && <div className="empty-state">{emptyText}</div>}
      {pageRows.map((s) => (
        <div key={s.session_id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--color-border)' }}>
          <Link to={`/sessions/${s.session_id}`}>{s.session_date}</Link>
          <div className="page-subtitle" style={{ margin: '2px 0 0' }}>{s.client_name} · {s.trainer_signed_name || s.trainer_name}</div>
          {showRosterLinks && (
            <div style={{ fontSize: 12, marginTop: 2 }}>
              <a href={`/api/training-sessions/${s.session_id}/roster.pdf`}>PDF</a> ·{' '}
              <a href={`/api/training-sessions/${s.session_id}/roster.csv`}>CSV</a>
            </div>
          )}
        </div>
      ))}
      {sessions.length > SESSIONS_PER_PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span className="page-subtitle" style={{ margin: 0, alignSelf: 'center' }}>Page {page + 1} of {totalPages}</span>
          <button type="button" className="secondary" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

export default function TrainingTypeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionClientFilter, setSessionClientFilter] = useState('');
  const [error, setError] = useState('');
  const clientId = searchParams.get('client_id') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
  }, []);

  const load = () => api.getTrainingDetail(id, clientId || undefined).then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    setError('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, clientId]);

  useEffect(() => {
    api.getSessionsByTraining(id, { client_name: sessionClientFilter }).then(setSessions).catch(() => {});
  }, [id, sessionClientFilter]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  const { training } = data;
  const everyone = [
    ...data.current.map((r) => ({ ...r, status: 'Current' })),
    ...data.expired.map((r) => ({ ...r, status: 'Expired' })),
    ...data.noExpiration.map((r) => ({ ...r, status: 'No Expiration' })),
    ...data.pendingReview.map((r) => ({ ...r, status: 'Pending Review' })),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name));

  const upcoming = sessions.filter((s) => s.status !== 'closed');
  const past = sessions.filter((s) => s.status === 'closed');

  return (
    <div>
      <Link to="/training-types" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>← All Training Types</Link>
      <h1 style={{ marginTop: 8 }}>{training.training_id} — {training.training_name}</h1>

      <div className="layout-2col">
        <div>
          <SettingsPanel training={training} isAdmin={isAdmin} onSaved={load} onDeleted={() => navigate('/training-types')} />
          <TrainingOutline training={training} isAdmin={isAdmin} onSaved={load} />

          <div className="card">
            <div className="toolbar">
              <h2 style={{ margin: 0 }}>Everyone with this training ({everyone.length})</h2>
            </div>
            <select
              value={clientId}
              onChange={(e) => setSearchParams(e.target.value ? { client_id: e.target.value } : {}, { replace: true })}
              style={{ marginBottom: 12 }}
            >
              <option value="">All Clients</option>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
            <EveryoneList rows={everyone} />
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <input
              placeholder="Filter sessions by client…"
              value={sessionClientFilter}
              onChange={(e) => setSessionClientFilter(e.target.value)}
            />
          </div>
          <SessionList title="Upcoming Sessions" sessions={upcoming} showRosterLinks={false} emptyText="No upcoming sessions scheduled." />
          <SessionList title="Past Sessions" sessions={past} showRosterLinks emptyText="No completed sessions yet." />
        </div>
      </div>
    </div>
  );
}
