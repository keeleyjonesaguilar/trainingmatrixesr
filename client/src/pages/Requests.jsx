// Requests (Keeley's request, 2026-10-12) - one place to keep the changes and updates people
// would find useful, instead of passing them on verbally. Anyone can add one and see them all; the
// Super Admin sets each one's status and can leave a note back (server/routes/changeRequests.js).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useIsSuperAdmin } from '../authContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { downloadCsv } from '../lib/csv';
import { formatEasternDate, formatEasternDateTime } from '../lib/dates';

const CATEGORIES = { change: 'Change to something', new_feature: 'Something new', problem: "Something's not working", other: 'Other' };
const PRIORITIES = { nice_to_have: 'Nice to have', important: 'Important', urgent: 'Urgent' };
const STATUSES = { new: 'New', planned: 'Planned', in_progress: 'In progress', done: 'Done', not_doing: 'Not doing' };
const STATUS_BADGES = { new: 'badge-pendingreview', planned: 'badge-open', in_progress: 'badge-expiringsoon', done: 'badge-current', not_doing: 'badge-notapplicable' };
const PRIORITY_BADGES = { nice_to_have: 'badge-noexpiration', important: 'badge-expiringsoon', urgent: 'badge-expired' };
const AREAS = ['Dashboard', 'Employees', 'Employee profiles', 'Clients', 'Trainers', 'Training Sessions', 'Training Types', 'Reports', 'Import Data',
  'Sign-in page (QR code)', 'Trainer close-out', 'Feedback form', 'Training Portal', 'Emails', 'Certificates / rosters', 'Other'];
const OPEN = ['new', 'planned', 'in_progress'];
const EMPTY = { title: '', details: '', category: 'change', area: '', priority: 'nice_to_have' };

