import { Fragment, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge.jsx';

function EditRow({ employee, training, onSaved, onCancel }) {
  const [completionDate, setCompletionDate] = useState(training.completion_date || '');
  const [expirationOverride, setExpirationOverride] = useState('');
  const [originalName, setOriginalName] = useState(training.original_client_training_name || '');
  const [notes, setNotes] = useState(training.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveTrainingRecord({
        record_id: training.record_id || undefined,
        client_id: employee.client_id,
        employee_id: employee.employee_id,
        training_id: training.training_id,
        original_client_training_name: originalName || null,
        completion_date: completionDate || null,
        source_expiration_date: expirationOverride || null,
        notes: notes || null,
        source: 'Manual Entry',
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td colSpan={7}>
        <div className="card" style={{ margin: '6px 0' }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="toolbar">
            <div className="field-row">
              <label>Completion Date</label>
              <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Expiration Override (optional)</label>
              <input type="date" value={expirationOverride} onChange={(e) => setExpirationOverride(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Original Client Training Name</label>
              <input type="text" value={originalName} onChange={(e) => setOriginalName(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>{' '}
          <button className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

export default function EmployeeDetail() {
  const { employeeId } = useParams();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);

  const load = () => {
    api.getEmployeeFullDetail(employeeId).then(setDetail).catch((e) => setError(e.message));
  };

  useEffect(load, [employeeId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!detail) return <div className="empty-state">Loading...</div>;

  const { employee, client, trainings } = detail;

  return (
    <div>
      <h1>{employee.full_name}</h1>
      <p className="page-subtitle">
        {client?.client_name} · Employee #{employee.employee_number || '—'} · {employee.job_title || '—'} · {employee.department || '—'}
      </p>

      <div className="card">
        <h2>Training Records</h2>
        <table>
          <thead>
            <tr>
              <th>Training ID</th>
              <th>Training Name</th>
              <th>Original Client Name</th>
              <th>Completion Date</th>
              <th>Expiration Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {trainings.map((t) => (
              <Fragment key={t.training_id}>
                <tr>
                  <td><Link to={`/trainings/${t.training_id}`}>{t.training_id}</Link></td>
                  <td>{t.training_name}</td>
                  <td>{t.original_client_training_name || '—'}</td>
                  <td>{t.completion_date || '—'}</td>
                  <td>{t.expiration_date || '—'}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>
                    <button className="secondary" onClick={() => setEditingId(editingId === t.training_id ? null : t.training_id)}>
                      {editingId === t.training_id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
                {editingId === t.training_id && (
                  <EditRow
                    employee={employee}
                    training={t}
                    onSaved={() => { setEditingId(null); load(); }}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
