import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { parseName } from '../lib/names.js';
import { useIsAdmin } from '../authContext.jsx';
import { formatEasternDateTime, sequentialDates, formatShortDate, easternToday } from '../lib/dates';
import { TrainingSearchSelect } from '../components/TrainingSearchSelect.jsx';
import SignaturePad from '../components/SignaturePad.jsx';
import CoTrainersPicker from '../components/CoTrainersPicker.jsx';
import AttendeeDocumentsUpload from '../components/AttendeeDocumentsUpload.jsx';

const FEEDBACK_LABEL_FIELDS = [
  { key: 'could_ask_questions_label', label: 'Could ask questions (Yes/No)' },
  { key: 'understood_material_label', label: 'Understood material (Yes/No)' },
  { key: 'needs_additional_training_label', label: 'Needs additional training (Yes/No)' },
  { key: 'effectiveness_label', label: 'Training effectiveness (star rating)' },
  { key: 'trainer_rating_label', label: 'Trainer rating (star rating)' },
  { key: 'comment_label', label: 'Trainer comment (free text)' },
];

// Admin-only editor for the question text shown on EVERY session's feedback form (Keeley's
// request) - deliberately not scoped to this one session, since the underlying settings row
// is shared, so the copy here is explicit that a change applies everywhere, not just here.
function FeedbackQuestionsEditor() {
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.getFeedbackSettings().then((s) => { setSettings(s); setForm(s); }).catch((e) => setError(e.message));
  useEffect(() => { if (editing && !settings) load(); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateFeedbackSettings(form);
      setSettings(updated);
      setForm(updated);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <button type="button" className="link-button" onClick={() => setEditing((o) => !o)}>
        {editing ? 'Hide' : 'Edit'} Feedback Questions
      </button>
      {editing && (
        <div style={{ marginTop: 12 }}>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            These questions are shared by every session's feedback form - a change here applies everywhere, not just this session.
          </p>
          {error && <div className="error-banner">{error}</div>}
          {!form ? (
            <div className="empty-state">Loading...</div>
          ) : (
            <>
              <div className="toolbar">
                {FEEDBACK_LABEL_FIELDS.map((f) => (
                  <div className="field-row" key={f.key}>
                    <label>{f.label}</label>
                    <input
                      type="text"
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>{' '}
              <button className="secondary" onClick={() => { setForm(settings); setEditing(false); }}>Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Admin-only editor for the PIN a trainer enters to close out ANY Training Sign-In session
// (Keeley's request, 2026-09-16) - shared across every session, same pattern as
// FeedbackQuestionsEditor above. Defaults to "2026" (set by the 038_trainer_close_pin.sql
// migration) but is editable here in case that ever needs to change.
function TrainerClosePinEditor() {
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(null);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.getTrainerClosePinSettings().then((s) => { setSettings(s); setPin(s.pin); }).catch((e) => setError(e.message));
  useEffect(() => { if (editing && !settings) load(); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateTrainerClosePinSettings({ pin });
      setSettings(updated);
      setPin(updated.pin);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <button type="button" className="link-button" onClick={() => setEditing((o) => !o)}>
        {editing ? 'Hide' : 'Edit'} Trainer Close PIN
      </button>
      {editing && (
        <div style={{ marginTop: 12 }}>
          <p className="page-subtitle" style={{ marginTop: 0 }}>
            This PIN is shared by every session - a trainer enters it to close out sign-in and generate certificates. Changing it here applies everywhere, not just this session.
          </p>
          {error && <div className="error-banner">{error}</div>}
          {!settings ? (
            <div className="empty-state">Loading...</div>
          ) : (
            <>
              <div className="field-row" style={{ maxWidth: 200 }}>
                <label>Trainer Close PIN</label>
                <input type="text" value={pin} onChange={(e) => setPin(e.target.value)} />
              </div>
              <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>{' '}
              <button className="secondary" onClick={() => { setPin(settings.pin); setEditing(false); }}>Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Multi Training Day (Keeley's request, 2026-10-05): the session's trainings in check-in order,
// with their own durations - 1 is the session's own training, 2+ the additional ones.
function trainingParts(session) {
  if (!session.multi_training_day) return null;
  return [
    { number: 1, label: session.training_type_label, duration: session.duration },
    ...(session.additional_trainings || []).map((t, i) => ({ number: i + 2, label: t.training_type_label, duration: t.duration, id: t.id })),
  ];
}

function shortTraining(label) {
  return String(label || '').replace(/^TRN-\d+\s*-\s*/, '');
}

// How many of a Multi Training Day's trainings an attendee was certified for after close-out.
function MultiTrainingResult({ attendee, total }) {
  const certified = (attendee.certificate_path ? 1 : 0) + (attendee.additional_certificates || []).filter((c) => c.certificate_path).length;
  const cls = certified >= total ? 'badge-current' : certified > 0 ? 'badge-expiringsoon' : 'badge-expired';
  return <span className={`badge ${cls}`}>{certified >= total ? 'Certified for all' : `Certified ${certified} of ${total}`}</span>;
}

function RecordStatusBadge({ status }) {
  const labels = {
    linked: 'Added to employee file',
    no_catalog_match: 'Employee on file (no catalog match)',
    failed: 'Needs attention',
    pending: 'Processing…',
    incomplete_attendance: 'Incomplete (missed a day)',
  };
  const classes = {
    linked: 'badge-current',
    no_catalog_match: 'badge-pendingreview',
    failed: 'badge-expired',
    pending: 'badge-pendingreview',
    incomplete_attendance: 'badge-expired',
  };
  return <span className={`badge ${classes[status] || 'badge-notapplicable'}`}>{labels[status] || status}</span>;
}

// Admin-only edit of the session's own metadata (client/trainer/date/outline/location/
// duration) after creation. Client and Training Type are selects here (not free text like the
// create form) so a typo can't silently spawn a new client mid-edit.
// "2026-10-02" -> "Fri, October 2, 2026" for the session header (plain date, no timezone shift).
function formatLongDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

// trainer_name is stored as one combined field - split to seed the two edit inputs. Comma-aware
// (Keeley's report, 2026-09-22: "Hilton, Kasey" was splitting into first "Hilton,"/last "Kasey").
function splitTrainerName(name) {
  return parseName(name);
}

function EditSessionForm({ session, clients, trainings, onSaved, onCancel, onDeleted }) {
  const { first, last } = splitTrainerName(session.trainer_name);
  const [form, setForm] = useState({
    client_name: session.client_name,
    master_training_id: session.master_training_id || '',
    training_type_label: session.training_type_label,
    trainer_first_name: first,
    trainer_last_name: last,
    trainer_phone: session.trainer_phone || '',
    session_date: session.session_date,
    location: session.location || '',
    wetransfer_link: session.wetransfer_link || '',
    duration: session.duration || '',
    outline: session.outline || '',
    language: session.language || 'english',
    total_days: session.total_days || '',
    toolbox_topic: session.toolbox_topic || '',
  });
  const isToolbox = session.session_kind === 'toolbox_talk';
  // The actual calendar date scheduled for each day of a multi-day session (Keeley's request,
  // 2026-09-22) - purely informational, editable independently of total_days.
  const [dayDates, setDayDates] = useState(session.day_dates || []);
  // Per-day outline text (Keeley's request, 2026-09-22: "Day 1 has its own outline, day 2 and
  // so on").
  const [dayOutlines, setDayOutlines] = useState(session.day_outlines || []);
  // Who teaches each day (Keeley's request, 2026-09-29) - '' means the session's main trainer.
  const [dayTrainers, setDayTrainers] = useState(
    (session.days || []).map((d) => (d.assigned_trainer_employee_id && d.assigned_trainer_employee_id !== session.trainer_employee_id ? d.assigned_trainer_employee_id : ''))
  );
  const [trainerOptions, setTrainerOptions] = useState([]);
  useEffect(() => { api.listTrainers().then(setTrainerOptions).catch(() => {}); }, []);
  // Other trainers teaching alongside the lead (migration 074, 2026-10-01).
  const [coTrainerIds, setCoTrainerIds] = useState((session.co_trainers || []).map((t) => t.trainer_employee_id).filter(Boolean));
  // 2+ trainings: whether attendees check in separately for each one (a Multi Training Day) is a
  // choice (Keeley's request, 2026-10-06) that can change until someone signs in.
  const hasExtras = (session.additional_trainings || []).length > 0;
  const [separateCheckins, setSeparateCheckins] = useState(Boolean(session.multi_training_day));
  const canSwitchCheckins = hasExtras && !isToolbox && session.status === 'open' && (session.attendees || []).length === 0;
  const isMultiTraining = separateCheckins;
  // Each training's own duration - always on a Multi Training Day; on a one-sign-in session only
  // when it was created with them (older ones have a single duration for the whole day).
  const showTrainingDurations = isMultiTraining || (session.additional_trainings || []).some((t) => t.duration);
  const [extraDurations, setExtraDurations] = useState(
    Object.fromEntries((session.additional_trainings || []).map((t) => [t.id, t.duration || '']))
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    if (isMultiTraining && Object.values(extraDurations).some((d) => !String(d).trim())) {
      setError('Enter a duration for every training.');
      setSaving(false);
      return;
    }
    if (!isMultiTraining && form.total_days && dayDates.some((d) => !d)) {
      setError('Enter a scheduled date for every day.');
      setSaving(false);
      return;
    }
    if (!isMultiTraining && form.total_days && dayOutlines.some((o) => !o.trim())) {
      setError('Enter an outline for every day.');
      setSaving(false);
      return;
    }
    try {
      const { total_days: totalDays, ...rest } = form;
      const checkinFields = hasExtras ? { separate_checkins: separateCheckins } : {};
      const durationFields = showTrainingDurations
        ? { additional_training_durations: Object.entries(extraDurations).map(([id, duration]) => ({ id, duration })) }
        : {};
      const updated = await api.updateTrainingSession(session.session_id, isMultiTraining
        ? {
          ...rest,
          trainer_name: `${form.trainer_first_name.trim()} ${form.trainer_last_name.trim()}`.trim(),
          co_trainer_ids: coTrainerIds,
          ...checkinFields,
          ...durationFields,
        }
        : {
          ...form,
          total_days: session.multi_training_day ? null : totalDays,
          trainer_name: `${form.trainer_first_name.trim()} ${form.trainer_last_name.trim()}`.trim(),
          day_dates: form.total_days && !session.multi_training_day ? dayDates : null,
          day_outlines: form.total_days && !session.multi_training_day ? dayOutlines : null,
          day_trainers: form.total_days && !session.multi_training_day ? dayTrainers : null,
          co_trainer_ids: coTrainerIds,
          ...checkinFields,
          ...durationFields,
        });
      if (updated.translation_warning) {
        window.alert(`Saved, but the Spanish translation couldn't be generated: ${updated.translation_warning}`);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSession = async () => {
    if (!window.confirm('Permanently delete this training session? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteTrainingSession(session.session_id);
      onDeleted();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Edit Session Details</h3>
      {error && <p className="error-banner">{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="field">
          <label>Client</label>
          <select value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} required>
            {clients.map((c) => <option key={c.client_id} value={c.client_name}>{c.client_name}</option>)}
          </select>
        </div>
        {isToolbox ? (
          <div className="field">
            <label>Toolbox Talk Topic</label>
            <input value={form.toolbox_topic} onChange={(e) => setForm({ ...form, toolbox_topic: e.target.value })} required />
          </div>
        ) : (
        <div className="field">
          <label>Training Type</label>
          <TrainingSearchSelect
            trainings={trainings}
            value={form.master_training_id}
            onChange={(trainingId) => {
              const t = trainings.find((x) => x.training_id === trainingId);
              setForm({
                ...form,
                master_training_id: trainingId,
                training_type_label: t ? `${t.training_id} - ${t.training_name}` : form.training_type_label,
              });
            }}
          />
        </div>
        )}
        <div className="field">
          <label>Trainer First Name</label>
          <input value={form.trainer_first_name} onChange={(e) => setForm({ ...form, trainer_first_name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Trainer Last Name</label>
          <input value={form.trainer_last_name} onChange={(e) => setForm({ ...form, trainer_last_name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Trainer Employee ID</label>
          <input value={form.trainer_phone} onChange={(e) => setForm({ ...form, trainer_phone: e.target.value })} required />
        </div>
        <div className="field">
          <label>Other trainers</label>
          <CoTrainersPicker trainers={trainerOptions} value={coTrainerIds} onChange={setCoTrainerIds} leadId={session.trainer_employee_id} />
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} required />
        </div>
        <div className="field">
          <label>Location / Address</label>
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="123 Main St, Suite 4" required />
        </div>
        {!isToolbox && (
          <div className="field">
            <label>WeTransfer Link</label>
            <input value={form.wetransfer_link} onChange={(e) => setForm({ ...form, wetransfer_link: e.target.value })} placeholder="https://we.tl/..." />
          </div>
        )}
        <div className="field">
          <label>{showTrainingDurations ? `Duration – ${shortTraining(session.training_type_label)}` : 'Duration'}</label>
          <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="e.g. 4 hours, Half day" required />
        </div>
        {showTrainingDurations && (session.additional_trainings || []).map((t) => (
          <div className="field" key={t.id}>
            <label>Duration – {shortTraining(t.training_type_label)}</label>
            <input
              value={extraDurations[t.id] || ''}
              onChange={(e) => setExtraDurations((prev) => ({ ...prev, [t.id]: e.target.value }))}
              placeholder="e.g. 2 hours"
              required
            />
          </div>
        ))}
        {hasExtras && !isToolbox && (
          <div className="field">
            <label>Check-In</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={separateCheckins}
                disabled={!canSwitchCheckins}
                onChange={(e) => setSeparateCheckins(e.target.checked)}
              />
              Check in separately for each training
            </label>
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
              {canSwitchCheckins
                ? 'Off: one sign-in covers every training.'
                : "Can't be changed once someone has signed in."}
            </p>
          </div>
        )}
        <div className="field">
          <label>Sign-In Language</label>
          <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} required>
            <option value="english">English</option>
            <option value="spanish">Spanish</option>
            <option value="both">Both (English/Spanish)</option>
          </select>
        </div>
        {!isToolbox && !isMultiTraining && (
        <div className="field">
          <label>Total Days (multi-day training)</label>
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
            placeholder="Leave blank for single-day"
          />
        </div>
        )}
      </div>
      {!isMultiTraining && form.total_days && dayDates.length > 0 && (
        <div className="field">
          <label>Scheduled Dates &amp; Trainers</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayDates.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 40 }}>Day {i + 1}</span>
                <input
                  type="date"
                  value={d}
                  onChange={(e) => setDayDates((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                  style={{ maxWidth: 150 }}
                  required
                />
                <select
                  value={dayTrainers[i] || ''}
                  onChange={(e) => setDayTrainers((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })}
                  aria-label={`Day ${i + 1} trainer`}
                  style={{ maxWidth: 240 }}
                >
                  <option value="">Main trainer ({`${form.trainer_first_name} ${form.trainer_last_name}`.trim() || 'not set'})</option>
                  {trainerOptions.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
                </select>
                {session.days?.[i]?.signed_at && (
                  <span style={{ fontSize: 12, color: 'var(--status-current-text)' }}>Signed off by {session.days[i].signed_trainer_name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!isMultiTraining && form.total_days && dayOutlines.length > 0 && (
        <div className="field">
          <label>Outline per Day</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dayOutlines.map((o, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 44, marginTop: 8 }}>Day {i + 1}</span>
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
        </div>
      )}
      <div className="field">
        <label>Outline / Topics Covered</label>
        <textarea rows={3} value={form.outline} onChange={(e) => setForm({ ...form, outline: e.target.value })} required />
      </div>
      <button className="btn btn-accent" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Changes'}</button>{' '}
      <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
        Already-generated roster/certificate PDFs won't be regenerated, and already-processed attendee records
        won't retroactively update — use each attendee's Retry button for that.
      </p>
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
        <strong style={{ fontSize: 13 }}>Delete this session</strong>
        <p className="page-subtitle" style={{ margin: '4px 0 8px' }}>
          Made this session by accident? This permanently deletes it and its roster/certificates. This cannot be undone.
        </p>
        <button className="btn btn-danger" type="button" disabled={deleting} onClick={deleteSession}>
          {deleting ? 'Deleting…' : 'Delete Session'}
        </button>
      </div>
    </div>
  );
}

// Session prep (Keeley's request, 2026-10-07) - a session with one of our own trainers. The prep
// team (emailed when the session is created) fills in the class details here; saving emails the
// reviewers, who then send the trainer(s) a summary with everything, QR code attached. See
// server/lib/sessionPrep.js.
const PREP_STATUS = {
  info_needed: ['badge-expiringsoon', 'Additional info needed'],
  ready_to_send: ['badge-pendingreview', 'Ready to send'],
  sent: ['badge-current', 'Sent to trainer'],
};

function SessionPrepCard({ session, isAdmin, onChanged }) {
  const cardRef = useRef(null);
  const [trainerOptions, setTrainerOptions] = useState([]);
  const [form, setForm] = useState({
    student_count: session.prep_student_count ?? '',
    room_layout: session.prep_room_layout || '',
    av_connection: session.prep_av_connection || '',
    wetransfer_link: session.wetransfer_link || '',
  });
  const [assistantIds, setAssistantIds] = useState((session.co_trainers || []).map((t) => t.trainer_employee_id).filter(Boolean));
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (isAdmin) api.listTrainers().then(setTrainerOptions).catch(() => {}); }, [isAdmin]);
  // The emails link here with ?prep=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('prep') === '1') cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const trainings = [
    { label: session.training_type_label, duration: session.duration },
    ...(session.additional_trainings || []).map((t) => ({ label: t.training_type_label, duration: t.duration })),
  ];
  const status = PREP_STATUS[session.prep_status];
  const canSend = ['ready_to_send', 'sent'].includes(session.prep_status);

  const save = async () => {
    setBusy('save'); setError(''); setMessage('');
    try {
      const result = await api.saveSessionPrep(session.session_id, { ...form, co_trainer_ids: assistantIds });
      setMessage(result.notified ? 'Saved - the reviewers were emailed to check it and send the summary.' : 'Saved.');
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    if (!window.confirm(`${session.prep_status === 'sent' ? 'Send the updated' : 'Send the'} class summary (with the QR code) to the trainer(s) now?`)) return;
    setBusy('send'); setError(''); setMessage('');
    try {
      const result = await api.sendSessionPrepSummary(session.session_id);
      setMessage(`Summary sent to ${result.sent_to.join(', ')}.${result.missing?.length ? ` No email on file for ${result.missing.join(', ')}.` : ''}${result.failed?.length ? ` Didn't go through to ${result.failed.join(', ')}.` : ''}`);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card" ref={cardRef} style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Session Prep</h3>
        {status && <span className={`badge ${status[0]}`}>{status[1]}</span>}
      </div>
      <p className="page-subtitle" style={{ margin: '4px 0 12px' }}>
        {session.prep_completed_at ? `Details added by ${session.prep_completed_by} ${formatEasternDateTime(session.prep_completed_at)}. ` : ''}
        {session.prep_sent_at ? `Summary sent to the trainer(s) by ${session.prep_sent_by} ${formatEasternDateTime(session.prep_sent_at)}.` : ''}
      </p>
      {error && <p className="error-banner">{error}</p>}
      {message && <p className="success-banner">{message}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Class Type</label>
            <div style={{ fontSize: 14 }}>
              {trainings.map((t) => (
                <div key={t.label}>{t.label}{t.duration && <span style={{ color: 'var(--color-text-muted)' }}> · {t.duration}</span>}</div>
              ))}
            </div>
          </div>
          <div className="field">
            <label># of Students</label>
            <input type="number" min={1} value={form.student_count} disabled={!isAdmin} onChange={(e) => setForm({ ...form, student_count: e.target.value })} />
          </div>
          <div className="field">
            <label>AV Connection</label>
            <select value={form.av_connection} disabled={!isAdmin} onChange={(e) => setForm({ ...form, av_connection: e.target.value })}>
              <option value="">Select…</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Room Layout</label>
            <textarea rows={2} value={form.room_layout} disabled={!isAdmin} onChange={(e) => setForm({ ...form, room_layout: e.target.value })} placeholder="e.g. Classroom style, 4 tables of 6, projector at the front" />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>WeTransfer Link</label>
            <input value={form.wetransfer_link} disabled={!isAdmin} onChange={(e) => setForm({ ...form, wetransfer_link: e.target.value })} placeholder="https://we.tl/..." />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Assistant Instructor (if applicable)</label>
            {isAdmin
              ? <CoTrainersPicker trainers={trainerOptions} value={assistantIds} onChange={setAssistantIds} leadId={session.trainer_employee_id} />
              : <div style={{ fontSize: 14 }}>{(session.co_trainers || []).map((t) => t.trainer_name).join(', ') || 'None'}</div>}
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>Added as a co-trainer: their name goes on the certificates and they get the session emails.</p>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>QR Code</div>
          <img src={`/api/training-sessions/${session.session_id}/qrcode.png`} alt="Sign-in QR code" style={{ width: 130, height: 130 }} />
          <div><a href={`/api/training-sessions/${session.session_id}/qrcode.png`} download style={{ fontSize: 12 }}>Download</a></div>
        </div>
      </div>
      {isAdmin && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <button type="button" className="btn btn-accent" disabled={Boolean(busy)} onClick={save}>
            {busy === 'save' ? 'Saving…' : session.prep_status === 'info_needed' ? 'Save & Send for Review' : 'Save Changes'}
          </button>
          {canSend && (
            <button type="button" className="btn" disabled={Boolean(busy)} onClick={send}>
              {busy === 'send' ? 'Sending…' : session.prep_status === 'sent' ? 'Resend Summary to Trainer(s)' : 'Send Summary to Trainer(s)'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Manually add a missed attendee to the roster (Keeley's request, 2026-09-22) - works whether
// the session is open or already closed; a closed session's roster used to be permanently
// locked to new entries, only removal was ever allowed. Signature is optional since there's
// often no live signature to capture after the fact.
function AddAttendeeForm({ sessionId, isClosed, onAdded, onCancel }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sigRef = useRef(null);

  const save = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required.');
    setSaving(true);
    setError('');
    try {
      await api.addSessionAttendee(sessionId, {
        trainee_first_name: firstName.trim(),
        trainee_last_name: lastName.trim(),
        trainee_phone: phone.trim() || null,
        trainee_job_title: jobTitle.trim() || null,
        trainee_email: email.trim() || null,
        signature: sigRef.current?.isEmpty() ? null : sigRef.current?.toDataURL(),
      });
      onAdded();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Add Attendee</h3>
      {isClosed && (
        <p className="page-subtitle" style={{ marginTop: -6 }}>
          This session is already closed - adding someone here generates their certificate/training record and
          updates the roster right away, same as everyone else got at close-out.
        </p>
      )}
      {error && <p className="error-banner">{error}</p>}
      <form onSubmit={save}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="field">
            <label>First Name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Last Name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
          </div>
          <div className="field">
            <label>Job Title (optional)</label>
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Email (optional)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
        </div>
        <div className="field">
          <label>Signature (optional)</label>
          <SignaturePad ref={sigRef} />
        </div>
        <button className="btn btn-accent" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add Attendee'}</button>{' '}
        <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>
      </form>
    </div>
  );
}

export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [retryingId, setRetryingId] = useState(null);
  const [savingEditId, setSavingEditId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [markingDay, setMarkingDay] = useState('');
  const [editingSession, setEditingSession] = useState(false);
  const [clients, setClients] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [copiedLink, setCopiedLink] = useState('');
  const [savingFulfillment, setSavingFulfillment] = useState('');
  const [showAddAttendee, setShowAddAttendee] = useState(false);

  const load = () => {
    api.getTrainingSession(id).then(setSession).catch((err) => setError(err.message));
  };

  // Records "copied link" as an activity (Keeley's request, 2026-09-17) - previously this was
  // just plain text for someone to manually select/copy, with no record it ever happened.
  const copyLink = async (url, linkType) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(linkType);
      setTimeout(() => setCopiedLink(''), 2000);
      api.logSessionLinkCopied(id, linkType).catch(() => {});
    } catch {
      /* clipboard access denied/unavailable - the URL is still shown as text below to select manually */
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000); // live-ish roster while a session is open
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!isAdmin) return;
    api.listClients().then(setClients).catch(() => {});
    api.listMasterTrainings(true).then(setTrainings).catch(() => {});
  }, [isAdmin]);

  const saveEdit = async (attendeeId) => {
    setSavingEditId(attendeeId);
    try {
      await api.updateSessionAttendee(id, attendeeId, { trainee_name: editName, trainee_phone: editPhone, trainee_email: editEmail });
      setEditingId(null);
      load();
    } finally {
      setSavingEditId(null);
    }
  };

  const removeAttendee = async (attendee) => {
    const message = session.status === 'closed'
      ? `Remove ${attendee.trainee_name} from this closed session?

Their certificate and the training record it added to their employee file will be deleted, and the rosters will be rebuilt without them.`
      : 'Remove this sign-in entry?';
    if (!window.confirm(message)) return;
    setRemovingId(attendee.attendee_id);
    try {
      await api.deleteSessionAttendee(id, attendee.attendee_id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  // Mark a multi-day attendee present for a day they forgot to sign in for (Keeley's request,
  // 2026-10-01), or undo an office mark. On a closed session, completing their days issues the
  // certificate and training record.
  const partName = (day) => {
    const parts = trainingParts(session);
    return parts ? shortTraining(parts[day - 1]?.label) : `Day ${day}`;
  };
  const markDay = async (attendee, day) => {
    const closedNote = session.status !== 'closed' ? ''
      : session.multi_training_day
        ? '\n\nThe session is closed - their certificate and training record for this training are created now.'
        : '\n\nThe session is closed - if this completes their days, their certificate and training record are created now.';
    if (!window.confirm(`Mark ${attendee.trainee_name} present for ${partName(day)}? This shows as marked by the office (no signature).${closedNote}`)) return;
    setMarkingDay(`${attendee.attendee_id}:${day}`);
    try {
      await api.markAttendanceDay(id, attendee.attendee_id, day);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setMarkingDay('');
    }
  };
  const unmarkDay = async (attendee, day) => {
    if (!window.confirm(`Undo the office mark for ${attendee.trainee_name} on ${partName(day)}?`)) return;
    setMarkingDay(`${attendee.attendee_id}:${day}`);
    try {
      await api.unmarkAttendanceDay(id, attendee.attendee_id, day);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setMarkingDay('');
    }
  };

  // The trainer's "Edit close-out details" page, same as the link in their close-out email - for
  // sessions closed before that link existed, when the trainer can't find the email, or to see
  // what the trainer sees. Built on this page's own site so it also works on localhost.
  const trainerEditUrl = async () => `${window.location.origin}${(await api.getSessionEditLink(id)).path}`;

  const copyTrainerEditLink = async () => {
    try {
      await navigator.clipboard.writeText(await trainerEditUrl());
      setCopiedLink('trainer-edit');
      setTimeout(() => setCopiedLink(''), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  const [rebuilding, setRebuilding] = useState(false);
  const [showDocsUpload, setShowDocsUpload] = useState(false);
  const rebuildRosters = async () => {
    if (!window.confirm('Rebuild the roster PDF(s) from what is on file now? Nothing is emailed.')) return;
    setRebuilding(true);
    try {
      await api.rebuildSessionRosters(id);
      window.alert('Roster rebuilt. Download it again to see the update.');
    } catch (err) {
      setError(err.message);
    } finally {
      setRebuilding(false);
    }
  };

  const openTrainerEditPage = async () => {
    // Opened before the request so the browser doesn't treat it as an unrequested pop-up.
    const tab = window.open('', '_blank');
    try {
      tab.location = await trainerEditUrl();
    } catch (err) {
      tab?.close();
      setError(err.message);
    }
  };

  const toggleFulfillment = async (field, value) => {
    setSavingFulfillment(field);
    try {
      const updated = await api.updateSessionFulfillment(id, { [field]: value });
      setSession((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFulfillment('');
    }
  };

  const [advancingDay, setAdvancingDay] = useState(false);
  const advanceDay = async () => {
    // Warn when the next day isn't scheduled yet (Keeley's request, 2026-09-28): a Day 1 session
    // advanced that morning recorded all of Day 1's sign-ins as Day 2.
    const nextDay = session.current_day + 1;
    const nextDate = session.day_dates?.[session.current_day];
    const today = easternToday();
    if (session.multi_training_day) {
      if (!window.confirm(`Open ${partName(nextDay)} for check-in now?\n\nOnly do this when ${partName(session.current_day)} is over. Anyone who checks in after this is checked in for ${partName(nextDay)}.`)) return;
    } else if (nextDate && nextDate > today) {
      const ok = window.confirm(
        `Day ${nextDay} is scheduled for ${formatShortDate(nextDate)}, but today is ${formatShortDate(today)}.\n\n` +
        `Open Day ${nextDay} now anyway? Everyone who signs in after this is recorded for Day ${nextDay}.`
      );
      if (!ok) return;
    }
    setAdvancingDay(true);
    try {
      await api.advanceSessionDay(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdvancingDay(false);
    }
  };

  // Undo an early/mistaken advance - sign-ins recorded for the current day move back with it.
  const previousDay = async () => {
    const fromDay = session.current_day;
    const count = session.attendees.filter((a) => (a.days_attended || []).includes(fromDay)).length;
    const ok = window.confirm(
      `Go back to ${partName(fromDay - 1)}?\n\n` +
      (count
        ? `${count} check-in${count === 1 ? '' : 's'} recorded for ${partName(fromDay)} will move back to ${partName(fromDay - 1)}.`
        : `No one has checked in for ${partName(fromDay)} yet.`)
    );
    if (!ok) return;
    setAdvancingDay(true);
    try {
      await api.previousSessionDay(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdvancingDay(false);
    }
  };

  const retryProcessing = async (attendeeId) => {
    setRetryingId(attendeeId);
    try {
      await api.retryAttendeeProcessing(id, attendeeId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetryingId(null);
    }
  };

  if (error) return <p className="error-banner">{error}</p>;
  if (!session) return <p>Loading…</p>;

  return (
    <div>
      <Link to="/sessions" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        ← All sessions
      </Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>
        {session.multi_training_day ? 'Multi Training Day' : (
          <>
            {session.training_type_label}
            {session.additional_trainings?.map((t) => (
              <span key={t.id}> + {t.training_type_label}</span>
            ))}
          </>
        )}
      </h1>
      {/* Labeled details (Keeley's report, 2026-09-22: "I can't see the client" - it was the
          first, unlabeled item in one long grey line). */}
      <div className="session-facts">
        <div className="session-fact">
          <div className="session-fact-label">Client</div>
          <div className="session-fact-value session-fact-client">
            <Link to={`/clients/${session.client_id}`}>{session.client_name}</Link>
          </div>
        </div>
        <div className="session-fact">
          <div className="session-fact-label">Date</div>
          <div className="session-fact-value">{formatLongDate(session.session_date)}</div>
        </div>
        {session.multi_training_day ? (
          <div className="session-fact">
            <div className="session-fact-label">Trainings</div>
            <div className="session-fact-value">
              {trainingParts(session).map((t) => (
                <div key={t.number} style={{ fontSize: 13 }}>
                  {t.number}. {t.label}{t.duration && <span style={{ color: 'var(--color-text-muted)' }}> · {t.duration}</span>}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="session-fact">
          <div className="session-fact-label">{session.co_trainers?.length ? 'Trainers' : 'Trainer'}</div>
          <div className="session-fact-value">
            {session.trainer_signed_name || session.trainer_name}
            {session.co_trainers?.length > 0 && <>, {session.co_trainers.map((t) => t.trainer_name).join(', ')}</>}
            {session.trainer_email && <div className="session-fact-sub">{session.trainer_email}</div>}
          </div>
        </div>
        {session.location && (
          <div className="session-fact">
            <div className="session-fact-label">Location</div>
            <div className="session-fact-value">{session.location}</div>
          </div>
        )}
        {session.duration && !session.multi_training_day && (
          <div className="session-fact">
            <div className="session-fact-label">Duration</div>
            <div className="session-fact-value">{session.duration}</div>
          </div>
        )}
      </div>
      <p className="page-subtitle">
        <span className={`badge badge-${session.status}`}>{session.status === 'open' ? 'Open' : 'Closed'}</span>
        {session.total_days && (
          <>
            {' '}·{' '}
            <span className="badge badge-noexpiration">
              {session.multi_training_day
                ? `Training ${session.current_day} of ${session.total_days}: ${partName(session.current_day)}`
                : `Day ${session.current_day} of ${session.total_days}`}
              {session.day_dates?.[session.current_day - 1] ? ` (${formatShortDate(session.day_dates[session.current_day - 1])})` : ''}
            </span>
          </>
        )}
        {session.language && session.language !== 'english' && (
          <>{' '}· <span className="badge badge-noexpiration">{session.language === 'both' ? 'English/Spanish' : 'Spanish'}</span></>
        )}
        {isAdmin && !editingSession && (
          <>{' '}· <button type="button" className="link-button" onClick={() => setEditingSession(true)}>Edit session details</button></>
        )}
      </p>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!session.sent_to_client}
              disabled={savingFulfillment === 'sent_to_client'}
              onChange={(e) => toggleFulfillment('sent_to_client', e.target.checked)}
            />
            Sent to Client
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!session.saved_to_server}
              disabled={savingFulfillment === 'saved_to_server'}
              onChange={(e) => toggleFulfillment('saved_to_server', e.target.checked)}
            />
            Saved to Server
          </label>
        </div>
      )}

      {session.prep_status && <SessionPrepCard key={session.session_id} session={session} isAdmin={isAdmin} onChanged={load} />}
      {!session.prep_status && isAdmin && session.status === 'open' && session.session_kind !== 'toolbox_talk' && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          No session prep for this session.{' '}
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              if (!window.confirm('Email the prep team to add the class details for this session?')) return;
              try { await api.startSessionPrep(session.session_id); load(); } catch (e) { setError(e.message); }
            }}
          >
            Request session prep
          </button>
        </p>
      )}

      {/* Multi-day training (Keeley's request, 2026-09-21/22) - the day advance is manual
          (never calendar-driven), so it survives a course slipping a day for weather/a holiday
          without misjudging attendance. New sign-ins and "find your name" check-ins always
          attach to whichever day is current at the moment they happen. */}
      {session.total_days && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14 }}>{session.multi_training_day ? 'Check-In by Training' : 'Attendance by Day'}</h3>
              <p className="page-subtitle" style={{ margin: '2px 0 0' }}>
                {session.multi_training_day
                  ? `One QR code for all ${session.total_days} trainings - attendees check in again at the start of each one, and get a certificate for each training they check in for.`
                  : `One QR code covers all ${session.total_days} days. Certificates only generate for attendees present every day.`}
              </p>
            </div>
            {isAdmin && session.status === 'open' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {session.current_day > 1 && (
                  <button className="btn btn-secondary btn-sm" disabled={advancingDay} onClick={previousDay}>
                    ← Back to {partName(session.current_day - 1)}
                  </button>
                )}
                <button
                  className="btn btn-accent btn-sm"
                  disabled={advancingDay || session.current_day >= session.total_days}
                  onClick={advanceDay}
                >
                  {advancingDay
                    ? 'Updating…'
                    : session.current_day >= session.total_days
                      ? (session.multi_training_day ? 'On the last training' : `On Final Day (${session.total_days})`)
                      : `Open ${partName(session.current_day + 1)} →`}
                </button>
              </div>
            )}
          </div>
          {/* Each day's trainer and sign-off (Keeley's request, 2026-09-29). */}
          {session.days?.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr><th>Day</th><th>Trainer</th><th>Sign-Off</th><th>Outline</th></tr>
              </thead>
              <tbody>
                {session.days.map((d) => {
                  const substitute = d.signed_trainer_name && d.assigned_trainer_name
                    && d.signed_trainer_name.toLowerCase() !== d.assigned_trainer_name.toLowerCase();
                  return (
                    <tr key={d.day_number}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <strong>Day {d.day_number}</strong>
                        {d.date && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{formatShortDate(d.date)}</div>}
                      </td>
                      <td>
                        {d.signed_trainer_name || d.assigned_trainer_name || '—'}
                        {substitute && (
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Filled in for {d.assigned_trainer_name}</div>
                        )}
                      </td>
                      <td>
                        {d.signed_at ? (
                          <span className="badge badge-current">Signed {formatEasternDateTime(d.signed_at)}</span>
                        ) : d.day_number === session.current_day && session.status === 'open' ? (
                          <span className="badge badge-expiringsoon">In progress</span>
                        ) : d.day_number < session.current_day ? (
                          <span className="badge badge-expired">Not signed off</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{session.day_outlines?.[d.day_number - 1] || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Employee</th>
                {Array.from({ length: session.total_days }, (_, i) => i + 1).map((d) => (
                  <th key={d} style={{ textAlign: 'center' }}>
                    {partName(d)}
                    {session.multi_training_day && trainingParts(session)[d - 1]?.duration && (
                      <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted)' }}>{trainingParts(session)[d - 1].duration}</div>
                    )}
                    {session.day_dates?.[d - 1] && (
                      <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {formatShortDate(session.day_dates[d - 1])}
                      </div>
                    )}
                  </th>
                ))}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {session.attendees.map((a) => {
                const daysAttended = a.days_attended || [];
                const isComplete = daysAttended.length >= session.total_days;
                return (
                  <tr key={a.attendee_id}>
                    <td>{a.trainee_name}</td>
                    {Array.from({ length: session.total_days }, (_, i) => i + 1).map((d) => {
                      const byOffice = (a.days_marked_by_office || []).includes(d);
                      // Only days that have started: up to the current day while open, any day once closed.
                      const dayStarted = session.status === 'closed' || d <= session.current_day;
                      const busy = markingDay === `${a.attendee_id}:${d}`;
                      return (
                        <td key={d} style={{ textAlign: 'center' }}>
                          {daysAttended.includes(d) ? (
                            <>
                              <span style={{ color: 'var(--status-current-text)', fontWeight: 700 }}>✓</span>
                              {byOffice && (
                                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                  Marked by office
                                  {isAdmin && session.status === 'open' && (
                                    <>
                                      {' · '}
                                      <button type="button" className="link-button" style={{ fontSize: 11 }} disabled={busy} onClick={() => unmarkDay(a, d)}>Undo</button>
                                    </>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                              {isAdmin && dayStarted && (
                                <div>
                                  <button type="button" className="link-button" style={{ fontSize: 11 }} disabled={busy} onClick={() => markDay(a, d)}>
                                    {busy ? 'Saving…' : 'Mark present'}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      {session.status === 'closed' && session.multi_training_day ? (
                        <MultiTrainingResult attendee={a} total={session.total_days} />
                      ) : session.status === 'closed' ? (
                        <RecordStatusBadge status={a.processing_status} />
                      ) : session.multi_training_day ? (
                        <span className="badge badge-noexpiration">
                          Checked in {daysAttended.length} of {session.total_days}
                        </span>
                      ) : (
                        <span className={`badge ${isComplete ? 'badge-current' : 'badge-expired'}`}>
                          {isComplete ? 'On Track' : `Missing ${session.total_days - daysAttended.length} Day(s)`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {session.attendees.length === 0 && (
                <tr><td colSpan={session.total_days + 2} className="empty-state">No sign-ins yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingSession && (
        <EditSessionForm
          session={session}
          clients={clients}
          trainings={trainings}
          onSaved={() => { setEditingSession(false); load(); }}
          onCancel={() => setEditingSession(false)}
          onDeleted={() => navigate('/sessions')}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Sign-In QR Code</h3>
            <img
              src={`/api/training-sessions/${id}/qrcode.png`}
              alt="Session QR code"
              style={{ width: '100%', borderRadius: 8 }}
            />
            <a
              href={`/api/training-sessions/${id}/qrcode.png`}
              download
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            >
              Download QR (PNG)
            </a>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, wordBreak: 'break-all' }}>
              {session.public_url}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => copyLink(session.public_url, 'sign-in')}
            >
              {copiedLink === 'sign-in' ? 'Copied!' : 'Copy Link'}
            </button>

            {session.status === 'closed' && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a href={`/api/training-sessions/${id}/roster.pdf`} className="btn btn-sm" style={{ justifyContent: 'center' }}>
                  Download Roster (PDF)
                </a>
                {session.master_training_id === 'TRN-020' && (
                  <a
                    href={`/api/training-sessions/${id}/aha-roster.pdf`}
                    className="btn btn-accent btn-sm"
                    style={{ justifyContent: 'center' }}
                  >
                    Download AHA Course Roster (PDF)
                  </a>
                )}
                <a
                  href={`/api/training-sessions/${id}/roster.csv`}
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                >
                  Export Roster (CSV)
                </a>
                {isAdmin && (
                  <>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={openTrainerEditPage}>
                      Open Trainer Edit Page
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={copyTrainerEditLink}>
                      {copiedLink === 'trainer-edit' ? 'Copied!' : 'Copy Trainer Edit Link'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} disabled={rebuilding} onClick={rebuildRosters}>
                      {rebuilding ? 'Rebuilding…' : 'Rebuild Roster'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={() => setShowDocsUpload(true)}>
                      Upload Attendee Documents
                    </button>
                    {showDocsUpload && <AttendeeDocumentsUpload session={session} onClose={() => setShowDocsUpload(false)} />}
                  </>
                )}
                {/* One ZIP per training (Keeley's request, 2026-09-17) - a session covering just
                    one training (the normal case) gets a single button; 2+ trainings taught
                    together get one button each, since certificates are never mixed types in
                    the same ZIP. Every certificate inside is already named "Training Title_
                    Client_Trainer_Date_Trainee Name.pdf" - nothing to rename by hand. */}
                {session.session_kind !== 'toolbox_talk' && (
                <a
                  href={`/api/training-sessions/${id}/certificates.zip?training=primary`}
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                >
                  Download {session.additional_trainings?.length ? `"${session.training_type_label}"` : 'All'} Certificates (ZIP)
                </a>
                )}
                {session.additional_trainings?.map((t) => (
                  <a
                    key={t.id}
                    href={`/api/training-sessions/${id}/certificates.zip?training=${t.id}`}
                    className="btn btn-secondary btn-sm"
                    style={{ justifyContent: 'center' }}
                  >
                    Download &quot;{t.training_type_label}&quot; Certificates (ZIP)
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Always available, not gated on the session being closed (Keeley's call,
              2026-08-25) - this is meant to be shown to trainees at the physical end of
              training, right before the trainer does the close-out/sign-off, not after. */}
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Feedback QR Code</h3>
            <img
              src={`/api/training-sessions/${id}/feedback-qrcode.png`}
              alt="Feedback QR code"
              style={{ width: '100%', borderRadius: 8 }}
            />
            <a
              href={`/api/training-sessions/${id}/feedback-qrcode.png`}
              download
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            >
              Download QR (PNG)
            </a>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, wordBreak: 'break-all' }}>
              {session.feedback_url}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => copyLink(session.feedback_url, 'feedback')}
            >
              {copiedLink === 'feedback' ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>

        <div className="card">
          {session.outline && (
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>Outline</strong>
              <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>{session.outline}</p>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Roster ({session.attendees.length})</h3>
            {isAdmin && !showAddAttendee && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddAttendee(true)}>
                + Add Attendee
              </button>
            )}
          </div>
          {isAdmin && showAddAttendee && (
            <AddAttendeeForm
              sessionId={id}
              isClosed={session.status === 'closed'}
              onAdded={() => { setShowAddAttendee(false); load(); }}
              onCancel={() => setShowAddAttendee(false)}
            />
          )}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Signed At</th>
                {session.status === 'closed' && session.session_kind !== 'toolbox_talk' && <th>Certificate</th>}
                {session.status === 'closed' && <th>Employee File</th>}
                {session.status === 'open' && isAdmin && <th></th>}
                {session.status === 'closed' && isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {session.attendees.map((a) => (
                <tr key={a.attendee_id}>
                  {editingId === a.attendee_id ? (
                    <>
                      <td>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </td>
                      <td>
                        <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                      </td>
                      <td>
                        <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" />
                      </td>
                      <td colSpan={2}>
                        <button className="btn btn-sm" disabled={savingEditId === a.attendee_id} onClick={() => saveEdit(a.attendee_id)}>
                          {savingEditId === a.attendee_id ? 'Saving…' : 'Save'}
                        </button>{' '}
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        {a.employee_id ? <Link to={`/employees/${a.employee_id}`}>{a.trainee_name}</Link> : a.trainee_name}
                        {a.added_by_admin ? (
                          <span className="badge badge-noexpiration" style={{ marginLeft: 6, fontSize: 10 }}>Added manually</span>
                        ) : null}
                      </td>
                      <td>{a.trainee_phone || '—'}</td>
                      <td>{a.trainee_email || '—'}</td>
                      <td>{formatEasternDateTime(a.signed_at)}</td>
                      {session.status === 'closed' && session.session_kind !== 'toolbox_talk' && (
                        <td>
                          {/* One link per training when the session covers more than one
                              (Keeley's request, 2026-09-17) - each attendee gets a separate
                              certificate per training even though they only signed in once. */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {a.certificate_path && (
                              <a href={`/api/training-sessions/${id}/attendees/${a.attendee_id}/certificate.pdf`}>
                                {session.additional_trainings?.length ? session.training_type_label : 'Download'}
                              </a>
                            )}
                            {a.additional_certificates?.map((c) => {
                              const training = session.additional_trainings?.find((t) => t.id === c.session_additional_training_id);
                              return c.certificate_path ? (
                                <a
                                  key={c.id}
                                  href={`/api/training-sessions/${id}/attendees/${a.attendee_id}/additional-certificates/${c.id}.pdf`}
                                >
                                  {training?.training_type_label || 'Download'}
                                </a>
                              ) : null;
                            })}
                            {!a.certificate_path && !a.additional_certificates?.some((c) => c.certificate_path) && '—'}
                          </div>
                        </td>
                      )}
                      {session.status === 'closed' && (
                        <td>
                          {session.multi_training_day
                            ? <MultiTrainingResult attendee={a} total={session.total_days} />
                            : <RecordStatusBadge status={a.processing_status} />}
                        </td>
                      )}
                      {session.status === 'open' && isAdmin && (
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingId(a.attendee_id);
                              setEditName(a.trainee_name);
                              setEditPhone(a.trainee_phone || '');
                              setEditEmail(a.trainee_email || '');
                            }}
                          >
                            Edit
                          </button>{' '}
                          <button className="btn btn-danger btn-sm" disabled={removingId === a.attendee_id} onClick={() => removeAttendee(a)}>
                            {removingId === a.attendee_id ? 'Removing…' : 'Remove'}
                          </button>
                        </td>
                      )}
                      {session.status === 'closed' && isAdmin && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {(a.processing_status === 'failed' || a.processing_status === 'no_catalog_match') && (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled={retryingId === a.attendee_id}
                                onClick={() => retryProcessing(a.attendee_id)}
                              >
                                {retryingId === a.attendee_id ? 'Retrying…' : 'Retry'}
                              </button>{' '}
                            </>
                          )}
                          <button className="btn btn-danger btn-sm" disabled={removingId === a.attendee_id} onClick={() => removeAttendee(a)}>
                            {removingId === a.attendee_id ? 'Removing…' : 'Remove'}
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {session.attendees.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No sign-ins yet — display the QR code for trainees to scan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* A collect-only feature with no way to ever see the results isn't useful, so this
          summarizes what's come in so far - only appears once at least one trainee has
          submitted, since there's nothing to show before that. */}
      {session.feedback && session.feedback.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Feedback ({session.feedback.length} response{session.feedback.length === 1 ? '' : 's'})</h3>
          <div style={{ display: 'flex', gap: 32, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Avg. Effectiveness</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {(session.feedback.reduce((sum, f) => sum + f.effectiveness_rating, 0) / session.feedback.length).toFixed(1)} / 5
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Avg. Trainer Rating</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {(session.feedback.reduce((sum, f) => sum + f.trainer_rating, 0) / session.feedback.length).toFixed(1)} / 5
              </div>
            </div>
          </div>
          {/* Every individual response, not just the pooled comment list (Keeley's request,
              2026-09-16) - the averages above are useful for a quick read, but seeing each
              trainee's full answer set together (both yes/no questions and both star ratings,
              not just whichever ones happened to include a comment) is what actually shows
              whether one bad rating is an outlier or several people agree. Feedback has no
              trainee identity by design (session_feedback is anonymous - see migration
              023_session_feedback.sql), so responses are numbered in submission order rather
              than attributed to anyone. */}
          {/* Each trainer's own average when more than one taught (per-trainer ratings, 2026-10-01). */}
          {(() => {
            const byTrainer = new Map();
            for (const f of session.feedback) {
              for (const r of f.trainer_ratings || []) {
                const key = r.trainer_employee_id || r.trainer_name;
                const entry = byTrainer.get(key) || { name: r.trainer_name, total: 0, n: 0 };
                entry.total += r.rating; entry.n += 1;
                byTrainer.set(key, entry);
              }
            }
            if (byTrainer.size < 2) return null;
            return (
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 13 }}>Rating by Trainer</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', marginTop: 6, fontSize: 13 }}>
                  {[...byTrainer.values()].map((t) => (
                    <span key={t.name}><strong>{t.name}:</strong> {(t.total / t.n).toFixed(1)} / 5 <span style={{ color: 'var(--color-text-muted)' }}>({t.n})</span></span>
                  ))}
                </div>
              </div>
            );
          })()}
          <strong style={{ fontSize: 13 }}>Individual Responses</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {session.feedback.map((f, i) => (
              <div key={f.feedback_id} className="card" style={{ background: 'var(--color-bg, #f7f7f7)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                  <span>Response {i + 1}</span>
                  <span>{formatEasternDateTime(f.submitted_at)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, fontSize: 13 }}>
                  <div><strong>Training Effectiveness:</strong> {'★'.repeat(f.effectiveness_rating)}{'☆'.repeat(5 - f.effectiveness_rating)}</div>
                  {(f.trainer_ratings || []).length > 0
                    ? f.trainer_ratings.map((r) => (
                      <div key={r.id}><strong>{r.trainer_name}:</strong> {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                    ))
                    : <div><strong>Trainer Rating:</strong> {'★'.repeat(f.trainer_rating)}{'☆'.repeat(5 - f.trainer_rating)}</div>}
                  <div><strong>Could Ask Questions:</strong> {f.could_ask_questions ? f.could_ask_questions[0].toUpperCase() + f.could_ask_questions.slice(1) : '—'}</div>
                  <div><strong>Understood Material:</strong> {f.understood_material ? f.understood_material[0].toUpperCase() + f.understood_material.slice(1) : '—'}</div>
                  <div><strong>Needs Additional Training:</strong> {f.needs_additional_training ? f.needs_additional_training[0].toUpperCase() + f.needs_additional_training.slice(1) : '—'}</div>
                </div>
                {/* Left by trainees who need more training, so the office can reach out (2026-10-05). */}
                {f.contact_name && (
                  <p style={{ fontSize: 13, margin: '8px 0 0', color: 'var(--status-expiring-text, #a15c00)' }}>
                    <strong>Asked for additional training:</strong> {f.contact_name}
                  </p>
                )}
                {(f.trainer_ratings || []).some((r) => r.comment)
                  ? f.trainer_ratings.filter((r) => r.comment).map((r) => (
                    <p key={r.id} style={{ fontSize: 13, margin: '8px 0 0', fontStyle: 'italic' }}>
                      {f.trainer_ratings.length > 1 && <span style={{ fontStyle: 'normal', fontWeight: 600 }}>About {r.trainer_name}: </span>}&ldquo;{r.comment}&rdquo;
                    </p>
                  ))
                  : f.trainer_comment && (
                    <p style={{ fontSize: 13, margin: '8px 0 0', fontStyle: 'italic' }}>&ldquo;{f.trainer_comment}&rdquo;</p>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && <FeedbackQuestionsEditor />}
      {isAdmin && <TrainerClosePinEditor />}
    </div>
  );
}
