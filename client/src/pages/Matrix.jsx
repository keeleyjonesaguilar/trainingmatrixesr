import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge.jsx';

const ALL_STATUSES = ['Current', 'Expired', 'Missing', 'Not Applicable', 'No Expiration', 'Pending Review'];

export default function Matrix() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [facets, setFacets] = useState({ departments: [], jobTitles: [] });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const clientId = searchParams.get('client_id') || '';
  const department = searchParams.get('department') || '';
  const jobTitle = searchParams.get('job_title') || '';
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api.getEmployeeFacets(clientId || undefined).then(setFacets).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = {};
    if (clientId) params.client_id = clientId;
    if (department) params.department = department;
    if (jobTitle) params.job_title = jobTitle;
    if (search) params.search = search;
    if (status) params.status = status;
    api.getMatrix(params).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [clientId, department, jobTitle, search, status]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  return (
    <div>
      <h1>Training Matrix</h1>
      <p className="page-subtitle">Every employee against the Master Training Catalog. Click a name or training column for details.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <select value={clientId} onChange={(e) => updateParam('client_id', e.target.value)}>
          <option value="">All Clients</option>
          {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
        </select>
        <select value={department} onChange={(e) => updateParam('department', e.target.value)}>
          <option value="">All Departments</option>
          {facets.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={jobTitle} onChange={(e) => updateParam('job_title', e.target.value)}>
          <option value="">All Job Titles</option>
          {facets.jobTitles.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <select value={status} onChange={(e) => updateParam('status', e.target.value)}>
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="search"
          placeholder="Search employee name..."
          defaultValue={search}
          onKeyDown={(e) => { if (e.key === 'Enter') updateParam('search', e.target.value); }}
          onBlur={(e) => updateParam('search', e.target.value)}
        />
      </div>

      {loading && <div className="empty-state">Loading matrix...</div>}

      {data && !loading && (
        data.employees.length === 0 ? (
          <div className="empty-state">No employees match these filters.</div>
        ) : (
          <div className="matrix-scroll">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Client</th>
                  <th>Job Title</th>
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
                      return (
                        <td key={mt.training_id}>
                          <StatusBadge status={cell?.status} />
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
