import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function daysBetween(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// Keeley's call: the matrix tracks completion, not compliance-against-requirements. A
// training that hasn't been completed just shows as a plain dash - it's not flagged as
// "Missing," since most trainings aren't required for most employees. Completed trainings
// show the actual completion date instead of a generic "Valid" label.
function formatCell(cell) {
  if (!cell) return { text: '—', plain: true };
  switch (cell.status) {
    case 'Current': {
      const dateText = formatDate(cell.completion_date);
      if (cell.expiring_soon) {
        const d = daysBetween(cell.expiration_date);
        return { text: `${dateText} (expires in ${d}d)`, className: 'badge-expiringsoon' };
      }
      return { text: dateText, className: 'badge-current' };
    }
    case 'No Expiration':
      return { text: formatDate(cell.completion_date), className: 'badge-noexpiration' };
    case 'Expired': {
      const d = daysBetween(cell.expiration_date);
      return { text: `${formatDate(cell.completion_date)} (expired ${d !== null ? `${Math.abs(d)}d ago` : ''})`, className: 'badge-expired' };
    }
    case 'Not Applicable':
      return { text: 'N/A', className: 'badge-notapplicable' };
    case 'Pending Review':
      return { text: 'Pending Review', className: 'badge-pendingreview' };
    case 'Missing':
    default:
      return { text: '-', plain: true };
  }
}

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

export default function Matrix() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [allMasterTrainings, setAllMasterTrainings] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const clientId = searchParams.get('client_id') || '';
  const search = searchParams.get('search') || '';
  const trainingIds = (searchParams.get('trainings') || '').split(',').filter(Boolean);

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
    for (const tid of trainingIds) params.append('training_ids', tid);
    api.getMatrix(params).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, search, trainingIds.join(',')]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const setTrainingIds = (ids) => updateParam('trainings', ids.join(','));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Master Training Matrix</h1>
          <p className="page-subtitle">Every employee against the Master Training Catalog. Click a name or training column for details.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {data && (
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Audited Employees</div>
            <div className="value">{data.stats.audited_employees}</div>
            <span className="caption">Across {clients.length} clients</span>
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
        <button type="button" className="secondary" onClick={() => setSearchParams({})}>Reset Filters</button>
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
                      <Link to={`/trainings/${mt.training_id}`}>{mt.training_id}</Link>
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
