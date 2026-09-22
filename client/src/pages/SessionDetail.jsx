import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { parseName } from '../lib/names.js';
import { useIsAdmin } from '../authContext.jsx';
import { formatEasternDateTime, sequentialDates, formatShortDate } from '../lib/dates';
import { TrainingSearchSelect } from '../components/TrainingSearchSelect.jsx';
import SignaturePad from '../components/SignaturePad.jsx';

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
    duration: session.duration || '',
    outline: session.outline || '',
    language: session.language || 'english',
    total_days: session.total_days || '',
  });
  // The actual calendar date scheduled for each day of a multi-day session (Keeley's request,
  // 2026-09-22) - purely informational, editable independently of total_days.
  const [dayDates, setDayDates] = useState(session.day_dates || []);
  // Per-day outline text (Keeley's request, 2026-09-22: "Day 1 has its own outline, day 2 and
  // so on").
  const [dayOutlines, setDayOutlines] = useState(session.day_outlines || []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    if (form.total_days && dayDates.some((d) => !d)) {
      setError('Enter a scheduled date for every day.');
      setSaving(false);
      return;
    }
    if (form.total_days && dayOutlines.some((o) => !o.trim())) {
      setError('Enter an outline for every day.');
      setSaving(false);
      return;
    }
    try {
      const updated = await api.updateTrainingSession(session.session_id, {
        ...form,
        trainer_name: `${form.trainer_first_name.trim()} ${form.trainer_last_name.trim()}`.trim(),
        day_dates: form.total_days ? dayDates : null,
        day_outlines: form.total_days ? dayOutlines : null,
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
          <label>Date</label>
          <input type="date" value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} required />
        </div>
        <div className="field">
          <label>Location / Address</label>
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="123 Main St, Suite 4" required />
        </div>
        <div className="field">
          <label>Duration</label>
          <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="e.g. 4 hours, Half day" required />
        </div>
        <div className="field">
          <label>Sign-In Language</label>
          <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} required>
            <option value="english">English</option>
            <option value="spanish">Spanish</option>
            <option value="both">Both (English/Spanish)</option>
          </select>
        </div>
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
            }}
            placeholder="Leave blank for single-day"
          />
        </div>
      </div>
      {form.total_days && dayDates.length > 0 && (
        <div className="field">
          <label>Scheduled Dates</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {dayDates.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Day {i + 1}</span>
                <input
                  type="date"
                  value={d}
                  onChange={(e) => setDayDates((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                  style={{ maxWidth: 150 }}
                  required
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {form.total_days && dayOutlines.length > 0 && (
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

  const removeAttendee = async (attendeeId) => {
    if (!window.confirm('Remove this sign-in entry?')) return;
    setRemovingId(attendeeId);
    try {
      await api.deleteSessionAttendee(id, attendeeId);
      load();
    } finally {
      setRemovingId(null);
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
        {session.training_type_label}
        {session.additional_trainings?.map((t) => (
          <span key={t.id}> + {t.training_type_label}</span>
        ))}
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
        <div className="session-fact">
          <div className="session-fact-label">Trainer</div>
          <div className="session-fact-value">
            {session.trainer_signed_name || session.trainer_name}
            {session.trainer_email && <div className="session-fact-sub">{session.trainer_email}</div>}
          </div>
        </div>
        {session.location && (
          <div className="session-fact">
            <div className="session-fact-label">Location</div>
            <div className="session-fact-value">{session.location}</div>
          </div>
        )}
        {session.duration && (
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
              Day {session.current_day} of {session.total_days}
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

      {/* Multi-day training (Keeley's request, 2026-09-21/22) - the day advance is manual
          (never calendar-driven), so it survives a course slipping a day for weather/a holiday
          without misjudging attendance. New sign-ins and "find your name" check-ins always
          attach to whichever day is current at the moment they happen. */}
      {session.total_days && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14 }}>Attendance by Day</h3>
              <p className="page-subtitle" style={{ margin: '2px 0 0' }}>
                One QR code covers all {session.total_days} days. Certificates only generate for attendees present every day.
              </p>
            </div>
            {isAdmin && session.status === 'open' && (
              <button
                className="btn btn-accent btn-sm"
                disabled={advancingDay || session.current_day >= session.total_days}
                onClick={advanceDay}
              >
                {advancingDay
                  ? 'Opening…'
                  : session.current_day >= session.total_days
                    ? `On Final Day (${session.total_days})`
                    : `Open Day ${session.current_day + 1} →`}
              </button>
            )}
          </div>
          {session.day_outlines?.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {session.day_outlines.map((o, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <strong>Day {i + 1}{session.day_dates?.[i] ? ` (${formatShortDate(session.day_dates[i])})` : ''}:</strong>{' '}
                  <span style={{ color: 'var(--color-text-muted)' }}>{o}</span>
                </div>
              ))}
            </div>
          )}
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Employee</th>
                {Array.from({ length: session.total_days }, (_, i) => i + 1).map((d) => (
                  <th key={d} style={{ textAlign: 'center' }}>
                    Day {d}
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
                    {Array.from({ length: session.total_days }, (_, i) => i + 1).map((d) => (
                      <td key={d} style={{ textAlign: 'center' }}>
                        {daysAttended.includes(d) ? (
                          <span style={{ color: 'var(--status-current-text)', fontWeight: 700 }}>✓</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        )}
                      </td>
                    ))}
                    <td>
                      {session.status === 'closed' ? (
                        <RecordStatusBadge status={a.processing_status} />
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
                {/* One ZIP per training (Keeley's request, 2026-09-17) - a session covering just
                    one training (the normal case) gets a single button; 2+ trainings taught
                    together get one button each, since certificates are never mixed types in
                    the same ZIP. Every certificate inside is already named "Training Title_
                    Client_Trainer_Date_Trainee Name.pdf" - nothing to rename by hand. */}
                <a
                  href={`/api/training-sessions/${id}/certificates.zip?training=primary`}
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                >
                  Download {session.additional_trainings?.length ? `"${session.training_type_label}"` : 'All'} Certificates (ZIP)
                </a>
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
                {session.status === 'closed' && <th>Certificate</th>}
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
                      {session.status === 'closed' && (
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
                          <RecordStatusBadge status={a.processing_status} />
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
                          <button className="btn btn-danger btn-sm" disabled={removingId === a.attendee_id} onClick={() => removeAttendee(a.attendee_id)}>
                            {removingId === a.attendee_id ? 'Removing…' : 'Remove'}
                          </button>
                        </td>
                      )}
                      {session.status === 'closed' && isAdmin && (
                        <td>
                          {(a.processing_status === 'failed' || a.processing_status === 'no_catalog_match') && (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={retryingId === a.attendee_id}
                              onClick={() => retryProcessing(a.attendee_id)}
                            >
                              {retryingId === a.attendee_id ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
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
                  <div><strong>Trainer Rating:</strong> {'★'.repeat(f.trainer_rating)}{'☆'.repeat(5 - f.trainer_rating)}</div>
                  <div><strong>Could Ask Questions:</strong> {f.could_ask_questions ? f.could_ask_questions[0].toUpperCase() + f.could_ask_questions.slice(1) : '—'}</div>
                  <div><strong>Understood Material:</strong> {f.understood_material ? f.understood_material[0].toUpperCase() + f.understood_material.slice(1) : '—'}</div>
                  <div><strong>Needs Additional Training:</strong> {f.needs_additional_training ? f.needs_additional_training[0].toUpperCase() + f.needs_additional_training.slice(1) : '—'}</div>
                </div>
                {f.trainer_comment && (
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
