import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import Modal from '../components/Modal.jsx';

const ADD_NEW_TRAINER = '__add_new__';

// Quick-add popup for a trainer that isn't in the list yet (Keeley's request: don't leave the
// page to add one). Only the name is required here - phone/job title can be filled in later
// from the trainer's own profile, same as the dedicated Trainers page already allows.
function AddTrainerModal({ onCreated, onClose }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const trainer = await api.createTrainer({ full_name: name.trim() });
      onCreated(trainer);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Add a New Trainer</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="field-row">
          <label>Trainer Name</label>
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button type="submit" disabled={saving || !name.trim()}>{saving ? 'Adding...' : 'Add Trainer'}</button>{' '}
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      </form>
    </Modal>
  );
}

function statusBadgeClass(status) {
  switch (status) {
    case 'Current': return 'badge-current';
    case 'Expired': return 'badge-expired';
    case 'Missing': return 'badge-missing';
    case 'Not Applicable': return 'badge-notapplicable';
    case 'No Expiration': return 'badge-noexpiration';
    case 'Pending Review': return 'badge-pendingreview';
    default: return 'badge-notapplicable';
  }
}

// Live-formats a phone number as (xxx) xxx-xxxx while typing. This is the standard US format
// Keeley wants - Employee Phone Number is now how employees are tracked/identified.
function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function EmployeeProfileEditor({ employee, onSaved, onCancel }) {
  const [form, setForm] = useState({
    job_title: employee.job_title || '',
    employee_number: employee.employee_number || '',
    active: employee.active,
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
          <label>Status</label>
          <select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>
      </div>
      <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button>{' '}
      <button className="secondary" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// Certificate of completion cell (Keeley's request): shows a View link if one's on file,
// otherwise an inline "Attach Certificate" control so it can be added later too - not just
// at the moment the training record is first created.
function CertificateCell({ record, isAdmin, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  if (!record.record_id) return <>—</>;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadCertificate(record.record_id, file);
      onUploaded();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {record.certificate_filename && (
        <a href={api.getCertificateUrl(record.record_id)} target="_blank" rel="noreferrer">View</a>
      )}
      {isAdmin && (
        <>
          {record.certificate_filename ? ' · ' : null}
          <button
            type="button"
            className="secondary"
            style={{ padding: '2px 8px', fontSize: 12 }}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? 'Uploading...' : record.certificate_filename ? 'Replace' : 'Attach'}
          </button>
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} />
        </>
      )}
      {!record.certificate_filename && !isAdmin && '—'}
      {error && <div className="error-banner" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// Inline edit for an already-logged training record (Keeley's request: fix a wrong date etc
// after the fact) - reuses api.saveTrainingRecord with record_id, which the backend already
// supports as an update-in-place.
function RecordEditRow({ record, employee, client, onSaved, onCancel }) {
  const [completionDate, setCompletionDate] = useState(record.completion_date || '');
  const [expirationDate, setExpirationDate] = useState(record.expiration_date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveTrainingRecord({
        record_id: record.record_id,
        client_id: employee.client_id,
        employee_id: employee.employee_id,
        training_id: record.training_id,
        completion_date: completionDate || null,
        source_expiration_date: expirationDate || null,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>{record.training_id}</td>
      <td>{record.training_name}</td>
      <td>{client?.client_name || '—'}</td>
      <td><span className={`badge ${statusBadgeClass(record.status)}`}>{record.status}</span></td>
      <td><input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} /></td>
      <td><input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} /></td>
      <td colSpan={3}>
        <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>{' '}
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        {error && <div className="error-banner" style={{ marginTop: 4 }}>{error}</div>}
      </td>
    </tr>
  );
}

function InactiveRecordsSection({ employeeId, refreshKey, onChanged }) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    api.getInactiveRecords(employeeId).then(setRecords).catch(() => {});
  }, [employeeId, refreshKey]);

  const reactivate = async (recordId) => {
    setBusyId(recordId);
    try {
      await api.setRecordInactive(recordId, false);
      onChanged();
    } finally {
      setBusyId('');
    }
  };

  if (records.length === 0) return null;

  return (
    <div className="card">
      <button type="button" className="link-button" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} Inactive Records ({records.length})
      </button>
      {open && (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Code</th><th>Training</th><th>Completed</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.record_id}>
                <td>{r.training_id}</td>
                <td>{r.training_name}</td>
                <td>{r.completion_date || '—'}</td>
                <td>{r.expiration_date || '—'}</td>
                <td>
                  <button type="button" className="secondary" disabled={busyId === r.record_id} onClick={() => reactivate(r.record_id)}>
                    {busyId === r.record_id ? 'Saving...' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// A trainer's own list of sessions they've taught, linking each to its SessionDetail page.
function TrainingsTaughtSection({ employeeId }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    api.listTrainingSessions({ trainer_employee_id: employeeId }).then(setSessions).catch(() => {});
  }, [employeeId]);

  return (
    <div className="card">
      <h2>Trainings Taught ({sessions.length})</h2>
      {sessions.length === 0 ? (
        <div className="empty-state">No sessions taught yet.</div>
      ) : (
        <table>
          <thead><tr><th>Date</th><th>Client</th><th>Training</th><th>Attendees</th></tr></thead>
          <tbody>
            {sessions.map((s) => (
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
  );
}

function DuplicateReviewPanel({ employeeId, trainingId, isAdmin, onResolved, onClose }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState('');

  useEffect(() => {
    api.getRecordHistory(employeeId, trainingId).then(setHistory).catch((e) => setError(e.message));
  }, [employeeId, trainingId]);

  const resolve = async (recordId) => {
    setResolving(recordId);
    setError('');
    try {
      await api.resolveDuplicateRecord(recordId);
      onResolved();
    } catch (e) {
      setError(e.message);
    } finally {
      setResolving('');
    }
  };

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Potential Duplicate &mdash; Choose the Active Record</h2>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <p className="page-subtitle">
        More than one record exists for this employee and training. Nothing has been deleted &mdash; pick which one should drive the live status;
        the rest stay here for history.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {!history && <div className="empty-state">Loading...</div>}
      {history && (
        <table>
          <thead>
            <tr>
              <th>Original Client Wording</th>
              <th>Completion Date</th>
              <th>Source</th>
              <th>Status</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.record_id}>
                <td>{r.original_client_training_name || '—'}</td>
                <td>{r.completion_date || '—'}</td>
                <td>{r.source || '—'}</td>
                <td>
                  <span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span>{' '}
                  {r.is_active_record ? <span className="badge badge-current">Active</span> : null}
                </td>
                {isAdmin && (
                  <td>
                    <button disabled={!!r.is_active_record || resolving === r.record_id} onClick={() => resolve(r.record_id)}>
                      {resolving === r.record_id ? 'Saving...' : 'Set as Active'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
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
  const [reviewingTrainingId, setReviewingTrainingId] = useState('');
  const [editingRecordId, setEditingRecordId] = useState('');
  const [inactiveRefreshKey, setInactiveRefreshKey] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivateConfirmText, setDeactivateConfirmText] = useState('');
  const formRef = useRef(null);

  const [selectedTrainingId, setSelectedTrainingId] = useState('');
  const [selectedTrainerId, setSelectedTrainerId] = useState('');
  const [trainers, setTrainers] = useState([]);
  const [addingTrainer, setAddingTrainer] = useState(false);
  const [completionDate, setCompletionDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [recordNotes, setRecordNotes] = useState('');
  const [certificateFile, setCertificateFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => { api.listTrainers().then(setTrainers).catch(() => {}); }, []);

  const load = () => {
    api.getEmployeeFullDetail(employeeId).then(setDetail).catch((e) => setError(e.message));
  };

  useEffect(load, [employeeId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!detail) return <div className="empty-state">Loading...</div>;

  const { employee, client, trainings } = detail;

  // Keeley's call: only completed trainings are shown - an unfinished training just isn't
  // relevant here and shouldn't take up table space. Sorted most-recently-completed first.
  const completed = trainings
    .filter((t) => t.completion_date)
    .sort((a, b) => (b.completion_date || '').localeCompare(a.completion_date || ''));

  const expiringSoonCount = completed.filter((t) => t.expiring_soon).length;
  const expiredCount = completed.filter((t) => t.status === 'Expired').length;
  const validCount = completed.filter((t) => t.status === 'Current' || t.status === 'No Expiration').length;

  const history = completed.slice(0, 6);

  const submitRecord = async (e) => {
    e.preventDefault();
    if (!selectedTrainingId || !selectedTrainerId || selectedTrainerId === ADD_NEW_TRAINER) return;
    setSaving(true);
    setFormError('');
    try {
      const saved = await api.saveTrainingRecord({
        client_id: employee.client_id,
        employee_id: employee.employee_id,
        training_id: selectedTrainingId,
        trainer_employee_id: selectedTrainerId,
        completion_date: completionDate || null,
        source_expiration_date: expirationDate || null,
        notes: recordNotes || null,
        source: 'Manual Entry',
      });
      // Certificate upload is optional - if one was chosen, attach it to the record we just
      // saved. A failure here shouldn't undo the record itself, just surface as a form error
      // so Keeley knows to attach it from the completed-trainings list instead.
      if (certificateFile) {
        try {
          await api.uploadCertificate(saved.record_id, certificateFile);
        } catch (certErr) {
          setFormError(`Record saved, but the certificate upload failed: ${certErr.message}`);
        }
      }
      setSelectedTrainingId('');
      setSelectedTrainerId('');
      setCompletionDate('');
      setExpirationDate('');
      setRecordNotes('');
      setCertificateFile(null);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (record) => {
    if (!window.confirm(`Permanently delete the ${record.training_name} record for ${employee.full_name}? This cannot be undone.`)) return;
    await api.deleteTrainingRecord(record.record_id);
    load();
  };

  const inactivateRecord = async (record) => {
    await api.setRecordInactive(record.record_id, true);
    setInactiveRefreshKey((k) => k + 1);
    load();
  };

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
          {isAdmin && !confirmingDelete && <button className="danger" onClick={() => setConfirmingDelete(true)}>Delete Employee</button>}
        </div>
      </div>

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
      {formError && <div className="error-banner">{formError}</div>}

      {editingProfile ? (
        <EmployeeProfileEditor employee={employee} onSaved={() => { setEditingProfile(false); load(); }} onCancel={() => setEditingProfile(false)} />
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
              <div className="detail-meta-label">Status</div>
              <div className="detail-meta-value">{employee.active ? 'Active' : 'Inactive'}</div>
            </div>
          </div>
          {isAdmin && <button className="secondary" onClick={() => setEditingProfile(true)}>Edit Profile</button>}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Valid / Compliant</div>
          <div className="value">{validCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Expiring Soon (30d)</div>
          <div className="value">{expiringSoonCount}</div>
          <span className={`caption ${expiringSoonCount > 0 ? 'warn' : ''}`}>{expiringSoonCount > 0 ? 'Action recommended' : 'None due soon'}</span>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Expired Certifications</div>
          <div className="value">{expiredCount}</div>
          <span className={`caption ${expiredCount > 0 ? 'warn' : ''}`}>{expiredCount > 0 ? 'Site access blocked' : 'None expired'}</span>
        </div>
      </div>

      {isTrainer && <TrainingsTaughtSection employeeId={employee.employee_id} />}

      {reviewingTrainingId && (
        <DuplicateReviewPanel
          employeeId={employee.employee_id}
          trainingId={reviewingTrainingId}
          isAdmin={isAdmin}
          onClose={() => setReviewingTrainingId('')}
          onResolved={() => { setReviewingTrainingId(''); load(); }}
        />
      )}

      <div className="layout-2col">
        <div>
          <div className="card">
            <h2>{isTrainer ? 'Trainings Obtained' : 'Completed Trainings'} ({completed.length})</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Training Course</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Completed</th>
                    <th>Expires</th>
                    <th>Certificate</th>
                    <th>Signature</th>
                    <th>Flag</th>
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {completed.map((t) => (
                    editingRecordId === t.record_id ? (
                      <RecordEditRow
                        key={t.training_id}
                        record={t}
                        employee={employee}
                        client={client}
                        onSaved={() => { setEditingRecordId(''); load(); }}
                        onCancel={() => setEditingRecordId('')}
                      />
                    ) : (
                      <tr key={t.training_id}>
                        <td>{t.training_id}</td>
                        <td>{t.training_name}</td>
                        <td>{client?.client_name || '—'}</td>
                        <td><span className={`badge ${statusBadgeClass(t.status)}`}>{t.status}</span></td>
                        <td>{t.completion_date || '—'}</td>
                        <td>{t.expiration_date || '—'}</td>
                        <td><CertificateCell record={t} isAdmin={isAdmin} onUploaded={load} /></td>
                        <td>
                          {t.signature ? (
                            <img src={t.signature} alt="Employee signature" style={{ height: 28, maxWidth: 90 }} />
                          ) : '—'}
                        </td>
                        <td>
                          {t.duplicate_status === 'flagged' ? (
                            <button type="button" className="secondary" onClick={() => setReviewingTrainingId(t.training_id)}>
                              Potential Duplicate
                            </button>
                          ) : '—'}
                        </td>
                        {isAdmin && (
                          <td>
                            <button type="button" className="secondary" onClick={() => setEditingRecordId(t.record_id)}>Edit</button>{' '}
                            <button type="button" className="secondary" onClick={() => inactivateRecord(t)}>Inactivate</button>{' '}
                            <button type="button" className="secondary" onClick={() => deleteRecord(t)}>Delete</button>
                          </td>
                        )}
                      </tr>
                    )
                  ))}
                  {completed.length === 0 && (
                    <tr><td colSpan={isAdmin ? 10 : 9} className="empty-state">No trainings completed yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <InactiveRecordsSection
            employeeId={employee.employee_id}
            refreshKey={inactiveRefreshKey}
            onChanged={() => { setInactiveRefreshKey((k) => k + 1); load(); }}
          />
        </div>

        <div>
          {isAdmin && (
            <div className="card" ref={formRef}>
              <h2>Record Training Completion</h2>
              <form onSubmit={submitRecord}>
                <div className="field-row">
                  <label>Select Training Course</label>
                  <select value={selectedTrainingId} onChange={(e) => setSelectedTrainingId(e.target.value)} required>
                    <option value="">Select...</option>
                    {trainings.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
                  </select>
                </div>
                <div className="field-row">
                  <label>Trainer</label>
                  <select
                    value={selectedTrainerId}
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW_TRAINER) {
                        setAddingTrainer(true);
                      } else {
                        setSelectedTrainerId(e.target.value);
                      }
                    }}
                    required
                  >
                    <option value="">Select...</option>
                    {trainers.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
                    <option value={ADD_NEW_TRAINER}>+ Add New Trainer</option>
                  </select>
                </div>
                <div className="field-row">
                  <label>Completion Date</label>
                  <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
                </div>
                <div className="field-row">
                  <label>Expiration Date (optional &mdash; leave blank if this training doesn&apos;t expire)</label>
                  <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
                </div>
                <div className="field-row">
                  <label>Notes</label>
                  <input type="text" placeholder="Optional" value={recordNotes} onChange={(e) => setRecordNotes(e.target.value)} />
                </div>
                <div className="field-row">
                  <label>Certificate of Completion (optional)</label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setCertificateFile(e.target.files?.[0] || null)}
                  />
                  {certificateFile && <span className="page-subtitle" style={{ margin: '4px 0 0' }}>{certificateFile.name}</span>}
                </div>
                <button type="submit" disabled={saving || !selectedTrainingId || !selectedTrainerId}>{saving ? 'Saving...' : 'Save Record'}</button>
              </form>
            </div>
          )}

          {addingTrainer && (
            <AddTrainerModal
              onCreated={(trainer) => {
                setTrainers((prev) => [...prev, trainer]);
                setSelectedTrainerId(trainer.employee_id);
                setAddingTrainer(false);
              }}
              onClose={() => setAddingTrainer(false)}
            />
          )}

          <div className="card">
            <h2>Recent Completions</h2>
            <div className="activity-feed">
              {history.map((t) => (
                <div key={t.training_id} className="activity-item">
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
        </div>
      </div>
    </div>
  );
}
