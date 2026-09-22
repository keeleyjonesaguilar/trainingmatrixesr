import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import EmployeeCompliancePanel from '../components/EmployeeCompliancePanel.jsx';
import LoadingState from '../components/LoadingState.jsx';
import MergeWithProfileModal from '../components/MergeWithProfileModal.jsx';
import { EASTERN_TZ } from '../lib/dates.js';

// Live-formats a phone number as (xxx) xxx-xxxx while typing. This is the standard US format
// Keeley wants - Employee Phone Number is now how employees are tracked/identified.
function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function EmployeeProfileEditor({ employee, isAdmin, onSaved, onCancel }) {
  const isTrainer = employee.employee_type === 'trainer';
  const [form, setForm] = useState({
    job_title: employee.job_title || '',
    employee_number: employee.employee_number || '',
    email: employee.email || '',
    active: employee.active,
    aha_instructor_id: employee.aha_instructor_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateEmployee(employee.employee_id, form);
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
          {isTrainer && (
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
              Session documents are emailed here when this trainer closes out a session.
            </p>
          )}
        </div>
        {isAdmin && isTrainer && (
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN_TZ }).format(new Date());
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
function EmployeeDocumentsSection({ employeeId, isAdmin, trainingOptions = [] }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [trainingId, setTrainingId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const inputRef = useRef(null);

  const load = () => {
    api.listEmployeeDocuments(employeeId).then(setDocuments).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [employeeId]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!label.trim()) {
      setError('Enter a label for this document first (e.g. "OSHA 10 Card").');
      return;
    }
    setUploading(true);
    setError('');
    try {
      await api.uploadEmployeeDocument(employeeId, file, label.trim(), trainingId);
      setLabel('');
      setTrainingId('');
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
                    <td>{d.uploaded_at?.slice(0, 10)}</td>
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
                <button type="button" className="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
                  {uploading ? 'Uploading...' : 'Choose File'}
                </button>
              </div>
              {/* Optional (Keeley's request, 2026-09-22) - e.g. a CPR card to First Aid/CPR/AED. */}
              <select value={trainingId} onChange={(e) => setTrainingId(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">Attach to a training (optional)</option>
                {trainingOptions.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
              </select>
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

  const { employee, client, trainings, completedRecords, trainerFeedbackSummary } = detail;

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
          employee={{ ...employee, client_name: isTrainer ? 'Internal / Trainers' : client?.client_name }}
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
          onSaved={() => { setEditingProfile(false); load(); }}
          onCancel={() => setEditingProfile(false)}
        />
      ) : (
        <div className="card detail-header-card">
          <div className="detail-identity">
            <div className="detail-avatar">{employee.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div>
              <div className="detail-name">{employee.full_name}</div>
              <div className="detail-sub">{employee.job_title || 'Role not set'} · {client?.client_name}</div>
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
          </div>
          <button className="secondary" onClick={() => setEditingProfile(true)}>Edit Profile</button>
        </div>
      )}

      {/* Layout (Keeley's request, 2026-09-22: "the employee page UI is a little wide"): the short
          summary cards sit side by side up top, and the 9-column Completed Trainings table gets
          the full page width below instead of being squeezed into two-thirds of it. */}
      <div className="profile-row">
        {isTrainer && <TrainerRatingSummary summary={trainerFeedbackSummary} />}
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
        <EmployeeDocumentsSection employeeId={employee.employee_id} isAdmin={isAdmin} trainingOptions={trainings} />
      </div>

      {isTrainer && <TrainingsTaughtSection employeeId={employee.employee_id} />}

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
