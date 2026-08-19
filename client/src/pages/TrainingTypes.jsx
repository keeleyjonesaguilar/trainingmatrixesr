import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function TrainingTypes() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.getTrainingSessionsSummaryByTraining().then(setData);
  }, []);

  if (!data) return <p>Loading…</p>;

  const filtered = data.trainings.filter(
    (t) =>
      !search ||
      t.training_name.toLowerCase().includes(search.toLowerCase()) ||
      t.training_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h1 className="page-title">Training Types</h1>
      <p className="page-subtitle">
        Every training in the catalog — jump into any one to see every completed sign-in session and its stored
        roster, across every client.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <input placeholder="Search training types…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Training</th>
              <th>Category</th>
              <th>Completed Sessions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.training_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/training-types/${t.training_id}`)}>
                <td>{t.training_id}</td>
                <td>{t.training_name}</td>
                <td>{t.category}</td>
                <td>{t.completed_session_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.custom.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Custom / Uncatalogued Training Labels</h3>
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Completed Sessions</th>
              </tr>
            </thead>
            <tbody>
              {data.custom.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
