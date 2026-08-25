import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import DuplicateEmployeesPanel from '../components/DuplicateEmployeesPanel.jsx';
import DuplicateWarningModal from '../components/DuplicateWarningModal.jsx';
import { formatCell } from '../lib/matrixCell.js';

function normalizePhone(s) { return (s || '').replace(/\D/g, ''); }
function normalizeName(s) { return (s || '').trim().toLowerCase(); }

function TrainingFilterDropdown({ masterTrainings, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = masterTrainings.filter(
    (mt) => !search || mt.training_name.toLowerCase().includes(search.toLowerCase()) || mt.training_id.toLowerCase().includes(search.toLowerCase())
  );
  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  return (
    <div className="field-row" style={{ position: 'relative' }}>
      <label>Has All Selected Trainings</label>
      <button type="button" className="secondary" onClick={() => setOpen((o) => !o)}>
        {selected.length ? `${selected.length} training${selected.length === 1 ? '' : 's'} selected` : 'Select trainings...'}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, width: 340, maxHeight: 380, overflowY: 'auto' }}>
          <input
            type="search"
            placeholder="Search trainings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8, width: '100%' }}
          />
          {filtered.map((mt) => (
            <label key={mt.training_id} style={{ display: 'block', fontSize: 13, padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(mt.training_id)} onChange={() => toggle(mt.training_id)} />{' '}
              {mt.training_id} - {mt.training_name}
            </label>
          ))}
          {filtered.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>No matches.</p>}
          <div style={{ marginTop: 8 }}>
            {selected.length > 0 && <button type="button" className="secondary" onClick={() => onChange([])}>Clear</button>}
            {' '}
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Manually add an employee without going through the CSV import flow (Keeley's request) -
// First/Last name combine into the existing single full_name column (same convention used for
// the sign-in form's split), Phone Number reuses employee_number. Lands on the new employee's
// own page afterward, where Record Training Completion already exists.
function AddEmployeeForm({ clients, onAdded, onCancel }) {
  const [clientId, setClientId] = useState(clients[0]?.client_id || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [possibleMatches, setPossibleMatches] = useState(null);

  const createEmployee = async () => {
    setSaving(true);
    setError('');
    try {
      const employee = await api.createEmployee({
        client_id: clientId,
        full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        employee_number: phone.trim(),
      });
      onAdded(employee);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  // Checks this client's existing roster for a name/phone match before creating (Keeley's
  // request, 2026-08-20) - catches an accidental duplicate at the moment it would be created.
  const submit = async (e) => {
    e.preventDefault();
    if (!clientId || !firstName.trim() || !lastName.trim() || !phone.trim()) return;
    setSaving(true);
    setError('');
    try {
      const roster = await api.listEmployees({ client_id: clientId });
      const fullName = normalizeName(`${firstName} ${lastName}`);
      const phoneDigits = normalizePhone(phone);
      const matches = roster.filter((r) => normalizeName(r.full_name) === fullName || (phoneDigits && normalizePhone(r.employee_number) === phoneDigits));
      if (matches.length > 0) {
        setPossibleMatches(matches);
        setSaving(false);
        return;
      }
    } catch {
      // If the check itself fails, don't block creation over it - just proceed.
    }
    createEmployee();
  };

  return (
    <>
    <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <h2>Add a New Employee</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="toolbar">
        <div className="field-row">
          <label>Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Select client...</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>First Name</label>
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div className="field-row">
          <label>Last Name</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
        <div className="field-row">
          <label>Phone Number</label>
          <input type="text" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Adding...' : 'Add Employee'}</button>{' '}
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </form>
    {possibleMatches && (
      <DuplicateWarningModal
        matches={possibleMatches}
        labelFor={(r) => `${r.full_name}${r.employee_number ? ` (${r.employee_number})` : ''}`}
        linkFor={(r) => `/employees/${r.employee_id}`}
        onUseExisting={onCancel}
        onCreateAnyway={() => { setPossibleMatches(null); createEmployee(); }}
        onCancel={() => setPossibleMatches(null)}
      />
    )}
    </>
  );
}

export default function Matrix() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [addingOpen, setAddingOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [allMasterTrainings, setAllMasterTrainings] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const clientId = searchParams.get('client_id') || '';
  const search = searchParams.get('search') || '';
  const trainingIds = (searchParams.get('trainings') || '').split(',').filter(Boolean);
  const activeParam = searchParams.get('active') === '0' ? '0' : '1';

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
    api.listMasterTrainings(true).then(setAllMasterTrainings).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (clientId) params.set('client_id', clientId);
    if (search) params.set('search', search);
    params.set('active', activeParam);
    for (const tid of trainingIds) params.append('training_ids', tid);
    api.getMatrix(params).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, search, trainingIds.join(','), activeParam, refreshKey]);

  // replace: true (Keeley's report, 2026-08-18: the browser back button "took her to Matrix,
  // not Dashboard") - without this, every filter tweak here pushed a brand-new history entry,
  // so hitting the physical back button just stepped backwards through old filter states one
  // at a time instead of actually leaving the page. Filter changes should update the URL in
  // place, not pile up in history.
  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const setTrainingIds = (ids) => updateParam('trainings', ids.join(','));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Employees</h1>
          <p className="page-subtitle">Every employee against the Master Training Catalog. Click a name or training column for details.</p>
        </div>
        {isAdmin && !addingOpen && (
          <div className="page-header-actions">
            <button onClick={() => setAddingOpen(true)}>+ Add Employee</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {addingOpen && (
        <AddEmployeeForm
          clients={clients}
          onAdded={(employee) => navigate(`/employees/${employee.employee_id}`)}
          onCancel={() => setAddingOpen(false)}
        />
      )}

      {isAdmin && <DuplicateEmployeesPanel onMerged={() => setRefreshKey((k) => k + 1)} />}

      {data && (
        <div className="stat-grid">
          <div
            className={`stat-tile clickable${activeParam === '1' ? ' selected' : ''}`}
            onClick={() => updateParam('active', '1')}
          >
            <div className="stat-label">Active Employees</div>
            <div className="value">{data.stats.audited_employees}</div>
            <span className="caption">Across {clients.length} clients</span>
          </div>
          <div
            className={`stat-tile clickable${activeParam === '0' ? ' selected' : ''}`}
            onClick={() => updateParam('active', '0')}
          >
            <div className="stat-label">Inactive Employees</div>
            <div className="value">{data.stats.inactive_employees}</div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div className="field-row">
          <label>Search Employee</label>
          <input
            type="search"
            placeholder="Type name..."
            defaultValue={search}
            onKeyDown={(e) => { if (e.key === 'Enter') updateParam('search', e.target.value); }}
            onBlur={(e) => updateParam('search', e.target.value)}
          />
        </div>
        <div className="field-row">
          <label>Client Account</label>
          <select value={clientId} onChange={(e) => updateParam('client_id', e.target.value)}>
            <option value="">All Clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        <TrainingFilterDropdown masterTrainings={allMasterTrainings} selected={trainingIds} onChange={setTrainingIds} />
        <button type="button" className="secondary" onClick={() => setSearchParams({}, { replace: true })}>Reset Filters</button>
      </div>

      {trainingIds.length > 0 && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          Showing employees who currently hold <strong>all</strong> of:{' '}
          {trainingIds.map((tid) => allMasterTrainings.find((mt) => mt.training_id === tid)?.training_name || tid).join(', ')}
        </p>
      )}

      {loading && <div className="empty-state">Loading matrix...</div>}

      {data && !loading && (
        data.employees.length === 0 ? (
          <div className="empty-state">No employees match these filters.</div>
        ) : (
          <div className="matrix-scroll">
            <table>
              <thead>
                <tr>
                  <th>Employee / Badge</th>
                  <th>Client Company</th>
                  <th>Role / Trade</th>
                  {data.masterTrainings.map((mt) => (
                    <th key={mt.training_id} title={mt.training_name}>
                      <Link to={`/training-types/${mt.training_id}`}>{mt.training_id}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp) => (
                  <tr key={emp.employee_id}>
                    <td><Link to={`/employees/${emp.employee_id}`}>{emp.full_name}</Link></td>
                    <td>{emp.client_name}</td>
                    <td>{emp.job_title || '—'}</td>
                    {data.masterTrainings.map((mt) => {
                      const cell = emp.cells[mt.training_id];
                      const formatted = formatCell(cell);
                      return (
                        <td key={mt.training_id}>
                          {formatted.plain ? formatted.text : <span className={`badge ${formatted.className}`}>{formatted.text}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
