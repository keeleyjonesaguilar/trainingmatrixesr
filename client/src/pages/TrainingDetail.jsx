import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function TrainingDetail() {
  const { trainingId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const clientId = searchParams.get('client_id') || '';

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    setError('');
    api.getTrainingDetail(trainingId, clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [trainingId, clientId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="empty-state">Loading...</div>;

  const { training, current, expired, noExpiration, pendingReview, missing } = data;

  return (
    <div>
      <h1>{training.training_id} — {training.training_name}</h1>
      <p className="page-subtitle">
        {training.category} · {training.training_type} · Default Expiration: {training.default_expiration} · {training.active ? 'Active' : 'Inactive'}
      </p>

      <div className="toolbar">
        <select value={clientId} onChange={(e) => setSearchParams(e.target.value ? { client_id: e.target.value } : {})}>
          <option value="">All Clients</option>
          {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
        </select>
      </div>

      <div className="card">
        <h2>Expired ({expired.length})</h2>
        <EmployeeList rows={expired} />
      </div>
      <div className="card">
        <h2>Current ({current.length})</h2>
        <EmployeeList rows={current} />
      </div>
      <div className="card">
        <h2>Completed, No Expiration ({noExpiration.length})</h2>
        <EmployeeList rows={noExpiration} />
      </div>
      <div className="card">
        <h2>Pending Review ({pendingReview.length})</h2>
        <EmployeeList rows={pendingReview} />
      </div>
      <div className="card">
        <h2>Missing ({missing.length})</h2>
        <EmployeeList rows={missing} />
      </div>
    </div>
  );
}

function EmployeeList({ rows }) {
  if (!rows.length) return <div className="empty-state">None</div>;
  return (
    <table>
      <thead><tr><th>Employee</th><th>Completed</th><th>Expiration Date</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employee_id}>
            <td><Link to={`/employees/${r.employee_id}`}>{r.full_name}</Link></td>
            <td>{r.completion_date || '—'}</td>
            <td>{r.expiration_date || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
