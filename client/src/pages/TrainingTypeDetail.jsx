import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import LiveSearchInput from '../components/LiveSearchInput.jsx';
import { useIsAdmin } from '../authContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { useSortableRows } from '../lib/useSortableRows';
import { courseDays, resizeDays } from '../lib/courseDays';
import { courseDayDecks } from '../lib/courseDecks';

// The PowerPoints picked for one day of a multi-day course, in the order they're taught: add from
// the Content page's decks, move up/down, remove (2026-11-06).
function DayDeckPicker({ decks, value, onChange, label }) {
  const name = (id) => decks.find((d) => d.deck_id === id)?.name || 'Deleted PowerPoint';
  const move = (from, to) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  const left = decks.filter((d) => !value.includes(d.deck_id));
  return (
    <div className="day-deck-picker">
      {value.map((id, i) => (
        <div key={id} className="day-deck-row">
          <span className="day-deck-num">{i + 1}.</span>
          <span className="day-deck-name">{name(id)}</span>
          <button type="button" className="link-button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${name(id)} up`}>▲</button>
          <button type="button" className="link-button" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} aria-label={`Move ${name(id)} down`}>▼</button>
          <button type="button" className="link-button" style={{ color: 'var(--status-expired-text)' }} onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Remove ${name(id)}`}>Remove</button>
        </div>
      ))}
      <select value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }} aria-label={label} style={{ maxWidth: 420 }}>
        <option value="">{value.length ? '+ Add another PowerPoint…' : '+ Add a PowerPoint…'}</option>
        {left.map((d) => <option key={d.deck_id} value={d.deck_id}>{d.name}</option>)}
      </select>
    </div>
  );
}

// The training type's PowerPoint, from the Content page (Keeley's "Training matrix features 11.6",
// 2026-11-06) - what its trainers download, with the class's QR slides added.
function PowerpointPanel({ training, isAdmin, onSaved }) {
  const [decks, setDecks] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deckId, setDeckId] = useState(training.deck_id || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.listDecks().then(setDecks).catch((e) => setError(e.message)); }, [training.deck_id]);
  useEffect(() => setDeckId(training.deck_id || ''), [training.deck_id]);

  const deck = decks?.find((d) => d.deck_id === training.deck_id);
  // A multi-day course has no main PowerPoint - each day's are picked in Multi-Day Course below
  // (Keeley, 2026-11-06). One set before then still shows here so it can be removed.
  const multiDay = Boolean(courseDays(training));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateMasterTraining(training.training_id, { deck_id: deckId || null });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (multiDay && !training.deck_id) {
    return (
      <div className="card">
        <h2>PowerPoint</h2>
        <p className="page-subtitle" style={{ margin: 0 }}>
          This is a multi-day course, so it doesn&apos;t need a main PowerPoint. Each day&apos;s PowerPoints are picked
          in <strong>Multi-Day Course</strong> below, next to that day&apos;s outline.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>PowerPoint</h2>
      {error && <div className="error-banner">{error}</div>}
      {editing ? (
        <>
          <div className="field-row" style={{ maxWidth: 420 }}>
            <label>PowerPoint for this training</label>
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              <option value="">None</option>
              {(decks || []).map((d) => <option key={d.deck_id} value={d.deck_id}>{d.name}</option>)}
            </select>
          </div>
          <p className="page-subtitle" style={{ margin: '4px 0 8px' }}>Not in the list? Upload it on the <Link to="/content">Content</Link> page first.</p>
          <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>{' '}
          <button type="button" className="secondary" onClick={() => { setEditing(false); setDeckId(training.deck_id || ''); }}>Cancel</button>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 4px' }}>
            {deck ? (
              <>
                <Link to={`/content/${deck.deck_id}`}><strong>{deck.name}</strong></Link> · {deck.slide_count} slides
                {deck.flagged_count > 0 && <> · <span className="badge badge-expiringsoon">⚑ {deck.flagged_count} need update</span></>}
                {deck.file_missing && <> · <span className="badge badge-expired">File missing</span></>}
              </>
            ) : decks ? (
              <span style={{ color: 'var(--color-text-muted)' }}>No PowerPoint set - trainers for this class won&apos;t get one.</span>
            ) : 'Loading…'}
          </p>
          <p className="page-subtitle" style={{ margin: 0 }}>
            {multiDay
              ? "This is a multi-day course - each day's PowerPoints are picked in Multi-Day Course below. This one is only used for a day with none picked; you can remove it."
              : "Trainers download it from their class summary email and Training Portal, with the class's Sign-In QR slide first and Feedback QR slide last."}
          </p>
          {isAdmin && !multiDay && <button type="button" className="link-button" onClick={() => setEditing(true)}>{deck ? 'Change PowerPoint' : 'Choose PowerPoint'}</button>}
          {isAdmin && multiDay && (
            <button
              type="button"
              className="link-button"
              onClick={async () => {
                try { await api.updateMasterTraining(training.training_id, { deck_id: null }); onSaved(); } catch (e) { setError(e.message); }
              }}
            >Remove main PowerPoint</button>
          )}
        </>
      )}
    </div>
  );
}

const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '4 Years', '5 Years'];
const TYPE_OPTIONS = ['Training', 'Certification', 'License', 'Orientation'];
const SESSIONS_PER_PAGE = 5;

// Settings panel (moved from the old Master Trainings page's inline row-editor): the same
// Name/Type/Default Expiration/Active fields, just living on the training's own page.
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
          {training.training_type} · Default Expiration: {training.default_expiration}
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

// A multi-day course (Keeley's request, 2026-10-14: OSHA 10 is 2 days, OSHA 30 is 4) - picking this
// training on the New Session form turns on multi-day with this many days and fills in each day's
// outline from here.
function CourseDaysPanel({ training, isAdmin, onSaved }) {
  const saved = courseDays(training);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(saved ? String(saved.days) : '');
  const [outlines, setOutlines] = useState(saved ? saved.outlines : []);
  // Each day's PowerPoints (2026-11-06), picked from the Content page - what that day's trainer
  // downloads, in this order.
  const [dayDecks, setDayDecks] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [decks, setDecks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listMasterTrainings().then(setTrainings).catch(() => {});
    api.listDecks().then(setDecks).catch(() => {});
  }, []);
  const deckById = (id) => decks.find((d) => d.deck_id === id);

  const reset = () => {
    const current = courseDays(training);
    setDays(current ? String(current.days) : '');
    setOutlines(current ? current.outlines : []);
    setDayDecks(current ? courseDayDecks(training, current.days, trainings) : []);
    setError('');
  };
  useEffect(reset, [training, trainings]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const count = Number(days) || null;
      await api.updateMasterTraining(training.training_id, { default_total_days: count, default_day_outlines: count ? outlines : null, default_day_decks: count ? dayDecks : null });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="card">
        <h2>Multi-Day Course</h2>
        {saved ? (
          <>
            <p className="page-subtitle" style={{ margin: '0 0 8px' }}>
              {saved.days} days - picking this training on a new session sets up {saved.days} days, each with its own date, trainer and this outline. Each day&apos;s trainer gets that day&apos;s PowerPoints.
            </p>
            {saved.outlines.map((o, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>Day {i + 1}</strong>
                <div className="day-decks-view">
                  <span className="day-decks-label">PowerPoint{dayDecks[i]?.length > 1 ? 's' : ''}:</span>
                  {dayDecks[i]?.length ? (
                    <ol>
                      {dayDecks[i].map((id) => {
                        const deck = deckById(id);
                        return (
                          <li key={id}>
                            {deck ? <Link to={`/content/${id}`}>{deck.name}</Link> : <span style={{ color: 'var(--color-text-muted)' }}>Loading…</span>}
                            {deck && <span style={{ color: 'var(--color-text-muted)' }}> · {deck.slide_count} slides</span>}
                            {deck?.flagged_count > 0 && <> · <span className="badge badge-expiringsoon">⚑ {deck.flagged_count} need update</span></>}
                            {deck?.file_missing && <> · <span className="badge badge-expired">File missing</span></>}
                          </li>
                        );
                      })}
                    </ol>
                  ) : training.deck_id
                    ? <span style={{ color: 'var(--color-text-muted)' }}> none picked - the main PowerPoint is used</span>
                    : <span style={{ color: 'var(--status-expired-text)' }}> none picked yet - this day&apos;s trainer won&apos;t get one</span>}
                </div>
                <p className="outline-text" style={{ margin: '2px 0 0', whiteSpace: 'pre-line' }}>{o || 'No outline yet.'}</p>
              </div>
            ))}
          </>
        ) : (
          <p className="page-subtitle" style={{ margin: 0 }}>One-day training.</p>
        )}
        {isAdmin && <button type="button" className="link-button" onClick={() => setEditing(true)}>{saved ? 'Edit days' : 'Make it a multi-day course'}</button>}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Multi-Day Course</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="field-row" style={{ maxWidth: 220 }}>
        <label>Number of days</label>
        <input
          type="number"
          min={2}
          max={10}
          value={days}
          placeholder="Blank = one-day"
          onChange={(e) => {
            setDays(e.target.value);
            setOutlines((prev) => resizeDays(prev, Math.min(10, Math.max(0, parseInt(e.target.value, 10) || 0))));
            setDayDecks((prev) => resizeDays(prev, Math.min(10, Math.max(0, parseInt(e.target.value, 10) || 0)), () => []));
          }}
        />
      </div>
      {outlines.map((o, i) => (
        <div key={i} style={{ marginTop: 14 }}>
          <div className="field">
            <label>Day {i + 1} PowerPoints</label>
            <DayDeckPicker
              decks={decks}
              value={dayDecks[i] || []}
              onChange={(ids) => setDayDecks((prev) => prev.map((x, xi) => (xi === i ? ids : x)))}
              label={`Add a PowerPoint to Day ${i + 1}`}
            />
          </div>
          <div className="field">
            <label>Day {i + 1} outline</label>
            <textarea rows={5} value={o} onChange={(e) => setOutlines((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))} />
          </div>
        </div>
      ))}
      {outlines.length > 0 && (
        <p className="page-subtitle" style={{ margin: '8px 0 0' }}>
          Put each day&apos;s PowerPoints in the order they&apos;re taught. That day&apos;s trainer gets each one as its own download; the
          class&apos;s Sign-In QR slide goes at the start of the day&apos;s first PowerPoint, and the Feedback QR slide at the end of the
          day&apos;s last one, so attendees rate that day&apos;s trainer. Not in the list? Upload it on the <Link to="/content">Content</Link> page first.
        </p>
      )}
      <div style={{ marginTop: 8 }}>
        <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>{' '}
        <button type="button" className="secondary" onClick={() => { setEditing(false); reset(); }}>Cancel</button>
      </div>
    </div>
  );
}

// "Everyone with this training" (Keeley's request): replaces the old Expired-only view with
// everyone who has any real status for it - Current, Expired, No Expiration, Pending Review.
const EVERYONE_SORT_ACCESSORS = {
  full_name: (r) => (r.full_name || '').toLowerCase(),
  status: (r) => (r.status || '').toLowerCase(),
  completion_date: (r) => r.completion_date || '',
  expiration_date: (r) => r.expiration_date || '',
};

function EveryoneList({ rows }) {
  const { sortedRows, toggleSort, sortIndicator } = useSortableRows(rows, EVERYONE_SORT_ACCESSORS, 'full_name');
  if (!rows.length) return <div className="empty-state">No one has this training on file yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th className="sortable" onClick={() => toggleSort('full_name')}>Employee{sortIndicator('full_name')}</th>
          <th className="sortable" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
          <th className="sortable" onClick={() => toggleSort('completion_date')}>Completed{sortIndicator('completion_date')}</th>
          <th className="sortable" onClick={() => toggleSort('expiration_date')}>Expiration Date{sortIndicator('expiration_date')}</th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((r) => (
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

function SessionList({ title, sessions, showRosterLinks, emptyText, loading }) {
  const [pageWanted, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  // Filtering can shrink the list under the current page - never point past the last one.
  const page = Math.min(pageWanted, totalPages - 1);
  const pageRows = sessions.slice(page * SESSIONS_PER_PAGE, page * SESSIONS_PER_PAGE + SESSIONS_PER_PAGE);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: 14 }}>{title} ({sessions.length})</h3>
      {loading && <LoadingState label="Loading sessions..." />}
      {!loading && pageRows.length === 0 && <div className="empty-state">{emptyText}</div>}
      {pageRows.map((s) => (
        <div key={s.session_id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--color-border)' }}>
          <Link to={`/sessions/${s.session_id}`}>{s.session_date}</Link>
          <div className="page-subtitle" style={{ margin: '2px 0 0' }}>{s.client_name} · {s.trainer_names || s.trainer_signed_name || s.trainer_name}</div>
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
          <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="page-subtitle" style={{ margin: 0, alignSelf: 'center' }}>Page {page + 1} of {totalPages}</span>
          <button type="button" className="secondary" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
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
  const [sessionsLoading, setSessionsLoading] = useState(true);
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
    setSessionsLoading(true);
    api.getSessionsByTraining(id, { client_name: sessionClientFilter }).then(setSessions).catch(() => {}).finally(() => setSessionsLoading(false));
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
          <PowerpointPanel training={training} isAdmin={isAdmin} onSaved={load} />
          <CourseDaysPanel training={training} isAdmin={isAdmin} onSaved={load} />

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
            <LiveSearchInput placeholder="Filter sessions by client…" value={sessionClientFilter} onSearch={(v) => setSessionClientFilter(v.trim())} />
          </div>
          <SessionList title="Upcoming Sessions" sessions={upcoming} showRosterLinks={false} emptyText="No upcoming sessions scheduled." loading={sessionsLoading} />
          <SessionList title="Past Sessions" sessions={past} showRosterLinks emptyText="No completed sessions yet." loading={sessionsLoading} />
        </div>
      </div>
    </div>
  );
}
