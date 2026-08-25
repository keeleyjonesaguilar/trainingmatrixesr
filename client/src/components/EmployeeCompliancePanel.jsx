import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Modal from './Modal.jsx';
import StatusBadge from './StatusBadge.jsx';

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
function RecordEditRow({ record, employee, client, trainers, onSaved, onCancel }) {
  const [completionDate, setCompletionDate] = useState(record.completion_date || '');
  const [expirationDate, setExpirationDate] = useState(record.expiration_date || '');
  const [trainerId, setTrainerId] = useState(record.trainer_employee_id || '');
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
        trainer_employee_id: trainerId || null,
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
      <td><StatusBadge status={record.status} /></td>
      <td><input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} /></td>
      <td><input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} /></td>
      <td colSpan={3}>
        <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)} style={{ marginRight: 8 }}>
          <option value="">No trainer on file</option>
          {trainers.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
        </select>
        <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>{' '}
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        {error && <div className="error-banner" style={{ marginTop: 4 }}>{error}</div>}
      </td>
    </tr>
  );
}

// The per-employee compliance view (Keeley's request) - shared between EmployeeDetail.jsx (one
// employee, its own page) and the Client Compliance Overview's new per-employee section (many
// employees at once). All interactive state lives in this one component instance, so when
// Dashboard.jsx renders N of these in a loop (one per employee), React's per-instance state
// isolation means two employees' Edit/Add-Training actions can never collide - no manual keying
// needed, just a stable `key` prop on each instance from the parent.
export default function EmployeeCompliancePanel({
  employee, client, stats, completedRecords, trainingOptions, trainers,
  isAdmin, onReload, collapsible = false, defaultExpanded = true, heading = 'Completed Trainings',
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editingRecordId, setEditingRecordId] = useState('');
  const [addingRecord, setAddingRecord] = useState(false);
  const [selectedTrainingId, setSelectedTrainingId] = useState('');
  const [selectedTrainerId, setSelectedTrainerId] = useState('');
  const [localTrainers, setLocalTrainers] = useState(trainers);
  const [addingTrainer, setAddingTrainer] = useState(false);
  const [completionDate, setCompletionDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [recordNotes, setRecordNotes] = useState('');
  const [certificateFile, setCertificateFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [inactiveRefreshKey, setInactiveRefreshKey] = useState(0);

  useEffect(() => { setLocalTrainers(trainers); }, [trainers]);

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
      let certUploadFailed = false;
      if (certificateFile) {
        try {
          await api.uploadCertificate(saved.record_id, certificateFile);
        } catch (certErr) {
          certUploadFailed = true;
          setFormError(`Record saved, but the certificate upload failed: ${certErr.message}`);
        }
      }
      setSelectedTrainingId('');
      setSelectedTrainerId('');
      setCompletionDate('');
      setExpirationDate('');
      setRecordNotes('');
      setCertificateFile(null);
      onReload();
      if (!certUploadFailed) setAddingRecord(false);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (record) => {
    if (!window.confirm(`Permanently delete the ${record.training_name} record for ${employee.full_name}? This cannot be undone.`)) return;
    await api.deleteTrainingRecord(record.record_id);
    onReload();
  };

  const inactivateRecord = async (record) => {
    await api.setRecordInactive(record.record_id, true);
    setInactiveRefreshKey((k) => k + 1);
    onReload();
  };

  return (
    <div className={collapsible ? 'card' : undefined} style={collapsible ? { marginBottom: 12 } : undefined}>
      {collapsible && (
        <div
          className="toolbar"
          style={{ cursor: 'pointer' }}
          onClick={() => setExpanded((e) => !e)}
        >
          <div>
            <strong>{employee.full_name}</strong>{' '}
            <span className="page-subtitle" style={{ display: 'inline' }}>
              {employee.job_title || 'Role not set'} · {employee.employee_number || '—'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
            <span>Valid {stats.validCount}</span>
            <span className={stats.expiringSoonCount > 0 ? 'warn' : ''}>{stats.expiringSoonCount} expiring</span>
            <span className={stats.expiredCount > 0 ? 'warn' : ''}>{stats.expiredCount} expired</span>
            <span>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
      )}

      {expanded && (
        <div style={collapsible ? { marginTop: 12 } : undefined}>
          {!collapsible && (
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="stat-label">Valid / Compliant</div>
                <div className="value">{stats.validCount}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Expiring Soon (30d)</div>
                <div className="value">{stats.expiringSoonCount}</div>
                <span className={`caption ${stats.expiringSoonCount > 0 ? 'warn' : ''}`}>{stats.expiringSoonCount > 0 ? 'Action recommended' : 'None due soon'}</span>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Expired Certifications</div>
                <div className="value">{stats.expiredCount}</div>
                <span className={`caption ${stats.expiredCount > 0 ? 'warn' : ''}`}>{stats.expiredCount > 0 ? 'Site access blocked' : 'None expired'}</span>
              </div>
            </div>
          )}

          <div className="card">
            <div className="toolbar">
              <h2 style={{ margin: 0 }}>{heading} ({completedRecords.length})</h2>
              {isAdmin && <button type="button" onClick={() => setAddingRecord(true)}>+ Add Training</button>}
            </div>
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
                    {isAdmin && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {completedRecords.map((t) => (
                    editingRecordId === t.record_id ? (
                      <RecordEditRow
                        key={t.record_id}
                        record={t}
                        employee={employee}
                        client={client}
                        trainers={localTrainers}
                        onSaved={() => { setEditingRecordId(''); onReload(); }}
                        onCancel={() => setEditingRecordId('')}
                      />
                    ) : (
                      <tr key={t.record_id}>
                        <td>{t.training_id}</td>
                        <td>{t.training_name}</td>
                        <td>{client?.client_name || '—'}</td>
                        <td><StatusBadge status={t.status} /></td>
                        <td>{t.completion_date || '—'}</td>
                        <td>{t.expiration_date || '—'}</td>
                        <td><CertificateCell record={t} isAdmin={isAdmin} onUploaded={onReload} /></td>
                        <td>
                          {t.signature ? (
                            <img src={t.signature} alt="Employee signature" style={{ height: 28, maxWidth: 90 }} />
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
                  {completedRecords.length === 0 && (
                    <tr><td colSpan={isAdmin ? 9 : 8} className="empty-state">No trainings completed yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {isAdmin && addingRecord && (
            <Modal onClose={() => setAddingRecord(false)}>
              <h2 style={{ marginTop: 0 }}>Record Training Completion</h2>
              {formError && <div className="error-banner">{formError}</div>}
              <form onSubmit={submitRecord}>
                <div className="field-row">
                  <label>Select Training Course</label>
                  <select value={selectedTrainingId} onChange={(e) => setSelectedTrainingId(e.target.value)} required>
                    <option value="">Select...</option>
                    {trainingOptions.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
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
                    {localTrainers.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
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
                <button type="submit" disabled={saving || !selectedTrainingId || !selectedTrainerId}>{saving ? 'Saving...' : 'Save Record'}</button>{' '}
                <button type="button" className="secondary" onClick={() => setAddingRecord(false)}>Cancel</button>
              </form>
            </Modal>
          )}

          {addingTrainer && (
            <AddTrainerModal
              onCreated={(trainer) => {
                setLocalTrainers((prev) => [...prev, trainer]);
                setSelectedTrainerId(trainer.employee_id);
                setAddingTrainer(false);
              }}
              onClose={() => setAddingTrainer(false)}
            />
          )}

          <InactiveRecordsSection
            employeeId={employee.employee_id}
            refreshKey={inactiveRefreshKey}
            onChanged={() => { setInactiveRefreshKey((k) => k + 1); onReload(); }}
          />
        </div>
      )}
    </div>
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
