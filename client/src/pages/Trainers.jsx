import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import DuplicateTrainersPanel from '../components/DuplicateTrainersPanel.jsx';
import DuplicateWarningModal from '../components/DuplicateWarningModal.jsx';

function normalizePhone(s) { return (s || '').replace(/\D/g, ''); }
function normalizeName(s) { return (s || '').trim().toLowerCase(); }

// Same shape as ClientSettings.jsx's AddClientForm: a small "+ Add Trainer" button that
// expands into a form card. Trainers are tracked separately from client employees (they don't
// belong to any one client's roster) but still get a full profile - reused from
// EmployeeDetail.jsx via the same /employees/:employeeId route, just flagged employee_type
// 'trainer' so that page shows the extra Trainings Taught / Trainings Obtained sections.
// Checks the already-loaded trainer list for a name/phone match before creating (Keeley's
// request, 2026-08-20) - catches an accidental duplicate at the moment it would be created.
function AddTrainerForm({ trainers, onAdded, onCancel }) {
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [possibleMatches, setPossibleMatches] = useState(null);

  const createTrainer = async () => {
    setSaving(true);
    setError('');
    try {
      await api.createTrainer({ full_name: name.trim(), job_title: jobTitle.trim() || null, employee_number: phone.trim() || null });
      onAdded();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const phoneDigits = normalizePhone(phone);
    const matches = trainers.filter((t) =>
      normalizeName(t.full_name) === normalizeName(name) || (phoneDigits && normalizePhone(t.employee_number) === phoneDigits)
    );
    if (matches.length > 0) {
      setPossibleMatches(matches);
      return;
    }
    createTrainer();
  };

  return (
    <>
      <form className="card add-client-card" onSubmit={submit}>
        <h2>Add a New Trainer</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="field-row">
          <label>Full Name</label>
          <input type="text" autoFocus placeholder="e.g. Jamie Trainer" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field-row">
          <label>Phone Number</label>
          <input type="text" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>Used to match this trainer to their sessions - add it so sessions created for them link up correctly.</p>
        </div>
        <div className="field-row">
          <label>Role / Trade (optional)</label>
          <input type="text" placeholder="e.g. Safety Officer" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <button type="submit" disabled={saving || !name.trim()}>{saving ? 'Adding...' : 'Add Trainer'}</button>{' '}
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </form>
      {possibleMatches && (
        <DuplicateWarningModal
          matches={possibleMatches}
          labelFor={(t) => `${t.full_name}${t.employee_number ? ` (${t.employee_number})` : ''}`}
          linkFor={(t) => `/employees/${t.employee_id}`}
          onUseExisting={onCancel}
          onCreateAnyway={() => { setPossibleMatches(null); createTrainer(); }}
          onCancel={() => setPossibleMatches(null)}
        />
      )}
    </>
  );
}

export default function Trainers() {
  const isAdmin = useIsAdmin();
  const [trainers, setTrainers] = useState([]);
  const [error, setError] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);
  const [showActive, setShowActive] = useState(true);

  const load = () => api.listTrainers().then(setTrainers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const needsInfo = trainers.filter((t) => !t.employee_number || !t.job_title);
  const activeTrainers = trainers.filter((t) => t.active);
  const inactiveTrainers = trainers.filter((t) => !t.active);
  const visibleTrainers = showActive ? activeTrainers : inactiveTrainers;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Trainers</h1>
          <p className="page-subtitle">Everyone who conducts trainings, tracked separately from the clients/employees they train — never counted in client compliance totals.</p>
        </div>
        {isAdmin && !addingOpen && (
          <div className="page-header-actions">
            <button onClick={() => setAddingOpen(true)}>+ Add Trainer</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="stat-grid">
        <div className={`stat-tile clickable${showActive ? ' selected' : ''}`} onClick={() => setShowActive(true)}>
          <div className="stat-label">Active Trainers</div>
          <div className="value">{activeTrainers.length}</div>
        </div>
        <div className={`stat-tile clickable${!showActive ? ' selected' : ''}`} onClick={() => setShowActive(false)}>
          <div className="stat-label">Inactive Trainers</div>
          <div className="value">{inactiveTrainers.length}</div>
        </div>
      </div>

      {addingOpen && (
        <AddTrainerForm
          trainers={trainers}
          onAdded={() => { setAddingOpen(false); load(); }}
          onCancel={() => setAddingOpen(false)}
        />
      )}

      {isAdmin && <DuplicateTrainersPanel onMerged={load} />}

      {needsInfo.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Trainers Needing Info ({needsInfo.length})</h2>
          <p className="page-subtitle">Missing a phone number and/or job title/position - fill these in from the trainer's own profile.</p>
          <table>
            <thead><tr><th>Name</th><th>Missing</th></tr></thead>
            <tbody>
              {needsInfo.map((t) => (
                <tr key={t.employee_id}>
                  <td><Link to={`/employees/${t.employee_id}`}>{t.full_name}</Link></td>
                  <td>
                    {[!t.employee_number && 'Phone Number', !t.job_title && 'Job Title/Position'].filter(Boolean).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role / Trade</th>
                <th>Phone Number</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrainers.map((t) => (
                <tr key={t.employee_id}>
                  <td><Link to={`/employees/${t.employee_id}`}>{t.full_name}</Link></td>
                  <td>{t.job_title || '—'}</td>
                  <td>{t.employee_number || '—'}</td>
                  <td><span className={`badge ${t.active ? 'badge-current' : 'badge-notapplicable'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
              {visibleTrainers.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-state">
                    {trainers.length === 0
                      ? `No trainers yet${isAdmin ? ' — add one above.' : '.'}`
                      : showActive ? 'No active trainers.' : 'No inactive trainers.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
