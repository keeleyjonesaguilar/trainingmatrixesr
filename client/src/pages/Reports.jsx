import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const REPORT_TABS = ['Client Compliance', 'Employee Training', 'Training Compliance', 'Expiring Soon', 'Client Exceptions'];

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

function ClientComplianceReport({ clientId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getClientComplianceReport(clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [clientId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Client Compliance Report</h2>
        <button className="secondary" onClick={() => downloadCsv('client-compliance.csv', data.rows)}>Export CSV</button>
      </div>
      <div className="stat-grid">
        {Object.entries(data.summary).map(([status, count]) => (
          <div key={status} className="stat-tile">
            <div className="stat-label">{status}</div>
            <div className="value">{count}</div>
          </div>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Employee</th><th>Client</th><th>Training</th><th>Status</th><th>Completed</th><th>Expires</th></tr></thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td>
                <td>{r.client_name}</td>
                <td>{r.training_id} - {r.training_name}</td>
                <td><span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span></td>
                <td>{r.completion_date || '—'}</td>
                <td>{r.expiration_date || '—'}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={6} className="empty-state">No required trainings in scope.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmployeeTrainingReport() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.listEmployees().then(setEmployees).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!employeeId) { setData(null); return; }
    api.getEmployeeTrainingReport(employeeId).then(setData).catch((e) => setError(e.message));
  }, [employeeId]);

  return (
    <div className="card">
      <div className="toolbar">
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select an employee...</option>
          {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
        </select>
        {data && <button className="secondary" onClick={() => downloadCsv(`${data.employee.full_name}-history.csv`, data.records)}>Export CSV</button>}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {data && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Training</th><th>Original Client Wording</th><th>Status</th><th>Completed</th><th>Expires</th><th>Source</th><th>Flag</th></tr></thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.record_id}>
                  <td>{r.training_id} - {r.master_training_name}</td>
                  <td>{r.original_client_training_name || '—'}</td>
                  <td><span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span></td>
                  <td>{r.completion_date || '—'}</td>
                  <td>{r.expiration_date || '—'}</td>
                  <td>{r.source || '—'}</td>
                  <td>{r.duplicate_status !== 'none' ? r.duplicate_status : '—'}{r.is_active_record ? '' : ' (superseded)'}</td>
                </tr>
              ))}
              {data.records.length === 0 && <tr><td colSpan={7} className="empty-state">No training history on file.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TrainingComplianceReport({ clientId }) {
  const [masterTrainings, setMasterTrainings] = useState([]);
  const [trainingId, setTrainingId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.listMasterTrainings(true).then(setMasterTrainings).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!trainingId) { setData(null); return; }
    api.getTrainingComplianceReport(trainingId, clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [trainingId, clientId]);

  return (
    <div className="card">
      <div className="toolbar">
        <select value={trainingId} onChange={(e) => setTrainingId(e.target.value)}>
          <option value="">Select a training...</option>
          {masterTrainings.map((mt) => <option key={mt.training_id} value={mt.training_id}>{mt.training_id} - {mt.training_name}</option>)}
        </select>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {data && (
        <div className="stat-grid">
          {Object.entries(data.buckets).map(([status, rows]) => (
            <div key={status} className="stat-tile">
              <div className="stat-label">{status}</div>
              <div className="value">{rows.length}</div>
            </div>
          ))}
        </div>
      )}
      {data && Object.entries(data.buckets).map(([status, rows]) => rows.length > 0 && (
        <div key={status} style={{ marginTop: 16 }}>
          <h3>{status} ({rows.length})</h3>
          <table>
            <thead><tr><th>Employee</th><th>Expiration</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id}><td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td><td>{r.expiration_date || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ExpiringSoonReport({ clientId }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getExpiringSoonReport(days, clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [days, clientId]);

  return (
    <div className="card">
      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Next 30 days</option>
          <option value={60}>Next 60 days</option>
          <option value={90}>Next 90 days</option>
        </select>
        {data && <button className="secondary" onClick={() => downloadCsv('expiring-soon.csv', data.rows)}>Export CSV</button>}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {data && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Employee</th><th>Client</th><th>Training</th><th>Expires</th></tr></thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td>
                  <td>{r.client_name}</td>
                  <td>{r.training_id} - {r.training_name}</td>
                  <td>{r.expiration_date}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={4} className="empty-state">Nothing expiring in this window.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClientExceptionReport({ clientId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getClientExceptionReport(clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [clientId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  return (
    <div className="card">
      <h2>Client-Specific Expiration Overrides ({data.expirationOverrides.length})</h2>
      <table>
        <thead><tr><th>Client</th><th>Training</th><th>Override</th><th>Effective Date</th></tr></thead>
        <tbody>
          {data.expirationOverrides.map((r) => (
            <tr key={r.requirement_id}><td>{r.client_name}</td><td>{r.training_name}</td><td>{r.client_expiration_unit}</td><td>{r.effective_date || '—'}</td></tr>
          ))}
          {data.expirationOverrides.length === 0 && <tr><td colSpan={4} className="empty-state">None.</td></tr>}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Pending Import Mapping Reviews ({data.pendingMappings.length})</h2>
      <table>
        <thead><tr><th>Client</th><th>File</th><th>Source Column</th></tr></thead>
        <tbody>
          {data.pendingMappings.map((r) => (
            <tr key={r.map_id}><td>{r.client_name}</td><td>{r.filename}</td><td>{r.source_column_header}</td></tr>
          ))}
          {data.pendingMappings.length === 0 && <tr><td colSpan={3} className="empty-state">None.</td></tr>}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Duplicate Records Flagged for Review ({data.duplicateRecords.length})</h2>
      <table>
        <thead><tr><th>Employee</th><th>Client</th><th>Training</th><th>Completed</th></tr></thead>
        <tbody>
          {data.duplicateRecords.map((r) => (
            <tr key={r.record_id}><td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td><td>{r.client_name}</td><td>{r.training_name}</td><td>{r.completion_date || '—'}</td></tr>
          ))}
          {data.duplicateRecords.length === 0 && <tr><td colSpan={4} className="empty-state">None.</td></tr>}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Pending Review Records ({data.pendingReviewRecords.length})</h2>
      <table>
        <thead><tr><th>Employee</th><th>Client</th><th>Training</th><th>Raw Source Value</th></tr></thead>
        <tbody>
          {data.pendingReviewRecords.map((r) => (
            <tr key={r.record_id}><td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td><td>{r.client_name}</td><td>{r.training_name}</td><td>{r.raw_source_value || '—'}</td></tr>
          ))}
          {data.pendingReviewRecords.length === 0 && <tr><td colSpan={4} className="empty-state">None.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('Client Compliance');
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.listClients().then(setClients).catch((e) => setError(e.message)); }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-subtitle">Compliance, exception, and history reports across the Training Matrix.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <div className="field-row">
          <label>Client Scope</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All Clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
      </div>

      <div className="tab-row">
        {REPORT_TABS.map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Client Compliance' && <ClientComplianceReport clientId={clientId} />}
      {tab === 'Employee Training' && <EmployeeTrainingReport />}
      {tab === 'Training Compliance' && <TrainingComplianceReport clientId={clientId} />}
      {tab === 'Expiring Soon' && <ExpiringSoonReport clientId={clientId} />}
      {tab === 'Client Exceptions' && <ClientExceptionReport clientId={clientId} />}
    </div>
  );
}
