import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { displayFirstLast } from '../lib/names.js';
import { TrainingSearchSelect, TrainingMultiSearchSelect } from '../components/TrainingSearchSelect.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { useSortableRows } from '../lib/useSortableRows';
import { easternToday, sequentialDates } from '../lib/dates';

const SESSION_SORT_ACCESSORS = {
  session_date: (s) => s.session_date || '',
  client_name: (s) => (s.client_name || '').toLowerCase(),
  training_type_label: (s) => (s.training_type_label || '').toLowerCase(),
  trainer_name: (s) => (s.trainer_signed_name || s.trainer_name || '').toLowerCase(),
  attendee_count: (s) => s.attendee_count || 0,
  status: (s) => (s.status || '').toLowerCase(),
  fulfillment: (s) => (s.sent_to_client ? 2 : 0) + (s.saved_to_server ? 1 : 0),
};

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status === 'open' ? 'Open' : 'Closed'}</span>;
}

// Whether this session's roster/certs were sent to the client and/or saved to the server
// (Keeley's request, 2026-09-21) - two independent checkboxes on the session's own page,
// summarized here as a single badge so the list stays scannable.
function FulfillmentBadge({ sentToClient, savedToServer }) {
  if (sentToClient && savedToServer) return <span className="badge badge-current">Sent & Saved</span>;
  if (sentToClient) return <span className="badge badge-noexpiration">Sent to Client</span>;
  if (savedToServer) return <span className="badge badge-pendingreview">Saved to Server</span>;
  return <span className="page-subtitle" style={{ margin: 0 }}>—</span>;
}

