import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function TrainingTypeDetail() {
  const { id } = useParams();
  const [sessions, setSessions] = useState([]);
  const [clientFilter, setClientFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.getSessionsByTraining(id, { client_name: clientFilter }).then(setSessions);
  }, [id, clientFilter]);

  return (
    <div>
      <Link to="/training-types" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        ← All training types
      </Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>
        {id}
      </h1>
      <p className="page-subtitle">Every completed sign-in session for this training, with its stored roster.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          placeholder="Filter by client…"
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Trainer</th>
              <th>Attendees</th>
              <th>Roster</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.session_id}>
                <td style={{ cursor: 'pointer' }} onClick={() => navigate(`/sessions/${s.session_id}`)}>
                  {s.session_date}
                </td>
                <td>{s.client_name}</td>
                <td>{s.trainer_signed_name || s.trainer_name}</td>
                <td>{s.attendee_count}</td>
                <td>
                  <a href={`/api/training-sessions/${s.session_id}/roster.pdf`}>PDF</a> ·{' '}
                  <a href={`/api/training-sessions/${s.session_id}/roster.csv`}>CSV</a>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No completed sessions for this training yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
