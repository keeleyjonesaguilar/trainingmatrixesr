import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import EmployeeCompliancePanel from '../components/EmployeeCompliancePanel.jsx';
import LoadingState from '../components/LoadingState.jsx';
import MergeWithProfileModal from '../components/MergeWithProfileModal.jsx';
import { easternToday, formatEasternDate } from '../lib/dates.js';
import { displayFirstLast, nameParts } from '../lib/names.js';

// Live-formats a phone number as (xxx) xxx-xxxx while typing. This is the standard US format
// Keeley wants - Employee Phone Number is now how employees are tracked/identified.
function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function EmployeeProfileEditor({ employee, isAdmin, teaches, onSaved, onCancel }) {
  const initialName = nameParts(employee);
  const [form, setForm] = useState({
    first_name: initialName.first,
    last_name: initialName.last,
    job_title: employee.job_title || '',
    employee_number: employee.employee_number || '',
    email: employee.email || '',
    active: employee.active,
    aha_instructor_id: employee.aha_instructor_id || '',
    is_trainer: Boolean(employee.is_trainer) || employee.employee_type === 'trainer',
    trainer_type: employee.trainer_type || employee.trainer_type_effective || 'internal',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    // Name changes are admin-only on the server too - only send them when they can apply.
    const { first_name, last_name, ...rest } = form;
    if (isAdmin && (!first_name.trim() || !last_name.trim())) {
      setError('First and last name are required.');
      setSaving(false);
      return;
    }
    try {
      await api.updateEmployee(employee.employee_id, isAdmin ? { ...rest, first_name: first_name.trim(), last_name: last_name.trim() } : rest);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      {error && <div className="error-banner">{error}</div>}
      <div className="toolbar">
        {isAdmin && (
          <>
            <div className="field-row">
              <label>First Name</label>
              <input type="text" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div className="field-row">
              <label>Last Name</label>
              <input type="text" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </>
        )}
        <div className="field-row">
          <label>Employee Phone Number</label>
          <input
            type="text"
            placeholder="(xxx) xxx-xxxx"
            value={form.employee_number}
            onChange={(e) => setForm({ ...form, employee_number: formatPhoneInput(e.target.value) })}
          />
        </div>
        <div className="field-row">
          <label>Role / Trade</label>
          <input type="text" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
        </div>
        <div className="field-row">
          <label>Email</label>
          <input type="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {teaches && (
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
              Session documents are emailed here when this trainer closes out a session.
            </p>
          )}
        </div>
        {isAdmin && teaches && (
          <div className="field-row">
            <label>AHA Instructor ID#</label>
            <input
              type="text"
              placeholder="e.g. 123456789"
              value={form.aha_instructor_id}
              onChange={(e) => setForm({ ...form, aha_instructor_id: e.target.value })}
            />
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
              Only needed for trainers who teach First Aid/CPR/AED - printed on the AHA Course Roster.
            </p>
          </div>
        )}
        {/* Marks them as a trainer (Keeley's request, 2026-10-06): they can be picked to teach a
            session, get the trainer view in the ESR Training Portal, and - if they also have an
            office login with this same email - see the Trainer Portal link in the nav. */}
        {isAdmin && (
          <div className="field-row">
            <label>Trainer</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, height: 'var(--control-height)' }}>
              <input
                type="checkbox"
                checked={form.is_trainer}
                disabled={employee.employee_type === 'trainer'}
                onChange={(e) => setForm({ ...form, is_trainer: e.target.checked })}
              />
              This person is a trainer
            </label>
          </div>
        )}
        {/* Internal (one of ours) or External (Keeley's request, 2026-10-07) - only Internal
            trainers' sessions get the session prep step. */}
        {isAdmin && form.is_trainer && (
          <div className="field-row">
            <label>Trainer Type</label>
            <select value={form.trainer_type} onChange={(e) => setForm({ ...form, trainer_type: e.target.value })}>
              <option value="internal">Internal</option>
              <option value="external">External</option>
            </select>
          </div>
        )}
        {isAdmin && (
          <div className="field-row">
            <label>Status</label>
            <select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
        )}
      </div>
      <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button>{' '}
      <button className="secondary" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// A trainer's aggregate feedback rating, pulled from session_feedback across every session
