import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status === 'open' ? 'Open' : 'Closed'}</span>;
}

export default function Sessions() {
  const isAdmin = useIsAdmin();
  const [searchParams] = useSearchParams();
  const clientIdFilter = searchParams.get('client_id') || '';
  const [sessions, setSessions] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [clients, setClients] = useState([]);
  const [trainers, setTrainers] = useState([]);
  // 'select' shows a dropdown of existing clients/trainers; 'new' swaps in a plain text field
  // for a name that isn't in the system yet (Keeley's request) - the session-creation API
  // already resolves/creates a client or trainer by name on its own, so typing a new one here
  // needs no separate create step.
  const [clientMode, setClientMode] = useState('select');
  const [trainerMode, setTrainerMode] = useState('select');
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

  const [form, setForm] = useState({
    client_name: '',
    master_training_id: '',
    trainer_name: '',
    trainer_phone: '',
    session_date: new Date().toISOString().slice(0, 10),
    location: '',
    duration: '',
    outline: '',
    language: 'english',
  });
  const [creating, setCreating] = useState(false);

  const load = () => {
    api
      .listTrainingSessions({ ...filters, client_id: clientIdFilter })
      .then(setSessions)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    api.listMasterTrainings(true).then(setTrainings).catch(() => {});
    api.listClients().then(setClients).catch(() => {});
    api.listTrainers().then(setTrainers).catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the primitive filter values matter, not object identity
  useEffect(load, [filters.client_name, filters.status, clientIdFilter]);

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
    const training = trainings.find((t) => t.training_id === form.master_training_id);
    const training_type_label = `${training.training_id} - ${training.training_name}`;
    setCreating(true);
    try {
      const session = await api.createTrainingSession({
        client_name: form.client_name,
        master_training_id: form.master_training_id,
        training_type_label,
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
      <h1 className="page-title">Training Sessions</h1>
      <p className="page-subtitle">
        Create a sign-in sheet, generate its QR code, and track rosters as they come in — closing a session writes
        each attendee straight into their employee file.
      </p>

      {error && <p className="error-banner">{error}</p>}

      {isAdmin && (
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
                  <select
                    value={form.master_training_id}
                    onChange={(e) => {
                      const t = trainings.find((x) => x.training_id === e.target.value);
                      // Duration always resets to the newly picked type's own default (Keeley's
                      // call) - unlike outline, it does NOT carry a previous type's override
                      // forward, so switching types re-collapses the field back to plain text
                      // and requires clicking "Override default duration" again on purpose.
                      setDurationOverride(false);
                      setForm((f) => ({
                        ...f,
                        master_training_id: e.target.value,
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
                    required
                  >
                    <option value="">Select a training…</option>
                    {trainings.map((t) => (
                      <option key={t.training_id} value={t.training_id}>
                        {t.training_id} - {t.training_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Trainer</label>
                  {trainerMode === 'select' ? (
                    <select
                      value={selectedTrainerId}
                      onChange={(e) => {
                        if (e.target.value === '__new__') {
                          setTrainerMode('new');
                          setSelectedTrainerId('');
                          setForm({ ...form, trainer_name: '', trainer_phone: '' });
                        } else {
                          const t = trainers.find((x) => x.employee_id === e.target.value);
                          setSelectedTrainerId(e.target.value);
                          setForm({ ...form, trainer_name: t?.full_name || '', trainer_phone: t?.employee_number || '' });
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
                      <input
                        value={form.trainer_name}
                        onChange={(e) => setForm({ ...form, trainer_name: e.target.value })}
                        placeholder="Jamie Trainer"
                        required
                        autoFocus
                      />
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
      )}

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
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Training</th>
              <th>Trainer</th>
              <th>Attendees</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
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
                  {!!s.trainer_needs_review && (
                    <span className="badge badge-pendingreview" title="Trainer has no Employee ID on file">Needs Review</span>
                  )}
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
      </div>
    </div>
  );
}
