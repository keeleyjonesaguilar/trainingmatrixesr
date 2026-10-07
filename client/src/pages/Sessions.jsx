import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { displayFirstLast } from '../lib/names.js';
import { TrainingSearchSelect, TrainingMultiSearchSelect } from '../components/TrainingSearchSelect.jsx';
import LoadingState from '../components/LoadingState.jsx';
import CoTrainersPicker from '../components/CoTrainersPicker.jsx';
import { useSortableRows } from '../lib/useSortableRows';
import { easternToday, sequentialDates } from '../lib/dates';
import { totalDuration } from '../lib/durations';

const SESSION_SORT_ACCESSORS = {
  session_date: (s) => s.session_date || '',
  client_name: (s) => (s.client_name || '').toLowerCase(),
  training_type_label: (s) => (s.multi_training_day ? 'multi training day' : s.training_type_label || '').toLowerCase(),
  trainer_name: (s) => (s.trainer_names || s.trainer_signed_name || s.trainer_name || '').toLowerCase(),
  attendee_count: (s) => s.attendee_count || 0,
  status: (s) => (s.status || '').toLowerCase(),
  prep: (s) => (s.status === 'closed'
    ? 10 + (s.sent_to_client ? 2 : 0) + (s.saved_to_server ? 1 : 0)
    : { info_needed: 1, ready_to_send: 2, sent: 3 }[s.prep_status] || 0),
};

// The Training column (Keeley's request, 2026-10-05): a Multi Training Day says so, with its
// trainings listed underneath; an older session covering 2+ trainings lists the extras. One
// session with 2+ trainings stacks them as bullets that wrap (Keeley, 2026-10-06) - on one line
// they stretched the whole table.
const TRAINING_LIST = { margin: '2px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'normal', minWidth: 220 };
function TrainingCell({ session: s }) {
  const extras = s.additional_training_labels || [];
  if (!extras.length) return s.training_type_label;
  return (
    <>
      {s.multi_training_day ? <strong>Multi Training Day</strong> : <span>{1 + extras.length} trainings</span>}
      <ul style={TRAINING_LIST}>
        {[s.training_type_label, ...extras].map((label, i) => <li key={i}>{label}</li>)}
      </ul>
    </>
  );
}

// One trainer per line, for the same reason.
function TrainerCell({ session: s }) {
  const names = s.trainer_name_list || [s.trainer_signed_name || s.trainer_name, s.co_trainer_names].filter(Boolean);
  return names.map((name, i) => <div key={i}>{name}</div>);
}

const EMPTY_LIST_FILTERS = { training_id: '', trainer_id: '', date_from: '', date_to: '' };

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status === 'open' ? 'Open' : 'Closed'}</span>;
}