export default function Sessions() {
  const [searchParams] = useSearchParams();
  const clientIdFilter = searchParams.get('client_id') || '';
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const { sortedRows: sortedSessions, toggleSort, sortIndicator } = useSortableRows(sessions, SESSION_SORT_ACCESSORS, 'session_date', 'desc');
  const [trainings, setTrainings] = useState([]);
  const [clients, setClients] = useState([]);
  const [trainers, setTrainers] = useState([]);
  // 'select' shows a dropdown of existing clients/trainers; 'new' swaps in a plain text field
  // for a name that isn't in the system yet (Keeley's request) - the session-creation API
  // already resolves/creates a client or trainer by name on its own, so typing a new one here
  // needs no separate create step.
  const [clientMode, setClientMode] = useState('select');
  const [trainerMode, setTrainerMode] = useState('select');
  const [newTrainerFirst, setNewTrainerFirst] = useState('');
  const [newTrainerLast, setNewTrainerLast] = useState('');
  const [selectedTrainerId, setSelectedTrainerId] = useState('');
  const [outlineTouched, setOutlineTouched] = useState(false);
  // Whether the duration box is currently revealed for editing (Keeley's call, 2026-08-25):
  // unlike outlineTouched, this deliberately resets to false every time the Training Type
  // changes, so a fresh selection always starts from that type's own default and has to be
  // overridden again on purpose - it never carries a previous type's override forward.
  const [durationOverride, setDurationOverride] = useState(false);
  const [filters, setFilters] = useState({ client_name: '', status: '' });
  // Auto-opens the create form when linked here from the Dashboard's "Create New Training
  // Session" button (?new=1).
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Extra trainings taught in the same session (Keeley's request, 2026-09-17: e.g. Fall
  // Protection + CPR done together) - one sign-in code, one roster, but a separate certificate
  // per attendee per training. Kept out of `form` since it's a list of ids, not a form field the
  // submit-validation loop needs to touch.
  const [additionalTrainingIds, setAdditionalTrainingIds] = useState([]);

  const [form, setForm] = useState({
    client_name: '',
    master_training_id: '',
    trainer_name: '',
    trainer_phone: '',
    session_date: easternToday(),
    location: '',
    duration: '',
    outline: '',
    language: 'english',
    total_days: '',
  });
  // Multi-day training (Keeley's request, 2026-09-21/22) - one session, one QR code, used across
  // every day (e.g. OSHA 30 over 4 days). Kept as its own toggle rather than always showing the
  // day-count field, since the overwhelming majority of sessions are still single-day.
  const [isMultiDay, setIsMultiDay] = useState(false);
  // The actual calendar date scheduled for each day (Keeley's request, 2026-09-22) - purely
  // informational (the real attendance gate is the trainer's manual day-advance button on the
  // session's own page, not these dates), so this is a plain editable array the admin can adjust
  // to skip a weekend/holiday, not something the backend re-derives on its own.
  const [dayDates, setDayDates] = useState([]);
  // Per-day outline text (Keeley's request, 2026-09-22: "Day 1 has its own outline, day 2 and
  // so on") - seeded from the main Outline field's current value each time a new day slot opens
  // up, purely as a convenient starting point; edited independently per day from there.
  const [dayOutlines, setDayOutlines] = useState([]);
  const [creating, setCreating] = useState(false);
  // Upcoming-count badge (Keeley's request, 2026-09-22): open sessions dated today or later,
  // same definition Dashboard.jsx's "Upcoming Trainings Scheduled" box already uses. Fetched on
  // its own rather than derived from `sessions` above, since that list reflects whatever status/
  // client filter is currently applied below and would otherwise go to 0 the moment someone
  // filters to "Closed".
  const [upcomingCount, setUpcomingCount] = useState(null);

  const load = () => {
    setSessionsLoading(true);
    api
      .listTrainingSessions({ ...filters, client_id: clientIdFilter })
      .then(setSessions)
      .catch((err) => setError(err.message))
      .finally(() => setSessionsLoading(false));
  };

  const loadUpcomingCount = () => {
    api.listTrainingSessions({ status: 'open', client_id: clientIdFilter }).then((rows) => {
      const today = easternToday();
      setUpcomingCount(rows.filter((s) => s.session_date >= today).length);
    }).catch(() => {});
  };

  useEffect(() => {
    api.listMasterTrainings(true).then(setTrainings).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
    api.listTrainers().then(setTrainers).catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the primitive filter values matter, not object identity
  useEffect(load, [filters.client_name, filters.status, clientIdFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only clientIdFilter matters here
  useEffect(loadUpcomingCount, [clientIdFilter]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    // Trainer Employee ID is the one field skipped when adding a brand-new trainer inline
    // (Keeley's call) - there's nothing to auto-fill for someone who isn't in the system yet,
    // so that session is flagged for review instead of blocking creation on a field they can't
    // fill in.
    if (
      !form.client_name || !form.master_training_id || !form.trainer_name ||
      !form.session_date || !form.location || !form.duration || !form.outline
    ) {
      setError('Every field is required to create a session.');
      return;
    }
    if (isMultiDay && (!form.total_days || Number(form.total_days) < 2)) {
      setError('Enter a number of days (2 or more) for a multi-day session.');
      return;
    }
    if (isMultiDay && dayDates.some((d) => !d)) {
      setError('Enter a scheduled date for every day.');
      return;
    }
    if (isMultiDay && dayOutlines.some((o) => !o.trim())) {
      setError('Enter an outline for every day.');
      return;
    }
    const training = trainings.find((t) => t.training_id === form.master_training_id);
    const training_type_label = `${training.training_id} - ${training.training_name}`;
    const additional_trainings = additionalTrainingIds.map((tid) => {
      const t = trainings.find((x) => x.training_id === tid);
      return { master_training_id: tid, training_type_label: `${t.training_id} - ${t.training_name}` };
    });
    setCreating(true);
    try {
      const session = await api.createTrainingSession({
        client_name: form.client_name,
        master_training_id: form.master_training_id,
        training_type_label,
        additional_trainings,
        trainer_name: form.trainer_name.trim(),
        // Left blank whenever there's no Employee ID to send - a brand-new trainer typed in on
        // the spot, or an existing trainer who was never given one yet. The server derives the
        // "needs review" flag from that on its own (Keeley's call: either way, review is
        // needed before this is "done"), so nothing extra needs sending here.
        trainer_phone: form.trainer_phone,
        session_date: form.session_date,
        location: form.location,
        duration: form.duration,
        outline: form.outline,
        language: form.language,
        total_days: isMultiDay ? Number(form.total_days) : null,
        day_dates: isMultiDay ? dayDates : null,
        day_outlines: isMultiDay ? dayOutlines : null,
      });
      if (session.translation_warning) {
        window.alert(`Session created, but the Spanish translation couldn't be generated: ${session.translation_warning}\n\nYou can edit the session later to retry.`);
      }
      navigate(`/sessions/${session.session_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">
        Training Sessions
        {upcomingCount !== null && (
          <span className="badge badge-noexpiration" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
            {upcomingCount} Upcoming
          </span>
        )}
      </h1>
      <p className="page-subtitle">
        Create a sign-in sheet, generate its QR code, and track rosters as they come in — closing a session writes
        each attendee straight into their employee file.
      </p>

      {error && <p className="error-banner">{error}</p>}

      <div className="card" style={{ marginBottom: 20 }}>
        {!showForm ? (
            <button className="btn btn-accent" onClick={() => setShowForm(true)}>
              + New Session
            </button>
          ) : (
            <form onSubmit={submit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="field">
                  <label>Client</label>
                  {clientMode === 'select' ? (
                    <select
                      value={form.client_name}
                      onChange={(e) => {
                        if (e.target.value === '__new__') {
                          setClientMode('new');
                          setForm({ ...form, client_name: '' });
                        } else {
                          setForm({ ...form, client_name: e.target.value });
                        }
                      }}
                      required
                    >
                      <option value="">Select a client…</option>
                      {clients.map((c) => <option key={c.client_id} value={c.client_name}>{c.client_name}</option>)}
                      <option value="__new__">+ Add New Client</option>
                    </select>
                  ) : (
                    <>
                      <input
                        value={form.client_name}
                        onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                        placeholder="Resolute Builders"
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => { setClientMode('select'); setForm({ ...form, client_name: '' }); }}
                      >
                        Choose an existing client instead
                      </button>
                    </>
                  )}
                </div>
                <div className="field">
                  <label>Training Type</label>
                  <TrainingSearchSelect
                    trainings={trainings}
                    value={form.master_training_id}
                    onChange={(trainingId) => {
                      const t = trainings.find((x) => x.training_id === trainingId);
                      // Duration always resets to the newly picked type's own default (Keeley's
                      // call) - unlike outline, it does NOT carry a previous type's override
                      // forward, so switching types re-collapses the field back to plain text
                      // and requires clicking "Override default duration" again on purpose.
                      setDurationOverride(false);
                      // Guards against the newly picked primary training staying stuck in the
                      // "Additional Trainings" list too (it's filtered out of that picker's
                      // options, but a stale already-selected value wouldn't otherwise clear).
                      setAdditionalTrainingIds((ids) => ids.filter((id) => id !== trainingId));
                      setForm((f) => ({
                        ...f,
                        master_training_id: trainingId,
                        // Seeds the outline from the catalog's current wording (Keeley's
                        // request) - only while the admin hasn't typed their own yet, so
                        // switching training types before touching that field keeps it in
                        // sync, but never clobbers a manual edit once they've started one.
                        // This is just a starting value for this one session - it's copied
                        // onto the session at creation time, so a later catalog outline edit
                        // never reaches back into sessions already created.
                        outline: outlineTouched ? f.outline : (t?.outline || ''),
                        duration: t?.default_duration || '',
                      }));
                    }}
                  />
                </div>
                <div className="field">
                  <label>Additional Trainings (optional)</label>
                  <TrainingMultiSearchSelect
                    trainings={trainings}
                    value={additionalTrainingIds}
                    onChange={setAdditionalTrainingIds}
                    excludeIds={form.master_training_id ? [form.master_training_id] : []}
                  />
                  <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                    Everyone signs in once, but gets a separate certificate for each training selected here plus the one above.
                  </p>
                </div>
                <div className="field">
                  <label>Trainer</label>
                  {trainerMode === 'select' ? (
                    <select
                      value={selectedTrainerId}
                      onChange={(e) => {
                        if (e.target.value === '__new__') {
                          setTrainerMode('new');
                          setNewTrainerFirst('');
                          setNewTrainerLast('');
                          setSelectedTrainerId('');
                          setForm({ ...form, trainer_name: '', trainer_phone: '' });
                        } else {
                          const t = trainers.find((x) => x.employee_id === e.target.value);
                          setSelectedTrainerId(e.target.value);
                          // "Kasey Hilton", not the list-style "Hilton, Kasey" - this prints on certificates.
                          setForm({ ...form, trainer_name: displayFirstLast(t), trainer_phone: t?.employee_number || '' });
                        }
                      }}
                      required
                    >
                      <option value="">Select a trainer…</option>
                      {trainers.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
                      <option value="__new__">+ Add New Trainer</option>
                    </select>
                  ) : (
                    <>
                      {/* First/last kept separate (Keeley's request, 2026-09-22), combined into
                          trainer_name as "First Last". */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          value={newTrainerFirst}
                          onChange={(e) => { setNewTrainerFirst(e.target.value); setForm({ ...form, trainer_name: `${e.target.value.trim()} ${newTrainerLast.trim()}`.trim() }); }}
                          placeholder="First name"
                          required
                          autoFocus
                        />
                        <input
                          value={newTrainerLast}
                          onChange={(e) => { setNewTrainerLast(e.target.value); setForm({ ...form, trainer_name: `${newTrainerFirst.trim()} ${e.target.value.trim()}`.trim() }); }}
                          placeholder="Last name"
                          required
                        />
                      </div>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => { setTrainerMode('select'); setSelectedTrainerId(''); setForm({ ...form, trainer_name: '', trainer_phone: '' }); }}
                      >
                        Choose an existing trainer instead
                      </button>
                    </>
                  )}
                </div>
                <div className="field">
                  <label>Trainer Employee ID</label>
                  {trainerMode === 'select' ? (
                    <>
                      <input value={form.trainer_phone} readOnly disabled placeholder="Auto-filled from the selected trainer" />
                      {selectedTrainerId && !form.trainer_phone && (
                        <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                          This trainer has no Employee ID on file - this session will be flagged for review.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="page-subtitle" style={{ margin: 0 }}>
                      Not required for a newly added trainer - this session will be flagged for review until their Employee ID is added.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={form.session_date}
                    onChange={(e) => setForm({ ...form, session_date: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Location / Address</label>
                  <input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="123 Main St, Suite 4"
                    required
                  />
                </div>
                <div className="field">
                  <label>Duration</label>
                  {(() => {
                    const selectedTraining = trainings.find((t) => t.training_id === form.master_training_id);
                    if (selectedTraining?.default_duration && !durationOverride) {
                      return (
                        <>
                          <p style={{ margin: '4px 0' }}>{form.duration}</p>
                          <button type="button" className="link-button" onClick={() => setDurationOverride(true)}>
                            Override default duration
                          </button>
                        </>
                      );
                    }
                    return (
                      <input
                        value={form.duration}
                        onChange={(e) => setForm({ ...form, duration: e.target.value })}
                        placeholder="e.g. 4 hours, Half day"
                        required
                      />
                    );
                  })()}
                </div>
                <div className="field">
                  <label>Sign-In Language</label>
                  <select
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    required
                  >
                    <option value="english">English</option>
                    <option value="spanish">Spanish</option>
                    <option value="both">Both (English/Spanish)</option>
                  </select>
                  {form.language !== 'english' && (
                    <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                      The training name and outline you type below are auto-translated to Spanish when you save.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={isMultiDay}
                      onChange={(e) => {
                        setIsMultiDay(e.target.checked);
                        if (!e.target.checked) { setForm((f) => ({ ...f, total_days: '' })); setDayDates([]); setDayOutlines([]); }
                      }}
                    />
                    Multi-day training (one QR code, used every day)
                  </label>
                  {isMultiDay && (
                    <>
                      <input
                        type="number"
                        min={2}
                        value={form.total_days}
                        onChange={(e) => {
                          const count = Math.max(0, parseInt(e.target.value, 10) || 0);
                          setForm({ ...form, total_days: e.target.value });
                          setDayDates((prev) => (
                            count <= prev.length
                              ? prev.slice(0, count)
                              : [...prev, ...sequentialDates(form.session_date, count).slice(prev.length, count)]
                          ));
                          setDayOutlines((prev) => (
                            count <= prev.length
                              ? prev.slice(0, count)
                              : [...prev, ...Array.from({ length: count - prev.length }, () => form.outline)]
                          ));
                        }}
                        placeholder="Number of days (e.g. 4)"
                        style={{ marginTop: 8, maxWidth: 160 }}
                        required
                      />
                      <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                        Attendees must sign in every day for it to count. Advance the day and track attendance from the session's own page after it's created.
                      </p>
                      {dayDates.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                          {dayDates.map((d, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', width: 44 }}>
                                Day {i + 1}
                              </label>
                              <input
                                type="date"
                                value={d}
                                onChange={(e) => setDayDates((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                                style={{ maxWidth: 160 }}
                                required
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {dayOutlines.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                            Outline per Day
                          </label>
                          {dayOutlines.map((o, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 44, marginTop: 8 }}>
                                Day {i + 1}
                              </span>
                              <textarea
                                rows={2}
                                value={o}
                                onChange={(e) => setDayOutlines((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                                style={{ flexGrow: 1 }}
                                required
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="field">
                <label>Outline / Topics Covered</label>
                <textarea
                  rows={3}
                  value={form.outline}
                  onChange={(e) => { setOutlineTouched(true); setForm({ ...form, outline: e.target.value }); }}
                  placeholder="What will this session cover?"
                  required
                />
                <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                  Auto-filled from the training's catalog outline when you pick a Training Type above - edit freely, it only affects this session.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-accent" type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create Session & Generate QR Code'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <input
          placeholder="Filter by client…"
          value={filters.client_name}
          onChange={(e) => setFilters({ ...filters, client_name: e.target.value })}
          style={{ maxWidth: 260 }}
        />
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          style={{ maxWidth: 160 }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="card">
        {sessionsLoading ? <LoadingState label="Loading sessions..." /> : (
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('session_date')}>Date{sortIndicator('session_date')}</th>
              <th className="sortable" onClick={() => toggleSort('client_name')}>Client{sortIndicator('client_name')}</th>
              <th className="sortable" onClick={() => toggleSort('training_type_label')}>Training{sortIndicator('training_type_label')}</th>
              <th className="sortable" onClick={() => toggleSort('trainer_name')}>Trainer{sortIndicator('trainer_name')}</th>
              <th className="sortable" onClick={() => toggleSort('attendee_count')}>Attendees{sortIndicator('attendee_count')}</th>
              <th className="sortable" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
              <th className="sortable" onClick={() => toggleSort('fulfillment')}>Fulfillment{sortIndicator('fulfillment')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedSessions.map((s) => (
              <tr key={s.session_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/sessions/${s.session_id}`)}>
                <td>{s.session_date}</td>
                <td>{s.client_name}</td>
                <td>{s.training_type_label}</td>
                <td>{s.trainer_signed_name || s.trainer_name}</td>
                <td>{s.attendee_count}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>
                  <FulfillmentBadge sentToClient={s.sent_to_client} savedToServer={s.saved_to_server} />
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}