// they've taught (Keeley's request) - not just their most recent session.
function TrainerRatingSummary({ summary }) {
  if (!summary || !summary.response_count) {
    return (
      <div className="card">
        <h2>Overall Trainer Rating</h2>
        <p className="page-subtitle" style={{ margin: 0 }}>No feedback responses yet.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Overall Trainer Rating</h2>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Trainer Rating</div>
          <div className="value">★ {summary.avg_trainer_rating.toFixed(1)}</div>
          <span className="caption">out of 5</span>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Training Effectiveness</div>
          <div className="value">★ {summary.avg_effectiveness_rating.toFixed(1)}</div>
          <span className="caption">out of 5</span>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Responses</div>
          <div className="value">{summary.response_count}</div>
        </div>
      </div>
    </div>
  );
}

// Every written comment trainees left for this trainer, newest first (Keeley's request,
// 2026-09-30: "capture the notes/comments ... show on the matrix for their profiles for us to
// review"). Feedback is anonymous, so each comment is tied to its session, not a trainee.
const COMMENTS_SHOWN = 10;
function TrainerFeedbackComments({ comments }) {
  const [showAll, setShowAll] = useState(false);
  const list = comments || [];
  const shown = showAll ? list : list.slice(0, COMMENTS_SHOWN);
  const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  return (
    <div className="card profile-full">
      <h2>Trainee Feedback Comments ({list.length})</h2>
      {list.length === 0 ? (
        <div className="empty-state">No written comments yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((c) => (
            <div key={c.feedback_id} style={{ borderLeft: '3px solid var(--esr-gold)', background: 'var(--color-bg)', padding: '10px 14px', borderRadius: '0 4px 4px 0' }}>
              <div style={{ fontStyle: 'italic', fontSize: 14 }}>&ldquo;{c.trainer_comment}&rdquo;</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span>Trainer <span style={{ color: 'var(--esr-gold)' }}>{starText(c.trainer_rating)}</span></span>
                <span>Effectiveness <span style={{ color: 'var(--esr-gold)' }}>{starText(c.effectiveness_rating)}</span></span>
                {c.needs_additional_training === 'yes' && <span className="badge badge-expiringsoon">Needs additional training</span>}
                <span>
                  <Link to={`/sessions/${c.session_id}`}>{c.training_type_label}</Link> · {c.client_name} · {c.session_date}
                </span>
              </div>
            </div>
          ))}
          {list.length > COMMENTS_SHOWN && (
            <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)} style={{ alignSelf: 'flex-start' }}>
              {showAll ? 'Show fewer' : `Show all ${list.length} comments`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A trainer's own list of sessions they've taught, linking each to its SessionDetail page.
function TrainingsTaughtSection({ employeeId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listTrainingSessions({ trainer_employee_id: employeeId }).then(setSessions).catch(() => {}).finally(() => setLoading(false));
  }, [employeeId]);

  // Upcoming = still open and dated today or later (Keeley's request, 2026-09-22) - same
  // definition as the Sessions page's "X Upcoming" badge, but on Eastern time so a session
  // doesn't flip to "past" at 8 PM. Soonest first; everything else stays under Trainings Taught.
  const today = easternToday();
  const upcoming = sessions
    .filter((s) => s.status === 'open' && s.session_date >= today)
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
  const taught = sessions.filter((s) => !upcoming.includes(s));

  return (
    <div className="profile-row">
      <div className="card">
        <h2>Upcoming Trainings to Teach ({upcoming.length})</h2>
        {loading ? <LoadingState label="Loading sessions..." /> : upcoming.length === 0 ? (
          <div className="empty-state">No upcoming sessions scheduled.</div>
        ) : (
          <table>
            <thead><tr><th>Date</th><th>Client</th><th>Training</th><th>Location</th></tr></thead>
            <tbody>
              {upcoming.map((s) => (
                <tr key={s.session_id}>
                  <td><Link to={`/sessions/${s.session_id}`}>{s.session_date}</Link></td>
                  <td>{s.client_name}</td>
                  <td>{s.training_type_label}</td>
                  <td>{s.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Trainings Taught ({taught.length})</h2>
        {loading ? <LoadingState label="Loading sessions..." /> : taught.length === 0 ? (
          <div className="empty-state">No sessions taught yet.</div>
        ) : (
          <table>
            <thead><tr><th>Date</th><th>Client</th><th>Training</th><th>Attendees</th></tr></thead>
            <tbody>
              {taught.map((s) => (
                <tr key={s.session_id}>
                  <td><Link to={`/sessions/${s.session_id}`}>{s.session_date}</Link></td>
                  <td>{s.client_name}</td>
                  <td>{s.training_type_label}</td>
                  <td>{s.attendee_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// General supporting documents on an employee's own record (Keeley's request, 2026-09-22) - an
// existing OSHA/CPR card, a medical eval, etc., not tied to one specific training completion the
// way a certificate-of-completion upload is (see the Completed Trainings table below instead).
// The employee's own QR code (Keeley's request, 2026-09-30) - scanning it opens a read-only page
// of their current trainings (pages/PublicRecord.jsx), e.g. printed on a badge or hard-hat sticker.
// Sits in the profile header (her follow-up: the standalone card sat awkwardly mid-page); Reset is
// a small link that only goes through once "reset" is typed, so it can't happen by accident.
function RecordQrBadge({ employeeId, employeeName, isAdmin }) {
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const src = `/api/employees/${employeeId}/record-qr.png?v=${version}`;

  const open = async () => {
    const tab = window.open('', '_blank');
    try {
      const { path } = await api.getEmployeeRecordLink(employeeId);
      tab.location = `${window.location.origin}${path}`;
    } catch (e) {
      tab?.close();
      setError(e.message);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await api.resetEmployeeRecordToken(employeeId);
      setVersion((v) => v + 1);
      setConfirming(false);
      setTyped('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const linkStyle = { background: 'none', border: 'none', padding: 0, color: 'var(--esr-green)', cursor: 'pointer', fontSize: 12, textAlign: 'left' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button type="button" className="qr-thumb-button" onClick={open} title="Open their training record page" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }}>
        <img src={src} alt={`QR code for ${employeeName}`} style={{ width: 72, height: 72, borderRadius: 6, border: '1px solid var(--color-border)' }} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
        <span className="detail-meta-label">Training Record QR</span>
        <a href={src} download={`${employeeName} QR Code.png`} style={{ fontSize: 12, color: 'var(--esr-green)' }}>Download</a>
        <button type="button" className="link-button" onClick={open} style={linkStyle}>Open record page</button>
        {isAdmin && !confirming && (
          <button type="button" className="link-button" onClick={() => setConfirming(true)} style={{ ...linkStyle, fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'left' }}>
            Reset code…
          </button>
        )}
        {isAdmin && confirming && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2, maxWidth: 220 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              The current code (e.g. on a printed badge) stops working. Type <strong>reset</strong> to confirm.
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Type reset to confirm"
                style={{ width: 90, padding: '2px 6px', fontSize: 12 }}
                autoFocus
              />
              <button type="button" className="secondary" disabled={busy || typed.trim().toLowerCase() !== 'reset'} onClick={reset} style={{ padding: '2px 8px', fontSize: 12 }}>
                {busy ? '…' : 'Reset'}
              </button>
              <button type="button" className="link-button" onClick={() => { setConfirming(false); setTyped(''); }} style={{ ...linkStyle, fontSize: 11, color: 'var(--color-text-muted)' }}>Cancel</button>
            </div>
          </div>
        )}
        {error && <span style={{ fontSize: 11, color: 'var(--status-expired-text)' }}>{error}</span>}
      </div>
    </div>
  );
}

// ESR Training Portal access (Keeley's request, 2026-09-30: invite-only). Inviting emails them a
// link; they sign in with this profile's email and a one-time code (pages/Portal.jsx).
function PortalAccess({ employee, isAdmin, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState('');
  const invited = Boolean(employee.portal_invited_at);

  const invite = async () => {
    setBusy(true); setMessage('');
    try {
      await api.invitePortal(employee.employee_id);
      setMessage(invited ? 'Invite sent again.' : 'Invite sent.');
      onChanged();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setMessage('');
    try {
      await api.removePortal(employee.employee_id);
      setConfirmRemove(false);
      onChanged();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="detail-meta-item" style={{ textAlign: 'left' }}>
      <div className="detail-meta-label">Training Portal</div>
      <div className="detail-meta-value">
        {invited
          ? `Invited ${formatEasternDate(employee.portal_invited_at)}${employee.portal_last_login_at ? ` · last sign-in ${formatEasternDate(employee.portal_last_login_at)}` : ' · not signed in yet'}`
          : 'Not invited'}
      </div>
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
          <button type="button" className="link-button" disabled={busy || !employee.email} onClick={invite} title={employee.email ? '' : 'Add an email to this profile first'}>
            {invited ? 'Resend invite' : 'Invite to portal'}
          </button>
          {invited && !confirmRemove && <button type="button" className="link-button" onClick={() => setConfirmRemove(true)}>Remove access</button>}
          {invited && confirmRemove && (
            <>
              <button type="button" className="link-button" disabled={busy} onClick={remove} style={{ color: 'var(--status-expired-text)' }}>Yes, remove</button>
              <button type="button" className="link-button" onClick={() => setConfirmRemove(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
      {!employee.email && isAdmin && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Needs an email on the profile.</div>}
      {message && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{message}</div>}
    </div>
  );
}

function EmployeeDocumentsSection({ employeeId, isAdmin, trainingOptions = [] }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [trainingId, setTrainingId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  // The chosen file waits here until Submit (Keeley's request, 2026-09-30: not the moment it's picked).
  const [pendingFile, setPendingFile] = useState(null);
  const inputRef = useRef(null);

  const load = () => {
    api.listEmployeeDocuments(employeeId).then(setDocuments).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) { setPendingFile(file); setError(''); }
  };

  const submit = async () => {
    if (!pendingFile) return setError('Choose a file first.');
    if (!label.trim()) return setError('Enter a label for this document (e.g. "OSHA 10 Card").');
    setUploading(true);
    setError('');
    try {
      await api.uploadEmployeeDocument(employeeId, pendingFile, label.trim(), trainingId);
      setLabel('');
      setTrainingId('');
      setPendingFile(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (documentId) => {
    if (!window.confirm('Delete this document?')) return;
    setDeletingId(documentId);
    try {
      await api.deleteEmployeeDocument(employeeId, documentId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="card">
      <h2>Documents ({documents.length})</h2>
      <p className="page-subtitle" style={{ marginTop: -8 }}>
        Existing OSHA/CPR cards, medical evaluations, or anything else worth keeping on file for this employee.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {loading ? <LoadingState label="Loading documents..." /> : (
        <>
          {documents.length === 0 ? (
            <div className="empty-state">No documents on file yet.</div>
          ) : (
            <table>
              <thead><tr><th>Label</th><th>Training</th><th>Uploaded</th><th></th></tr></thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.document_id}>
                    <td>
                      <a href={api.getEmployeeDocumentUrl(employeeId, d.document_id)} target="_blank" rel="noreferrer">{d.label}</a>
                    </td>
                    <td>{d.training_id ? `${d.training_id} - ${d.training_name}` : '—'}</td>
                    <td>{formatEasternDate(d.uploaded_at)}</td>
                    <td>
                      {isAdmin && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          disabled={deletingId === d.document_id}
                          onClick={() => deleteDocument(d.document_id)}
                        >
                          {deletingId === d.document_id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isAdmin && (
            <div className="field-row" style={{ marginTop: 12 }}>
              <label>Add a Document</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Label, e.g. OSHA 10 Card"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  style={{ flexGrow: 1 }}
                />
                <button type="button" className="secondary" disabled={uploading} onClick={() => inputRef.current?.click()} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {pendingFile ? 'Change File' : 'Choose File'}
                </button>
              </div>
              {/* Optional (Keeley's request, 2026-09-22) - e.g. a CPR card to First Aid/CPR/AED. Only
                  trainings already on this employee's profile are offered (2026-09-30). */}
              <select value={trainingId} onChange={(e) => setTrainingId(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">{trainingOptions.length ? 'Attach to one of their trainings (optional)' : 'No trainings on their profile yet'}</option>
                {trainingOptions.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', flexGrow: 1, overflowWrap: 'anywhere' }}>
                  {pendingFile ? `Selected: ${pendingFile.name}` : 'No file selected'}
                </span>
                {pendingFile && (
                  <button type="button" className="secondary" disabled={uploading} onClick={() => setPendingFile(null)}>Cancel</button>
                )}
                <button type="button" disabled={uploading || !pendingFile} onClick={submit}>
                  {uploading ? 'Uploading...' : 'Submit'}
                </button>
              </div>
              <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function EmployeeDetail() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivateConfirmText, setDeactivateConfirmText] = useState('');
  const [trainers, setTrainers] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);

  useEffect(() => { api.listTrainers().then(setTrainers).catch(() => {}); }, []);

  const load = () => {
    api.getEmployeeFullDetail(employeeId).then(setDetail).catch((e) => setError(e.message));
  };

  useEffect(load, [employeeId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!detail) return <div className="empty-state">Loading...</div>;

  const { employee, client, trainings, completedRecords, trainerFeedbackSummary, teaches } = detail;

  // The stat tiles are compliance-style counts - "how many training TYPES is this person
  // currently current/expiring/expired on" - so they're based on the one-cell-per-type view
  // (`trainings`), not the full per-completion list; completing the same training twice
  // shouldn't double-count it here. Every completed record still shows, every time, in the
  // Completed Trainings table below (Keeley's call: a training taken more than once - a re-cert,
  // or Day 1/Day 2 of a multi-day course - is normal history, never collapsed to just the latest).
  const typeCells = trainings.filter((t) => t.completion_date);
  const stats = {
    validCount: typeCells.filter((t) => t.status === 'Current' || t.status === 'No Expiration').length,
    expiringSoonCount: typeCells.filter((t) => t.expiring_soon).length,
    expiredCount: typeCells.filter((t) => t.status === 'Expired').length,
  };

  const history = completedRecords.slice(0, 6);

  const deleteEmployee = async () => {
    await api.deleteEmployee(employee.employee_id);
    navigate('/matrix');
  };

  const deactivateEmployee = async () => {
    await api.updateEmployee(employee.employee_id, { active: false });
    setConfirmingDeactivate(false);
    setDeactivateConfirmText('');
    load();
  };

  const reactivateEmployee = async () => {
    await api.updateEmployee(employee.employee_id, { active: true });
    load();
  };

  const isTrainer = employee.employee_type === 'trainer';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{employee.full_name} {employee.employee_number ? `(${employee.employee_number})` : ''}</h1>
        </div>
        <div className="page-header-actions">
          <button className="secondary" onClick={() => navigate('/matrix')}>Back to Employees</button>
          {isAdmin && employee.active && (
            <button className="secondary" onClick={() => setConfirmingDeactivate(true)}>Deactivate Employee</button>
          )}
          {isAdmin && !employee.active && (
            <button className="secondary" onClick={reactivateEmployee}>Reactivate Employee</button>
          )}
          {isAdmin && <button className="secondary" onClick={() => setShowMergeModal(true)}>Merge With Another Profile</button>}
          {isAdmin && !confirmingDelete && <button className="danger" onClick={() => setConfirmingDelete(true)}>Delete Employee</button>}
        </div>
      </div>

      {showMergeModal && (
        <MergeWithProfileModal
          employee={{ ...employee, client_name: isTrainer ? `${employee.trainer_type_effective === 'external' ? 'External' : 'Internal'} Trainer` : client?.client_name }}
          onMerged={(winnerId) => {
            setShowMergeModal(false);
            // This profile may have been the one that got merged away - its own id is gone, so
            // reloading the same URL would 404. Land on the surviving profile instead.
            if (winnerId !== employee.employee_id) navigate(`/employees/${winnerId}`);
            else load();
          }}
          onCancel={() => setShowMergeModal(false)}
        />
      )}

      {confirmingDeactivate && (
        <div className="card">
          <h2>Deactivate Employee</h2>
          <p className="page-subtitle">
            {employee.full_name} will no longer appear as an active employee. Their records aren't touched, and this can be undone any time.
          </p>
          <div className="field-row">
            <label>Type "deactivate" to confirm</label>
            <input type="text" value={deactivateConfirmText} onChange={(e) => setDeactivateConfirmText(e.target.value)} />
          </div>
          <button
            className="secondary"
            disabled={deactivateConfirmText.trim().toLowerCase() !== 'deactivate'}
            onClick={deactivateEmployee}
          >
            Confirm Deactivate
          </button>{' '}
          <button className="secondary" onClick={() => { setConfirmingDeactivate(false); setDeactivateConfirmText(''); }}>Cancel</button>
        </div>
      )}

      {confirmingDelete && (
        <div className="card">
          <h2>Delete Employee</h2>
          <p className="page-subtitle">
            Permanently deletes {employee.full_name} and all of their training records. This cannot be undone.
          </p>
          <div className="field-row">
            <label>Type "delete" to confirm</label>
            <input type="text" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} />
          </div>
          <button
            className="danger"
            disabled={deleteConfirmText.trim().toLowerCase() !== 'delete'}
            onClick={deleteEmployee}
          >
            Permanently Delete
          </button>{' '}
          <button className="secondary" onClick={() => { setConfirmingDelete(false); setDeleteConfirmText(''); }}>Cancel</button>
        </div>
      )}
      {editingProfile ? (
        <EmployeeProfileEditor
          employee={employee}
          isAdmin={isAdmin}
          teaches={teaches}
          onSaved={() => { setEditingProfile(false); load(); }}
          onCancel={() => setEditingProfile(false)}
        />
      ) : (
        <div className="card detail-header-card">
          <div className="detail-identity">
            <div className="detail-avatar">{employee.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div>
              <div className="detail-name">{employee.full_name}</div>
              {/* A trainer profile shows Internal/External Trainer instead of a client (Keeley's request,
                  2026-10-07); someone who's also an employee keeps their company too. */}
              <div className="detail-sub">
                {[
                  employee.job_title || 'Role not set',
                  isTrainer ? null : client?.client_name,
                  teaches && employee.trainer_type_effective ? `${employee.trainer_type_effective === 'external' ? 'External' : 'Internal'} Trainer` : null,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div className="detail-meta">
            <div className="detail-meta-item">
              <div className="detail-meta-label">Employee Phone Number</div>
              <div className="detail-meta-value">{employee.employee_number || '—'}</div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-label">Email</div>
              <div className="detail-meta-value">{employee.email || '—'}</div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-label">Status</div>
              <div className="detail-meta-value">{employee.active ? 'Active' : 'Inactive'}</div>
            </div>
            <PortalAccess employee={employee} isAdmin={isAdmin} onChanged={load} />
          </div>
          <RecordQrBadge employeeId={employee.employee_id} employeeName={displayFirstLast(employee)} isAdmin={isAdmin} />
          <button className="secondary" onClick={() => setEditingProfile(true)}>Edit Profile</button>
        </div>
      )}

      {/* Layout (Keeley's request, 2026-09-22: "the employee page UI is a little wide"): the short
          summary cards sit side by side up top, and the 9-column Completed Trainings table gets
          the full page width below instead of being squeezed into two-thirds of it. */}
      <div className="profile-row">
        {teaches && <TrainerRatingSummary summary={trainerFeedbackSummary} />}
        <div className="card">
          <h2>Recent Completions</h2>
          <div className="activity-feed">
            {history.map((t) => (
              <div key={t.record_id} className="activity-item">
                <div>
                  <div className="activity-item-title">{t.training_name}</div>
                  <div className="activity-item-desc">Completed {t.completion_date}</div>
                </div>
                <div className="activity-item-time">{t.status}</div>
              </div>
            ))}
            {history.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>No completion history yet.</p>}
          </div>
        </div>
        <EmployeeDocumentsSection
          employeeId={employee.employee_id}
          isAdmin={isAdmin}
          trainingOptions={[...new Map(completedRecords.map((r) => [r.training_id, { training_id: r.training_id, training_name: r.master_training_name || r.training_name }])).values()]
            .sort((a, b) => a.training_id.localeCompare(b.training_id))}
        />
      </div>

      {/* Anyone who has taught, including a trainer merged into their employee profile. */}
      {teaches && <TrainingsTaughtSection employeeId={employee.employee_id} />}
      {teaches && <TrainerFeedbackComments comments={trainerFeedbackSummary?.comments} />}

      <div className="profile-full">
          <EmployeeCompliancePanel
            employee={employee}
            client={client}
            stats={stats}
            completedRecords={completedRecords}
            trainingOptions={trainings}
            trainers={trainers}
            isAdmin={isAdmin}
            onReload={load}
            collapsible={false}
            heading={isTrainer ? 'Trainings Obtained' : 'Completed Trainings'}
          />
      </div>
    </div>
  );
}
