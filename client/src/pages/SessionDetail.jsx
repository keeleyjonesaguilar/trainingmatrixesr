import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

function RecordStatusBadge({ status }) {
  const labels = {
    linked: 'Added to employee file',
    no_catalog_match: 'Employee on file (no catalog match)',
    failed: 'Needs attention',
    pending: 'Processing…',
  };
  const classes = {
    linked: 'badge-current',
    no_catalog_match: 'badge-pendingreview',
    failed: 'badge-expired',
    pending: 'badge-pendingreview',
  };
  return <span className={`badge ${classes[status] || 'badge-notapplicable'}`}>{labels[status] || status}</span>;
}

// Admin-only edit of the session's own metadata (client/trainer/date/outline/location/
// duration) after creation. Client and Training Type are selects here (not free text like the
// create form) so a typo can't silently spawn a new client mid-edit.
// trainer_name is stored as one combined field - split naively (first word / everything else)
// just to seed the two edit inputs; not meant to be a robust name parser.
function splitTrainerName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
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
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateTrainingSession(session.session_id, {
        ...form,
        trainer_name: `${form.trainer_first_name.trim()} ${form.trainer_last_name.trim()}`.trim(),
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
          <select
            value={form.master_training_id}
            onChange={(e) => {
              const t = trainings.find((x) => x.training_id === e.target.value);
              setForm({
                ...form,
                master_training_id: e.target.value,
                training_type_label: t ? `${t.training_id} - ${t.training_name}` : form.training_type_label,
              });
            }}
            required
          >
            <option value="">Select a training…</option>
            {trainings.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
          </select>
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
      </div>
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

export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [retryingId, setRetryingId] = useState(null);
  const [editingSession, setEditingSession] = useState(false);
  const [clients, setClients] = useState([]);
  const [trainings, setTrainings] = useState([]);

  const load = () => {
    api.getTrainingSession(id).then(setSession).catch((err) => setError(err.message));
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
    await api.updateSessionAttendee(id, attendeeId, { trainee_name: editName, trainee_phone: editPhone });
    setEditingId(null);
    load();
  };

  const removeAttendee = async (attendeeId) => {
    if (!window.confirm('Remove this sign-in entry?')) return;
    await api.deleteSessionAttendee(id, attendeeId);
    load();
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
      </h1>
      <p className="page-subtitle">
        {session.client_name} · {session.session_date} · Trainer: {session.trainer_signed_name || session.trainer_name}
        {session.location ? ` · ${session.location}` : ''}
        {session.duration ? ` · ${session.duration}` : ''}{' '}
        · <span className={`badge badge-${session.status}`}>{session.status === 'open' ? 'Open' : 'Closed'}</span>
        {session.language && session.language !== 'english' && (
          <>{' '}· <span className="badge badge-noexpiration">{session.language === 'both' ? 'English/Spanish' : 'Spanish'}</span></>
        )}
        {isAdmin && !editingSession && (
          <>{' '}· <button type="button" className="link-button" onClick={() => setEditingSession(true)}>Edit session details</button></>
        )}
      </p>

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

            {session.status === 'closed' && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a href={`/api/training-sessions/${id}/roster.pdf`} className="btn btn-sm" style={{ justifyContent: 'center' }}>
                  Download Roster (PDF)
                </a>
                <a
                  href={`/api/training-sessions/${id}/roster.csv`}
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                >
                  Export Roster (CSV)
                </a>
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
          </div>
        </div>

        <div className="card">
          {session.outline && (
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>Outline</strong>
              <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>{session.outline}</p>
            </div>
          )}
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Roster ({session.attendees.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
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
                      <td colSpan={2}>
                        <button className="btn btn-sm" onClick={() => saveEdit(a.attendee_id)}>
                          Save
                        </button>{' '}
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{a.employee_id ? <Link to={`/employees/${a.employee_id}`}>{a.trainee_name}</Link> : a.trainee_name}</td>
                      <td>{a.trainee_phone || '—'}</td>
                      <td>{new Date(a.signed_at).toLocaleString()}</td>
                      {session.status === 'closed' && (
                        <td>
                          {a.certificate_path ? (
                            <a href={`/api/training-sessions/${id}/attendees/${a.attendee_id}/certificate.pdf`}>Download</a>
                          ) : (
                            '—'
                          )}
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
                            }}
                          >
                            Edit
                          </button>{' '}
                          <button className="btn btn-danger btn-sm" onClick={() => removeAttendee(a.attendee_id)}>
                            Remove
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
          {session.feedback.some((f) => f.trainer_comment) && (
            <>
              <strong style={{ fontSize: 13 }}>Comments</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {session.feedback.filter((f) => f.trainer_comment).map((f) => (
                  <li key={f.feedback_id} style={{ marginBottom: 4 }}>{f.trainer_comment}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
