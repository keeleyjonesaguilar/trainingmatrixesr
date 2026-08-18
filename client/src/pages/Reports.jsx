import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

// Reports (rebuilt 2026-08-18 per Keeley's request): one unified view of trainings employees
// have actually completed - no report-type tabs, no Current/Missing/etc. summary tiles. If a
// training hasn't been completed, it doesn't show up here; there's nothing to "report" on it.
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function statusBadgeClass(status) {
  switch (status) {
    case 'Current': return 'badge-current';
    case 'Expired': return 'badge-expired';
    case 'Pending Review': return 'badge-pendingreview';
    case 'No Expiration': return 'badge-noexpiration';
    default: return 'badge-notapplicable';
  }
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [masterTrainings, setMasterTrainings] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const clientId = searchParams.get('client_id') || '';
  const employeeId = searchParams.get('employee_id') || '';
  const trainingId = searchParams.get('training_id') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
    api.listEmployees().then(setEmployees).catch((e) => setError(e.message));
    api.listMasterTrainings(true).then(setMasterTrainings).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api.getCompletedTrainingsReport({ client_id: clientId, employee_id: employeeId, training_id: trainingId })
      .then((data) => setRows(data.rows))
      .catch((e) => setError(e.message));
  }, [clientId, employeeId, trainingId]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    // A client change invalidates an employee filter from a different client.
    if (key === 'client_id') next.delete('employee_id');
    setSearchParams(next);
  };

  const employeeOptions = clientId ? employees.filter((e) => e.client_id === clientId) : employees;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-subtitle">Every training an employee has actually completed, across all clients. Filter down as needed and export to CSV.</p>
        </div>
        {rows && rows.length > 0 && (
          <div className="page-header-actions">
            <button className="secondary" onClick={() => downloadCsv('completed-trainings.csv', rows)}>Export CSV</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <div className="field-row">
          <label>Client</label>
          <select value={clientId} onChange={(e) => updateParam('client_id', e.target.value)}>
            <option value="">All Clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Employee</label>
          <select value={employeeId} onChange={(e) => updateParam('employee_id', e.target.value)}>
            <option value="">All Employees</option>
            {employeeOptions.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Training</label>
          <select value={trainingId} onChange={(e) => updateParam('training_id', e.target.value)}>
            <option value="">All Trainings</option>
            {masterTrainings.map((mt) => <option key={mt.training_id} value={mt.training_id}>{mt.training_id} - {mt.training_name}</option>)}
          </select>
        </div>
        <button type="button" className="secondary" onClick={() => setSearchParams({})}>Reset Filters</button>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Client</th>
                <th>Training</th>
                <th>Status</th>
                <th>Completed</th>
                <th>Expires</th>
                <th>Certificate</th>
              </tr>
            </thead>
            <tbody>
              {rows && rows.map((r) => (
                <tr key={r.record_id}>
                  <td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td>
                  <td>{r.client_name}</td>
                  <td>{r.training_id} - {r.training_name}</td>
                  <td><span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span></td>
                  <td>{formatDate(r.completion_date)}</td>
                  <td>{formatDate(r.expiration_date)}</td>
                  <td>{r.certificate_filename ? <a href={api.getCertificateUrl(r.record_id)} target="_blank" rel="noreferrer">View</a> : '—'}</td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr><td colSpan={7} className="empty-state">No completed trainings match these filters.</td></tr>
              )}
            </tbody>
          </table>
          {!rows && <div className="empty-state">Loading...</div>}
        </div>
      </div>
    </div>
  );
}