// Whether this session's roster/certs were sent to the client and/or saved to the server
// (Keeley's request, 2026-09-21) - two independent checkboxes on the session's own page,
// summarized here as a single badge so the list stays scannable.
// Session prep (Keeley's request, 2026-10-07) - replaces the Fulfillment column for upcoming
// sessions: where the class details stand. Closed sessions still show what was sent/saved.
const PREP_BADGES = {
  info_needed: ['badge-expiringsoon', 'Additional info needed'],
  ready_to_send: ['badge-pendingreview', 'Ready to send'],
  sent: ['badge-current', 'Sent to trainer'],
};
function PrepStatusBadge({ session: s }) {
  if (s.status === 'closed') return <FulfillmentBadge sentToClient={s.sent_to_client} savedToServer={s.saved_to_server} />;
  const badge = PREP_BADGES[s.prep_status];
  return badge ? <span className={`badge ${badge[0]}`}>{badge[1]}</span> : <span className="page-subtitle" style={{ margin: 0 }}>—</span>;
}

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
  // Training / trainer / date filters (Keeley's request, 2026-10-05) - applied here to the loaded
  // list; client and status still go to the server like before.
  const [listFilters, setListFilters] = useState(EMPTY_LIST_FILTERS);
  const filteredSessions = useMemo(() => sessions.filter((s) => (
    (!listFilters.training_id || (s.training_ids || [s.master_training_id]).includes(listFilters.training_id))
    && (!listFilters.trainer_id || (s.trainer_ids || [s.trainer_employee_id]).includes(listFilters.trainer_id))
    && (!listFilters.date_from || s.session_date >= listFilters.date_from)
    && (!listFilters.date_to || s.session_date <= listFilters.date_to)
  )), [sessions, listFilters]);
  const { sortedRows: sortedSessions, toggleSort, sortIndicator } = useSortableRows(filteredSessions, SESSION_SORT_ACCESSORS, 'session_date', 'desc');
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
  // Other trainers teaching alongside the lead (Keeley's request, 2026-10-01).
  const [coTrainerIds, setCoTrainerIds] = useState([]);
  const [outlineTouched, setOutlineTouched] = useState(false);
  // Whether the duration box is currently revealed for editing (Keeley's call, 2026-08-25):
  // unlike outlineTouched, this deliberately resets to false every time the Training Type
  // changes, so a fresh selection always starts from that type's own default and has to be
  // overridden again on purpose - it never carries a previous type's override forward.
  const [durationOverride, setDurationOverride] = useState(false);
  // Client is picked from a list (Keeley's report, 2026-09-30: the free-text filter missed on
  // capitalization/spelling); a ?client_id= link from a client's page pre-selects it.
  // Opens on Open sessions (Keeley, 2026-10-06: the closed ones make the list overwhelming) -
  // "All statuses" or "Closed" is one pick away, and Reset Filters comes back here.
  const [filters, setFilters] = useState({ client_id: clientIdFilter, status: 'open' });
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
  // 2+ trainings make a Multi Training Day (Keeley's request, 2026-10-05): each training has its
  // own duration (seeded from its catalog default) and its own check-in. training_id -> duration.
  const [additionalDurations, setAdditionalDurations] = useState({});
  const isMultiTraining = additionalTrainingIds.length > 0;

  // Separate check-in for each training is optional (Keeley's request, 2026-10-06: "sometimes they
  // aren't necessary") - starts unticked (one sign-in covers every training); ticking it makes a
  // Multi Training Day.
  const [separateCheckins, setSeparateCheckins] = useState(false);
  // 'training' or 'toolbox_talk' (Keeley's request, 2026-09-30) - a toolbox talk has a Topic
  // instead of a catalog training, no certificates, and is never multi-day.
  const [sessionKind, setSessionKind] = useState('training');
  const [toolboxTopic, setToolboxTopic] = useState('');
  const isToolbox = sessionKind === 'toolbox_talk';

  const [form, setForm] = useState({
    client_name: '',
    master_training_id: '',
    trainer_name: '',
    trainer_phone: '',
    session_date: easternToday(),
    location: '',
    // The class files for the trainer - required for a training session (Keeley's request, 2026-10-07).
    wetransfer_link: '',
    duration: '',
    outline: '',
    language: 'english',
    total_days: '',
  });
  // The session total: every training's duration added up (Keeley's report, 2026-10-07 - 1 hour +
  // 1 hour shows 2 hours, whatever the catalog default says).
  const sessionTotal = totalDuration([form.duration, ...additionalTrainingIds.map((tid) => additionalDurations[tid])]);
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
  // Who teaches each day (Keeley's request, 2026-09-29) - a trainer's employee_id, or '' for the
  // session's main trainer, so a one-trainer course needs nothing extra here.
  const [dayTrainers, setDayTrainers] = useState([]);
  // The WeTransfer link is required when any trainer on it is Internal (Keeley's call, 2026-10-07):
  // the lead (a newly typed name is a new Internal trainer), a co-trainer, or a day's trainer.
  const isInternalId = (id) => trainers.find((t) => t.employee_id === id)?.trainer_type_effective !== 'external';
  const needsWetransfer = !isToolbox && (
    (trainerMode === 'new' && Boolean(form.trainer_name.trim()))
    || (Boolean(selectedTrainerId) && isInternalId(selectedTrainerId))
    || coTrainerIds.some(isInternalId)
    || (isMultiDay && dayTrainers.filter(Boolean).some(isInternalId))
  );
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
      .listTrainingSessions({ status: filters.status, client_id: filters.client_id })
      .then(setSessions)
      .catch((err) => setError(err.message))
      .finally(() => setSessionsLoading(false));
  };

  const loadUpcomingCount = () => {
    api.listTrainingSessions({ status: 'open', client_id: filters.client_id }).then((rows) => {
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
  useEffect(load, [filters.client_id, filters.status]);
  // Following a link from a client's page while this page is already open.
  useEffect(() => { setFilters((f) => ({ ...f, client_id: clientIdFilter })); }, [clientIdFilter]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the client filter matters here
  useEffect(loadUpcomingCount, [filters.client_id]);

  const submitToolbox = async () => {
    if (!form.client_name || !form.trainer_name || !form.session_date || !form.location || !toolboxTopic.trim()) {
      setError('Client, topic, trainer, date, and location are required for a toolbox talk.');
      return;
    }
    setCreating(true);
    try {
      const session = await api.createTrainingSession({
        session_kind: 'toolbox_talk',
        toolbox_topic: toolboxTopic.trim(),
        client_name: form.client_name,
        trainer_name: form.trainer_name.trim(),
        trainer_phone: form.trainer_phone,
        co_trainer_ids: coTrainerIds,
        session_date: form.session_date,
        location: form.location,
        duration: form.duration,
        outline: form.outline,
        language: form.language,
      });
      if (session.translation_warning) {
        window.alert(`Toolbox talk created, but the Spanish translation couldn't be generated: ${session.translation_warning}`);
      }
      navigate(`/sessions/${session.session_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (isToolbox) {
      await submitToolbox();
      return;
    }
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
    if (needsWetransfer && !form.wetransfer_link.trim()) {
      setError('A WeTransfer link is required when an internal trainer is assigned.');
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
    if (isMultiTraining && additionalTrainingIds.some((tid) => !String(additionalDurations[tid] || '').trim())) {
      setError('Enter a duration for every training.');
      return;
    }
    const training = trainings.find((t) => t.training_id === form.master_training_id);
    const training_type_label = `${training.training_id} - ${training.training_name}`;
    const additional_trainings = additionalTrainingIds.map((tid) => {
      const t = trainings.find((x) => x.training_id === tid);
      return { master_training_id: tid, training_type_label: `${t.training_id} - ${t.training_name}`, duration: String(additionalDurations[tid] || '').trim() };
    });
    setCreating(true);
    try {
      const session = await api.createTrainingSession({
        client_name: form.client_name,
        master_training_id: form.master_training_id,
        training_type_label,
        additional_trainings,
        separate_checkins: separateCheckins,
        wetransfer_link: form.wetransfer_link.trim(),
        trainer_name: form.trainer_name.trim(),
        // Left blank whenever there's no Employee ID to send - a brand-new trainer typed in on
        // the spot, or an existing trainer who was never given one yet. The server derives the
        // "needs review" flag from that on its own (Keeley's call: either way, review is
        // needed before this is "done"), so nothing extra needs sending here.
        trainer_phone: form.trainer_phone,
        co_trainer_ids: coTrainerIds,
        session_date: form.session_date,
        location: form.location,
        // 2+ trainings: each has its own duration and the session's is their total (2026-10-07).
        duration: isMultiTraining ? sessionTotal : form.duration,
        first_training_duration: isMultiTraining ? form.duration : undefined,
        outline: form.outline,
        language: form.language,
        total_days: isMultiDay ? Number(form.total_days) : null,
        day_dates: isMultiDay ? dayDates : null,
        day_outlines: isMultiDay ? dayOutlines : null,
        day_trainers: isMultiDay ? dayTrainers : null,
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
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-accent" onClick={() => { setSessionKind('training'); setShowForm(true); }}>
                + New Session
              </button>
              <button className="btn btn-secondary" onClick={() => { setSessionKind('toolbox_talk'); setIsMultiDay(false); setShowForm(true); }}>
                + New Toolbox Talk
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h2 style={{ marginTop: 0 }}>{isToolbox ? 'New Toolbox Talk' : 'New Training Session'}</h2>
              {isToolbox && (
                <p className="page-subtitle" style={{ marginTop: -6 }}>
                  Same QR sign-in and trainer close-out as a training session. No certificates - each attendee gets a
                  Toolbox Talk entry with the topic on their profile, and the signed roster is emailed.
                </p>
              )}
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
                {isToolbox ? (
                  <div className="field">
                    <label>Topic</label>
                    <input value={toolboxTopic} onChange={(e) => setToolboxTopic(e.target.value)} placeholder="e.g. Ladder Safety, Heat Stress" required />
                  </div>
                ) : (
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
                )}
                {!isToolbox && !isMultiDay && (
                <div className="field">
                  <label>Additional Trainings (optional)</label>
                  <TrainingMultiSearchSelect
                    trainings={trainings}
                    value={additionalTrainingIds}
                    onChange={(ids) => {
                      setAdditionalTrainingIds(ids);
                      setAdditionalDurations((prev) => Object.fromEntries(ids.map((tid) => [
                        tid, prev[tid] ?? (trainings.find((x) => x.training_id === tid)?.default_duration || ''),
                      ])));
                    }}
                    excludeIds={form.master_training_id ? [form.master_training_id] : []}
                  />
                  <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                    Everyone gets a separate certificate for each training. Below, choose whether they also check in separately
                    for each one.
                  </p>
                </div>
                )}
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
                  <label>Other trainers</label>
                  <CoTrainersPicker trainers={trainers} value={coTrainerIds} onChange={setCoTrainerIds} leadId={selectedTrainerId} />
                  {coTrainerIds.length > 0 && (
                    <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                      Every trainer&apos;s name goes on the certificates, any of them can close out, and trainees rate each one.
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
                {!isToolbox && (
                  <div className="field">
                    <label>WeTransfer Link{needsWetransfer ? '' : ' (optional)'}</label>
                    <input
                      type="text"
                      value={form.wetransfer_link}
                      onChange={(e) => setForm({ ...form, wetransfer_link: e.target.value })}
                      placeholder="https://we.tl/..."
                      required={needsWetransfer}
                    />
                    {needsWetransfer && (
                      <p className="page-subtitle" style={{ margin: '4px 0 0' }}>Required - an internal trainer is assigned.</p>
                    )}
                  </div>
                )}
                {/* With 2+ trainings each one's duration is entered in the trainings list below (the
                    first training's is this same value) - a separate box up here read like the whole
                    day's length and got applied to the first training (Keeley's report, 2026-10-07). */}
                {!(isMultiTraining && !isToolbox) && (
                <div className="field">
                  <label>Duration</label>
                  {(() => {
                    const selectedTraining = trainings.find((t) => t.training_id === form.master_training_id);
                    if (isToolbox) {
                      return (
                        <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="15 minutes (default)" />
                      );
                    }
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
                )}
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
                {!isToolbox && isMultiTraining && (
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>{separateCheckins ? 'Multi Training Day' : 'Trainings'}: in order - enter each training&apos;s own duration (not the whole day)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[form.master_training_id, ...additionalTrainingIds].map((tid, i) => {
                      const t = trainings.find((x) => x.training_id === tid);
                      return (
                        <div key={tid || 'first'} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, minWidth: 260 }}>
                            <strong>{i + 1}.</strong> {t ? `${t.training_id} - ${t.training_name}` : 'Pick the Training Type above'}
                          </span>
                          <input
                            value={i === 0 ? form.duration : additionalDurations[tid] || ''}
                            onChange={(e) => (i === 0
                              ? setForm({ ...form, duration: e.target.value })
                              : setAdditionalDurations((prev) => ({ ...prev, [tid]: e.target.value })))}
                            placeholder="Duration, e.g. 2 hours"
                            aria-label={`Duration for training ${i + 1}`}
                            style={{ maxWidth: 200 }}
                            required
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 14 }}>
                    <strong>Total duration:</strong> {sessionTotal || '—'}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, marginTop: 10 }}>
                    <input type="checkbox" checked={separateCheckins} onChange={(e) => setSeparateCheckins(e.target.checked)} />
                    Check in separately for each training (scan the QR code again at the start of each one)
                  </label>
                  <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                    {separateCheckins
                      ? <>Check-in opens for training 1. When it&apos;s over, the trainer taps &quot;Start next training&quot; on the sign-in page (trainer PIN), or you can open it from the session page. Attendees only get certificates for the trainings they check in for.</>
                      : 'One sign-in covers every training - everyone who signs in gets a certificate for each one.'}
                  </p>
                </div>
                )}
                {!isToolbox && !isMultiTraining && (
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={isMultiDay}
                      onChange={(e) => {
                        setIsMultiDay(e.target.checked);
                        if (!e.target.checked) { setForm((f) => ({ ...f, total_days: '' })); setDayDates([]); setDayOutlines([]); setDayTrainers([]); }
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
                          setDayTrainers((prev) => (
                            count <= prev.length ? prev.slice(0, count) : [...prev, ...Array.from({ length: count - prev.length }, () => '')]
                          ));
                        }}
                        placeholder="Number of days (e.g. 4)"
                        style={{ marginTop: 8, maxWidth: 160 }}
                        required
                      />
                      <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                        Attendees must sign in every day for it to count. Pick who teaches each day below - each day's trainer signs off their own day from the sign-in page, which opens the next day. Certificates are created when the final day is closed out.
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
                              <select
                                value={dayTrainers[i] || ''}
                                onChange={(e) => setDayTrainers((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                                aria-label={`Day ${i + 1} trainer`}
                                style={{ maxWidth: 240 }}
                              >
                                <option value="">{form.trainer_name ? `Main trainer (${form.trainer_name})` : 'Main trainer'}</option>
                                {trainers.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
                              </select>
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
                )}
              </div>
              <div className="field">
                <label>{isToolbox ? 'Talking Points (optional)' : 'Outline / Topics Covered'}</label>
                <textarea
                  rows={3}
                  value={form.outline}
                  onChange={(e) => { setOutlineTouched(true); setForm({ ...form, outline: e.target.value }); }}
                  placeholder={isToolbox ? 'Key points to cover (shown on the sign-in page)' : 'What will this session cover?'}
                  required={!isToolbox}
                />
                {!isToolbox && (
                  <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
                    Auto-filled from the training's catalog outline when you pick a Training Type above - edit freely, it only affects this session.
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-accent" type="submit" disabled={creating}>
                  {creating ? 'Creating…' : isToolbox ? 'Create Toolbox Talk & Generate QR Code' : 'Create Session & Generate QR Code'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
      </div>

      {/* Same labeled filter bar as the Matrix page (Keeley's report, 2026-10-05: the first version
          of these filters looked off next to the rest of the app). */}
      <div className="filter-bar" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="field-row">
          <label htmlFor="sessions-filter-client">Client</label>
          <select id="sessions-filter-client" value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sessions-filter-training">Training Type</label>
          <select id="sessions-filter-training" value={listFilters.training_id} onChange={(e) => setListFilters({ ...listFilters, training_id: e.target.value })}>
            <option value="">All training types</option>
            {trainings.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sessions-filter-trainer">Trainer</label>
          <select id="sessions-filter-trainer" value={listFilters.trainer_id} onChange={(e) => setListFilters({ ...listFilters, trainer_id: e.target.value })}>
            <option value="">All trainers</option>
            {trainers.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sessions-filter-from">From</label>
          <input id="sessions-filter-from" type="date" value={listFilters.date_from} onChange={(e) => setListFilters({ ...listFilters, date_from: e.target.value })} />
        </div>
        <div className="field-row">
          <label htmlFor="sessions-filter-to">To</label>
          <input id="sessions-filter-to" type="date" value={listFilters.date_to} onChange={(e) => setListFilters({ ...listFilters, date_to: e.target.value })} />
        </div>
        <div className="field-row">
          <label htmlFor="sessions-filter-status">Status</label>
          <select id="sessions-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => { setFilters({ client_id: '', status: 'open' }); setListFilters(EMPTY_LIST_FILTERS); }}
        >
          Reset Filters
        </button>
      </div>
      {!sessionsLoading && (filters.client_id || filters.status !== 'open' || Object.values(listFilters).some(Boolean)) && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          {filteredSessions.length} session{filteredSessions.length === 1 ? '' : 's'} match these filters.
        </p>
      )}

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
              <th className="sortable" onClick={() => toggleSort('prep')}>Prep Status{sortIndicator('prep')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedSessions.map((s) => (
              <tr key={s.session_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/sessions/${s.session_id}`)}>
                <td>{s.session_date}</td>
                <td>{s.client_name}</td>
                <td><TrainingCell session={s} /></td>
                <td><TrainerCell session={s} /></td>
                <td>{s.attendee_count}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>
                  <PrepStatusBadge session={s} />
                </td>
              </tr>
            ))}
            {filteredSessions.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  {sessions.length ? 'No sessions match these filters.' : 'No sessions yet.'}
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