function RequestForm({ initial = EMPTY, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && <div className="error-banner">{error}</div>}
      <div className="field-row">
        <label>What would help?</label>
        <input type="text" autoFocus maxLength={200} placeholder="e.g. Show the trainer's phone number on the session page" value={form.title} onChange={set('title')} required />
      </div>
      <div className="field-row">
        <label>Details (optional)</label>
        <textarea rows={4} maxLength={5000} placeholder="What you're trying to do, what happens now, an example (a client, employee or session)…" value={form.details || ''} onChange={set('details')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="field-row">
          <label>Type</label>
          <select value={form.category} onChange={set('category')}>
            {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Where in the app</label>
          <select value={form.area || ''} onChange={set('area')}>
            <option value="">Not sure / anywhere</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>How important</label>
          <select value={form.priority} onChange={set('priority')}>
            {Object.entries(PRIORITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <button type="submit" disabled={saving || !form.title.trim()}>{saving ? 'Saving…' : submitLabel}</button>{' '}
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// The Super Admin's status + note, saved together.
function StatusEditor({ request, onSaved }) {
  const [status, setStatus] = useState(request.status);
  const [note, setNote] = useState(request.status_note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = status !== request.status || note.trim() !== (request.status_note || '');

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      onSaved(await api.setChangeRequestStatus(request.request_id, { status, status_note: note }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 12, paddingTop: 12 }}>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <textarea
          rows={2}
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Note back to them (optional) - e.g. what changed, or why not"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" disabled={saving || !changed} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="page-subtitle" style={{ margin: '6px 0 0', fontSize: 12 }}>They get a bell notification when you change the status or the note.</p>
    </div>
  );
}

export default function Requests() {
  const isSuperAdmin = useIsSuperAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState('open');
  const [mineOnly, setMineOnly] = useState(false);
  const [openId, setOpenId] = useState(searchParams.get('open'));
  const [editingId, setEditingId] = useState(null);

  const load = () => api.listChangeRequests().then(setRequests).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // A bell notification links here with ?open=<id> - show that one, whatever its status.
  useEffect(() => {
    const fromLink = searchParams.get('open');
    if (!fromLink) return;
    setOpenId(fromLink);
    const target = requests?.find((r) => r.request_id === fromLink);
    if (target && !OPEN.includes(target.status)) setView('all');
  }, [searchParams, requests]);

  const isMine = (r) => Boolean(r.mine);
  const counts = useMemo(() => {
    const list = requests || [];
    return {
      open: list.filter((r) => OPEN.includes(r.status)).length,
      done: list.filter((r) => r.status === 'done').length,
      not_doing: list.filter((r) => r.status === 'not_doing').length,
      all: list.length,
    };
  }, [requests]);

  const visible = useMemo(() => (requests || [])
    .filter((r) => view === 'all' || (view === 'open' ? OPEN.includes(r.status) : r.status === view))
    .filter((r) => !mineOnly || isMine(r)),
  [requests, view, mineOnly]);

  const replace = (updated) => setRequests((list) => list.map((r) => (r.request_id === updated.request_id ? updated : r)));

  const toggle = (id) => {
    setOpenId((cur) => (cur === id ? null : id));
    setEditingId(null);
    if (searchParams.get('open')) setSearchParams({}, { replace: true });
  };

  const withdraw = async (r) => {
    if (!window.confirm(`Remove "${r.title}"?`)) return;
    try {
      await api.deleteChangeRequest(r.request_id);
      setRequests((list) => list.filter((x) => x.request_id !== r.request_id));
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCsv = () => downloadCsv(`Requests ${new Date().toISOString().slice(0, 10)}.csv`, visible.map((r) => ({
    Request: r.title,
    Details: r.details || '',
    Type: CATEGORIES[r.category] || r.category,
    'Where in the app': r.area || '',
    'How important': PRIORITIES[r.priority] || r.priority,
    Status: STATUSES[r.status] || r.status,
    'Status note': r.status_note || '',
    'Asked by': r.submitted_by_name,
    Asked: formatEasternDate(r.created_at),
    'Status changed': r.status_changed_at ? formatEasternDate(r.status_changed_at) : '',
  })));

  const tile = (key, label) => (
    <div className={`stat-tile clickable${view === key ? ' selected' : ''}`} onClick={() => setView(key)}>
      <div className="stat-label">{label}</div>
      <div className="value">{counts[key]}</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <p className="page-subtitle">Changes or updates that would make this app more useful to you. Add them here instead of passing them on - nothing gets lost, and you can see where each one stands.</p>
        </div>
        {!adding && (
          <div className="page-header-actions">
            <button type="button" className="secondary" disabled={!visible.length} onClick={exportCsv}>Export CSV</button>
            <button type="button" onClick={() => setAdding(true)}>+ New Request</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {adding && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New Request</h2>
          <RequestForm
            submitLabel="Add Request"
            onCancel={() => setAdding(false)}
            onSubmit={async (form) => {
              const created = await api.createChangeRequest(form);
              setRequests((list) => [created, ...(list || [])]);
              setAdding(false);
              setView('open');
            }}
          />
        </div>
      )}

      <div className="stat-grid">
        {tile('open', 'Open')}
        {tile('done', 'Done')}
        {tile('not_doing', 'Not Doing')}
        {tile('all', 'All')}
      </div>

      <div className="card">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 13 }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Only my requests
        </label>
        {!requests ? <LoadingState label="Loading requests..." /> : visible.length === 0 ? (
          <p className="empty-state">{requests.length ? 'Nothing here.' : 'No requests yet - add the first one with "+ New Request".'}</p>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 'none' }}>
            <table>
              <thead>
                <tr><th>Request</th><th>Type</th><th>Where</th><th>How important</th><th>Asked by</th><th>Asked</th><th>Status</th></tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const expanded = openId === r.request_id;
                  const canEdit = isSuperAdmin || (isMine(r) && r.status === 'new');
                  return (
                    <Fragment key={r.request_id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggle(r.request_id)}>
                        <td style={{ whiteSpace: 'normal', fontWeight: 600 }}>{r.title}</td>
                        <td>{CATEGORIES[r.category]}</td>
                        <td>{r.area || '—'}</td>
                        <td><span className={`badge ${PRIORITY_BADGES[r.priority]}`}>{PRIORITIES[r.priority]}</span></td>
                        <td>{r.submitted_by_name}</td>
                        <td>{formatEasternDate(r.created_at)}</td>
                        <td><span className={`badge ${STATUS_BADGES[r.status]}`}>{STATUSES[r.status]}</span></td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={7} style={{ whiteSpace: 'normal', background: 'var(--color-bg)' }}>
                            {editingId === r.request_id ? (
                              <RequestForm
                                initial={r}
                                submitLabel="Save Changes"
                                onCancel={() => setEditingId(null)}
                                onSubmit={async (form) => { replace(await api.updateChangeRequest(r.request_id, form)); setEditingId(null); }}
                              />
                            ) : (
                              <>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{r.details || <span className="page-subtitle">No details given.</span>}</div>
                                <p className="page-subtitle" style={{ margin: '8px 0 0', fontSize: 12 }}>
                                  Asked by {r.submitted_by_name} on {formatEasternDateTime(r.created_at)}
                                </p>
                                {r.status_note && (
                                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-surface)', borderLeft: '3px solid var(--esr-green)' }}>
                                    <strong style={{ fontSize: 12 }}>Note{r.status_changed_by ? ` from ${r.status_changed_by}` : ''}:</strong>
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{r.status_note}</div>
                                  </div>
                                )}
                                {canEdit && (
                                  <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                                    <button type="button" className="link-button" onClick={() => setEditingId(r.request_id)}>Edit</button>
                                    <button type="button" className="link-button" onClick={() => withdraw(r)}>{isMine(r) ? 'Withdraw' : 'Delete'}</button>
                                  </div>
                                )}
                                {isSuperAdmin && <StatusEditor key={`${r.request_id}:${r.updated_at}`} request={r} onSaved={replace} />}
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
