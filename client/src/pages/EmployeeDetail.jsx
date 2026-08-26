import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import EmployeeCompliancePanel from '../components/EmployeeCompliancePanel.jsx';

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
  const isTrainer = employee.employee_type === 'trainer';
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
          <label>{isTrainer ? 'Employee ID' : 'Employee Phone Number'}</label>
          {isTrainer ? (
            <input
              type="text"
              placeholder="e.g. E-1042"
              value={form.employee_number}
              onChange={(e) => setForm({ ...form, employee_number: e.target.value })}
            />
          ) : (
            <input
              type="text"
              placeholder="(xxx) xxx-xxxx"
              value={form.employee_number}
              onChange={(e) => setForm({ ...form, employee_number: formatPhoneInput(e.target.value) })}
            />
          )}
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
              <div className="detail-meta-label">{isTrainer ? 'Employee ID' : 'Employee Phone Number'}</div>
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

      {isTrainer && <TrainerRatingSummary summary={trainerFeedbackSummary} />}
      {isTrainer && <TrainingsTaughtSection employeeId={employee.employee_id} />}

      <div className="layout-2col">
        <div>
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

        <div>
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
        </div>
      </div>
    </div>
  );
}
