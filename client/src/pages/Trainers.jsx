import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import DuplicateTrainersPanel from '../components/DuplicateTrainersPanel.jsx';
import TrainerEmployeeMatchesPanel from '../components/TrainerEmployeeMatchesPanel.jsx';
import DuplicateWarningModal from '../components/DuplicateWarningModal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { nameKey, nameParts } from '../lib/names.js';
import LiveSearchInput from '../components/LiveSearchInput.jsx';
import { useSortableRows } from '../lib/useSortableRows';
import { matchesSearch } from '../lib/search';

// Click-a-header sorting for the trainer list (Keeley's request, 2026-10-14).
const SORT_ACCESSORS = {
  name: (t) => (t.full_name || '').toLowerCase(),
  type: (t) => (t.trainer_type_effective === 'external' ? 'external' : 'internal'),
  role: (t) => (t.job_title || '').toLowerCase() || null,
  phone: (t) => t.employee_number || null,
  email: (t) => (t.email || '').toLowerCase() || null,
  status: (t) => (t.active ? 0 : 1),
};
const NO_FILTERS = { search: '', type: '', email: '' };

function normalizeId(s) { return (s || '').trim().toLowerCase(); }

// Same shape as ClientSettings.jsx's AddClientForm: a small "+ Add Trainer" button that
// expands into a form card. Trainers are tracked separately from client employees (they don't
// belong to any one client's roster) but still get a full profile - reused from
// EmployeeDetail.jsx via the same /employees/:employeeId route, just flagged employee_type
// 'trainer' so that page shows the extra Trainings Taught / Trainings Obtained sections.
// Checks the already-loaded trainer list for a name/ID match before creating (Keeley's
// request, 2026-08-20) - catches an accidental duplicate at the moment it would be created.
function AddTrainerForm({ trainers, onAdded, onCancel }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  // Internal (one of ours) or External (Keeley's request, 2026-10-07).
  const [trainerType, setTrainerType] = useState('internal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [possibleMatches, setPossibleMatches] = useState(null);

  const createTrainer = async () => {
    setSaving(true);
    setError('');
    try {
      await api.createTrainer({ first_name: firstName.trim(), last_name: lastName.trim(), job_title: jobTitle.trim() || null, employee_number: employeeId.trim() || null, email: email.trim() || null, trainer_type: trainerType });
      onAdded();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    const idNormalized = normalizeId(employeeId);
    const typedKey = nameKey(firstName, lastName);
    const matches = trainers.filter((t) =>
      nameKey(nameParts(t).first, nameParts(t).last) === typedKey || (idNormalized && normalizeId(t.employee_number) === idNormalized)
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
          <label>First Name</label>
          <input type="text" autoFocus placeholder="e.g. Jamie" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="field-row">
          <label>Last Name</label>
          <input type="text" placeholder="e.g. Rivera" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
        <div className="field-row">
          <label>Phone Number</label>
          <input type="text" placeholder="(555) 123-4567" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>Used to match this trainer to their sessions - add it so sessions created for them link up correctly.</p>
        </div>
        <div className="field-row">
          <label>Email</label>
          <input type="email" placeholder="trainer@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <p className="page-subtitle" style={{ margin: '4px 0 0' }}>Required - their class summaries and close-out paperwork are emailed here.</p>
        </div>
        <div className="field-row">
          <label>Trainer Type</label>
          <select value={trainerType} onChange={(e) => setTrainerType(e.target.value)}>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>
        <div className="field-row">
          <label>Role / Trade (optional)</label>
          <input type="text" placeholder="e.g. Safety Officer" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <button type="submit" disabled={saving || !firstName.trim() || !lastName.trim() || !email.trim()}>{saving ? 'Adding...' : 'Add Trainer'}</button>{' '}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);
  const [showActive, setShowActive] = useState(true);
  // Filters (Keeley's request, 2026-10-14): search, Internal/External, and with/without an email.
  const [filters, setFilters] = useState(NO_FILTERS);

  const load = () => api.listTrainers().then(setTrainers).catch((e) => setError(e.message));
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const activeTrainers = trainers.filter((t) => t.active);
  const inactiveTrainers = trainers.filter((t) => !t.active);
  const missingEmail = activeTrainers.filter((t) => !t.email);
  const filtered = (showActive ? activeTrainers : inactiveTrainers).filter((t) => (
    (!filters.search || matchesSearch([t.full_name, t.email, t.employee_number, t.job_title].filter(Boolean).join(' '), filters.search))
    && (!filters.type || (t.trainer_type_effective === 'external' ? 'external' : 'internal') === filters.type)
    && (!filters.email || (filters.email === 'missing' ? !t.email : Boolean(t.email)))
  ));
  const { sortedRows: visibleTrainers, toggleSort, sortIndicator } = useSortableRows(filtered, SORT_ACCESSORS, 'name');
  const filtersOn = filters.search || filters.type || filters.email;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Trainers</h1>
          <p className="page-subtitle">Everyone who conducts trainings, tracked separately from the clients/employees they train — never counted in client compliance totals.</p>
        </div>
        {!addingOpen && (
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
        <div
          className={`stat-tile clickable${showActive && filters.email === 'missing' ? ' selected' : ''}`}
          onClick={() => { setShowActive(true); setFilters({ ...NO_FILTERS, email: 'missing' }); }}
        >
          <div className="stat-label">Active - Missing Email</div>
          <div className="value">{missingEmail.length}</div>
          <div className="label">won&apos;t get class summaries</div>
        </div>
      </div>

      {addingOpen && (
        <AddTrainerForm
          trainers={trainers}
          onAdded={() => { setAddingOpen(false); load(); }}
          onCancel={() => setAddingOpen(false)}
        />
      )}

      {isAdmin && <TrainerEmployeeMatchesPanel onMerged={load} />}
      {isAdmin && <DuplicateTrainersPanel onMerged={load} />}

      <div className="filter-bar" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="field-row">
          <label htmlFor="trainers-search">Search</label>
          <LiveSearchInput id="trainers-search" value={filters.search} onSearch={(v) => setFilters((f) => ({ ...f, search: v.trim() }))} placeholder="Name, email or phone" />
        </div>
        <div className="field-row">
          <label htmlFor="trainers-type">Type</label>
          <select id="trainers-type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">Internal and External</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="trainers-email">Email</label>
          <select id="trainers-email" value={filters.email} onChange={(e) => setFilters({ ...filters, email: e.target.value })}>
            <option value="">Any</option>
            <option value="has">Has an email</option>
            <option value="missing">Missing email</option>
          </select>
        </div>
        <div className="field-row">
          <label>&nbsp;</label>
          <button type="button" className="secondary" disabled={!filtersOn} onClick={() => setFilters(NO_FILTERS)}>Reset Filters</button>
        </div>
      </div>

      <div className="card">
        {loading ? <LoadingState label="Loading trainers..." /> : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>Name{sortIndicator('name')}</th>
                <th className="sortable" onClick={() => toggleSort('type')}>Type{sortIndicator('type')}</th>
                <th className="sortable" onClick={() => toggleSort('role')}>Role / Trade{sortIndicator('role')}</th>
                <th className="sortable" onClick={() => toggleSort('phone')}>Phone Number{sortIndicator('phone')}</th>
                <th className="sortable" onClick={() => toggleSort('email')}>Email{sortIndicator('email')}</th>
                <th className="sortable" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrainers.map((t) => (
                <tr key={t.employee_id}>
                  <td><Link to={`/employees/${t.employee_id}`}>{t.full_name}</Link></td>
                  <td>{t.trainer_type_effective === 'external' ? 'External' : 'Internal'}</td>
                  <td>{t.job_title || '—'}</td>
                  <td>{t.employee_number || '—'}</td>
                  <td>{t.email || <span className="badge badge-expired">Missing</span>}</td>
                  <td><span className={`badge ${t.active ? 'badge-current' : 'badge-notapplicable'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
              {visibleTrainers.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    {trainers.length === 0
                      ? 'No trainers yet — add one above.'
                      : filtersOn ? 'No trainers match these filters.'
                        : showActive ? 'No active trainers.' : 'No inactive trainers.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}
