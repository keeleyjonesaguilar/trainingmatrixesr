import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const STAT_ORDER = ['Current', 'Expired', 'Missing', 'Not Applicable', 'No Expiration', 'Pending Review'];

export default function Dashboard() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.listClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setError('');
    api.getDashboard(clientId || undefined).then(setData).catch((e) => setError(e.message));
  }, [clientId]);

  const goToMatrix = (status) => {
    const params = new URLSearchParams();
    if (clientId) params.set('client_id', clientId);
    if (status) params.set('status', status);
    navigate(`/matrix?${params.toString()}`);
  };

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="page-subtitle">Compliance overview across all clients, or drill into one.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c.client_id} value={c.client_id}>{c.client_name}</option>
          ))}
        </select>
      </div>

      {data && (
        <>
          <div className="card">
            <h2>{data.scope === 'client' ? data.client.client_name : 'All Clients'}</h2>
            <div className="stat-grid">
              {data.scope === 'all' && (
                <div className="stat-tile">
                  <div className="value">{data.totalClients}</div>
                  <div className="label">Total Clients</div>
                </div>
              )}
              <div className="stat-tile">
                <div className="value">{data.totalActiveEmployees}</div>
                <div className="label">Active Employees</div>
              </div>
              <div className="stat-tile">
                <div className="value">{data.totalTrainingRecords}</div>
                <div className="label">Training Records</div>
              </div>
              {STAT_ORDER.map((status) => (
                <div key={status} className="stat-tile clickable" onClick={() => goToMatrix(status)}>
                  <div className="value">{data.counts[status] ?? 0}</div>
                  <div className="label">{status}</div>
                </div>
              ))}
            </div>
          </div>

          {data.scope === 'all' && (
            <div className="card">
              <h2>By Client</h2>
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Active Employees</th>
                    <th>Records</th>
                    {STAT_ORDER.map((s) => <th key={s}>{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.perClient.map((c) => (
                    <tr key={c.client_id} style={{ cursor: 'pointer' }} onClick={() => setClientId(c.client_id)}>
                      <td>{c.client_name}</td>
                      <td>{c.totalActiveEmployees}</td>
                      <td>{c.totalTrainingRecords}</td>
                      {STAT_ORDER.map((s) => <td key={s}>{c.counts[s] ?? 0}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
