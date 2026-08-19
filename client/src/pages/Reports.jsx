import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

// Sortable column headers (Keeley's request, 2026-08-18): click a header to sort by it,
// click again to reverse. Kept as plain component state rather than URL search params, since
// there's no need for sort order to be bookmarkable/back-button-able the way filters are.
const SORT_ACCESSORS = {
  full_name: (r) => (r.full_name || '').toLowerCase(),
  client_name: (r) => (r.client_name || '').toLowerCase(),
  training_name: (r) => (r.training_name || '').toLowerCase(),
  completion_date: (r) => r.completion_date || '',
};

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
  const [masterTrainings, setMasterTrainings] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [sortField, setSortField] = useState('completion_date');
  const [sortDir, setSortDir] = useState('desc');

  const clientId = searchParams.get('client_id') || '';
  const trainingId = searchParams.get('training_id') || '';
  // Employee search (Keeley's request, 2026-08-19): a free-text box instead of a dropdown -
  // easier to use once there are more than a handful of employees. Matches against the
  // employee name already present on each completed-training row, client-side, so there's
  // no need to look up an employee_id first.
  const employeeSearch = searchParams.get('employee_search') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
    api.listMasterTrainings(true).then(setMasterTrainings).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api.getCompletedTrainingsReport({ client_id: clientId, training_id: trainingId })
      .then((data) => setRows(data.rows))
      .catch((e) => setError(e.message));
  }, [clientId, trainingId]);

  // replace: true - filter changes shouldn't pile up separate browser-back-button stops,
  // same fix applied to Matrix.jsx after Keeley reported the back button misbehaving there.
  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field) => (sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const sortedRows = useMemo(() => {
    if (!rows) return rows;
    const needle = employeeSearch.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => (r.full_name || '').toLowerCase().includes(needle)) : rows;
    const accessor = SORT_ACCESSORS[sortField];
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortField, sortDir, employeeSearch]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-subtitle">Every training an employee has actually completed, across all clients. Filter down as needed and export to CSV.</p>
        </div>
        {sortedRows && sortedRows.length > 0 && (
          <div className="page-header-actions">
            <button className="secondary" onClick={() => downloadCsv('completed-trainings.csv', sortedRows)}>Export CSV</button>
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
          <input
            type="search"
            placeholder="Search by name..."
            defaultValue={employeeSearch}
            onKeyDown={(e) => { if (e.key === 'Enter') updateParam('employee_search', e.target.value); }}
            onBlur={(e) => updateParam('employee_search', e.target.value)}
          />
        </div>
        <div className="field-row">
          <label>Training</label>
          <select value={trainingId} onChange={(e) => updateParam('training_id', e.target.value)}>
            <option value="">All Trainings</option>
            {masterTrainings.map((mt) => <option key={mt.training_id} value={mt.training_id}>{mt.training_id} - {mt.training_name}</option>)}
          </select>
        </div>
        <button type="button" className="secondary" onClick={() => setSearchParams({}, { replace: true })}>Reset Filters</button>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('full_name')}>Employee{sortIndicator('full_name')}</th>
                <th className="sortable" onClick={() => toggleSort('client_name')}>Client{sortIndicator('client_name')}</th>
                <th className="sortable" onClick={() => toggleSort('training_name')}>Training{sortIndicator('training_name')}</th>
                <th>Status</th>
                <th className="sortable" onClick={() => toggleSort('completion_date')}>Completed{sortIndicator('completion_date')}</th>
                <th>Expires</th>
                <th>Certificate</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows && sortedRows.map((r) => (
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
              {sortedRows && sortedRows.length === 0 && (
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
