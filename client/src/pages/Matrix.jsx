import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import DuplicateEmployeesPanel from '../components/DuplicateEmployeesPanel.jsx';
import DuplicateWarningModal from '../components/DuplicateWarningModal.jsx';
import TrainingFilterDropdown from '../components/TrainingFilterDropdown.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { formatCell, STATUS_OPTIONS, buildComplianceReportRows, emptyFilterHint } from '../lib/matrixCell.js';
import { downloadCsv } from '../lib/csv.js';
import { useSortableRows } from '../lib/useSortableRows';

const MATRIX_BASE_SORT_ACCESSORS = {
  full_name: (r) => (r.full_name || '').toLowerCase(),
  client_name: (r) => (r.client_name || '').toLowerCase(),
  job_title: (r) => (r.job_title || '').toLowerCase(),
};

function normalizePhone(s) { return (s || '').replace(/\D/g, ''); }
function normalizeName(s) { return (s || '').trim().toLowerCase(); }

// Manually add an employee without going through the CSV import flow (Keeley's request) -
// First/Last name combine into the existing single full_name column (same convention used for
// the sign-in form's split), Phone Number reuses employee_number. Lands on the new employee's
// own page afterward, where Record Training Completion already exists.
function AddEmployeeForm({ clients, onAdded, onCancel }) {
  const [clientId, setClientId] = useState(clients[0]?.client_id || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
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
        email: email.trim() || null,
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
        <div className="field-row">
          <label>Email (optional)</label>
          <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
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
  const status = searchParams.get('status') || '';

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
    if (status) params.set('status', status);
    for (const tid of trainingIds) params.append('training_ids', tid);
    api.getMatrix(params).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, search, trainingIds.join(','), activeParam, status, refreshKey]);

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

  // One accessor per training column, added to the fixed Employee/Client/Role ones - sorting by
  // a training column orders by that training's own completion date (oldest/newest), with
  // employees who have no cell for it (blank/dash) sorted last regardless of direction
  // (useSortableRows' own null handling). Memoized on the training list, which is stable once
  // loaded, so this doesn't rebuild - and the sort doesn't re-run - on every render.
  const matrixSortAccessors = useMemo(() => {
    const trainingAccessors = {};
    for (const mt of data?.masterTrainings || []) {
      trainingAccessors[mt.training_id] = (r) => r.cells[mt.training_id]?.completion_date || null;
    }
    return { ...MATRIX_BASE_SORT_ACCESSORS, ...trainingAccessors };
  }, [data?.masterTrainings]);

  const { sortedRows: sortedEmployees, toggleSort, sortIndicator } = useSortableRows(data?.employees, matrixSortAccessors, 'full_name');

  const setTrainingIds = (ids) => updateParam('trainings', ids.join(','));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Employees</h1>
          <p className="page-subtitle">Every employee against the Master Training Catalog. Click a name or training column for details.</p>
        </div>
        {!addingOpen && (
          <div className="page-header-actions">
            {/* Exports the currently filtered/visible rows, not the whole catalog (Keeley's
                request, 2026-09-18) - flattened one row per (employee, training) cell rather
                than the wide on-screen grid, since that's what's actually useful outside the app. */}
            <button
              className="secondary"
              disabled={!data || data.employees.length === 0}
              onClick={() => {
                downloadCsv(
                  `training-matrix${status ? `_${status.toLowerCase().replace(/\s+/g, '-')}` : ''}.csv`,
                  buildComplianceReportRows(data.employees, data.masterTrainings, { status })
                );
                api.logReportDownload('Employee Training Matrix', status ? `Status: ${status}` : undefined).catch(() => {});
              }}
            >
              Download Report
            </button>
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
        <div className="field-row">
          <label>Status</label>
          <select value={status} onChange={(e) => updateParam('status', e.target.value)}>
            <option value="">Any Status</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button type="button" className="secondary" onClick={() => setSearchParams({}, { replace: true })}>Reset Filters</button>
      </div>
      {status && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          Showing employees with at least one training marked <strong>{status}</strong>.
        </p>
      )}

      {trainingIds.length > 0 && (
        <p className="page-subtitle" style={{ marginTop: -8 }}>
          Showing employees whose {status ? <><strong>{status}</strong> trainings include</> : <>currently valid trainings include</>} <strong>{status ? 'any' : 'all'}</strong> of:{' '}
          {trainingIds.map((tid) => allMasterTrainings.find((mt) => mt.training_id === tid)?.training_name || tid).join(', ')}
        </p>
      )}

      {loading && <LoadingState label="Loading employees..." />}

      {data && !loading && (
        data.employees.length === 0 ? (
          <div className="empty-state">{emptyFilterHint(status, trainingIds, allMasterTrainings) || 'No employees match these filters.'}</div>
        ) : (
          <div className="matrix-scroll">
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort('full_name')}>Employee / Badge{sortIndicator('full_name')}</th>
                  <th className="sortable" onClick={() => toggleSort('client_name')}>Client Company{sortIndicator('client_name')}</th>
                  <th className="sortable" onClick={() => toggleSort('job_title')}>Role / Trade{sortIndicator('job_title')}</th>
                  {data.masterTrainings.map((mt) => (
                    <th key={mt.training_id} className="sortable" title={mt.training_name} onClick={() => toggleSort(mt.training_id)}>
                      <Link to={`/training-types/${mt.training_id}`} onClick={(e) => e.stopPropagation()}>{mt.training_id}</Link>
                      {sortIndicator(mt.training_id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map((emp) => (
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
