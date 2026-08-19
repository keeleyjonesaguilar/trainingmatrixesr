import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status === 'open' ? 'Open' : 'Closed'}</span>;
}

export default function Sessions() {
  const isAdmin = useIsAdmin();
  const [searchParams] = useSearchParams();
  const clientIdFilter = searchParams.get('client_id') || '';
  const [sessions, setSessions] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [filters, setFilters] = useState({ client_name: '', status: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const [form, setForm] = useState({
    client_name: '',
    master_training_id: '',
    trainer_name: '',
    session_date: new Date().toISOString().slice(0, 10),
    outline: '',
  });
  const [creating, setCreating] = useState(false);

  const load = () => {
    api
      .listTrainingSessions({ ...filters, client_id: clientIdFilter })
      .then(setSessions)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    api.listMasterTrainings(true).then(setTrainings).catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the primitive filter values matter, not object identity
  useEffect(load, [filters.client_name, filters.status, clientIdFilter]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.client_name || !form.trainer_name || !form.session_date) {
      setError('Client, trainer, and date are required.');
      return;
    }
    const training = trainings.find((t) => t.training_id === form.master_training_id);
    const training_type_label = training
      ? `${training.training_id} - ${training.training_name}`
      : form.master_training_id || 'Custom Training';
    if (!training && !form.master_training_id) {
      setError('Please select a training type.');
      return;
    }
    setCreating(true);
    try {
      const session = await api.createTrainingSession({
        client_name: form.client_name,
        master_training_id: form.master_training_id || null,
        training_type_label,
        trainer_name: form.trainer_name,
        session_date: form.session_date,
        outline: form.outline,
      });
      navigate(`/sessions/${session.session_id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Training Sessions</h1>
      <p className="page-subtitle">
        Create a sign-in sheet, generate its QR code, and track rosters as they come in — closing a session writes
        each attendee straight into their employee file.
      </p>

      {error && <p className="error-banner">{error}</p>}

      {isAdmin && (
        <div className="card" style={{ marginBottom: 20 }}>
          {!showForm ? (
            <button className="btn btn-accent" onClick={() => setShowForm(true)}>
              + New Session
            </button>
          ) : (
            <form onSubmit={submit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="field">
                  <label>Client</label>
                  <input
                    value={form.client_name}
                    onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                    placeholder="Resolute Builders"
                  />
                </div>
                <div className="field">
                  <label>Training Type</label>
                  <select
                    value={form.master_training_id}
                    onChange={(e) => setForm({ ...form, master_training_id: e.target.value })}
                  >
                    <option value="">Select a training…</option>
                    {trainings.map((t) => (
                      <option key={t.training_id} value={t.training_id}>
                        {t.training_id} - {t.training_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Trainer Name</label>
                  <input
                    value={form.trainer_name}
                    onChange={(e) => setForm({ ...form, trainer_name: e.target.value })}
                    placeholder="Jamie Trainer"
                  />
                </div>
                <div className="field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={form.session_date}
                    onChange={(e) => setForm({ ...form, session_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Outline / Topics Covered</label>
                <textarea
                  rows={3}
                  value={form.outline}
                  onChange={(e) => setForm({ ...form, outline: e.target.value })}
                  placeholder="What will this session cover?"
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-accent" type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create Session & Generate QR Code'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <input
          placeholder="Filter by client…"
          value={filters.client_name}
          onChange={(e) => setFilters({ ...filters, client_name: e.target.value })}
          style={{ maxWidth: 260 }}
        />
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          style={{ maxWidth: 160 }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Training</th>
              <th>Trainer</th>
              <th>Attendees</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.session_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/sessions/${s.session_id}`)}>
                <td>{s.session_date}</td>
                <td>{s.client_name}</td>
                <td>{s.training_type_label}</td>
                <td>{s.trainer_signed_name || s.trainer_name}</td>
                <td>{s.attendee_count}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
