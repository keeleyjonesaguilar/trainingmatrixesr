import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// A trainer profile and a real employee sharing a name/phone are very likely the same person
// (Keeley's request, 2026-09-21) - unlike the Possible Duplicate Trainers panel above, the
// "winner" here is never in question: the employee side always wins, so the merged person keeps
// living under their real client with their own completed-trainings history intact, and still
// shows up on this page (see server/routes/trainers.js's GET / - anyone credited as a session's
// trainer belongs here regardless of employee_type/client). The merge itself reuses the same
// api.mergeEmployees endpoint the duplicate panels use; the trainer_employee_id repointing that
// makes their taught sessions survive the merge lives in server/lib/repo.js's mergeEmployees.
function CrossMatchRow({ match, onMerged, onIgnored }) {
  const { trainer, employee } = match;
  const [merging, setMerging] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [error, setError] = useState('');

  const merge = async () => {
    if (!window.confirm(
      `Merge trainer profile "${trainer.full_name}" into employee "${employee.full_name}" (${employee.client_name})?\n\n` +
      `${employee.full_name} will keep their own client and completed trainings, and will also show every session ${trainer.full_name} has taught. This cannot be undone.`
    )) return;
    setMerging(true);
    setError('');
    try {
      await api.mergeEmployees(employee.employee_id, [trainer.employee_id]);
      onMerged();
    } catch (e) {
      setError(e.message);
    } finally {
      setMerging(false);
    }
  };

  const ignore = async () => {
    if (!window.confirm("Ignore this match? It won't be flagged again unless the records change.")) return;
    setIgnoring(true);
    setError('');
    try {
      await api.ignoreTrainerEmployeeCrossMatch(trainer.employee_id, employee.employee_id);
      onIgnored();
    } catch (e) {
      setError(e.message);
    } finally {
      setIgnoring(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      {error && <div className="error-banner">{error}</div>}
      <table>
        <thead><tr><th></th><th>Name</th><th>Client</th><th>Phone</th><th>Role / Trade</th></tr></thead>
        <tbody>
          <tr>
            <td className="page-subtitle" style={{ margin: 0 }}>Trainer profile</td>
            <td><Link to={`/employees/${trainer.employee_id}`}>{trainer.full_name}</Link></td>
            <td>Internal / Trainers</td>
            <td>{trainer.employee_number || '—'}</td>
            <td>{trainer.job_title || '—'}</td>
          </tr>
          <tr>
            <td className="page-subtitle" style={{ margin: 0 }}>Employee</td>
            <td><Link to={`/employees/${employee.employee_id}`}>{employee.full_name}</Link></td>
            <td>{employee.client_name}</td>
            <td>{employee.employee_number || '—'}</td>
            <td>{employee.job_title || '—'}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" disabled={merging || ignoring} onClick={merge}>{merging ? 'Merging...' : 'Merge Into Employee'}</button>{' '}
      <button type="button" className="secondary" disabled={merging || ignoring} onClick={ignore}>{ignoring ? 'Ignoring...' : 'Not the Same Person'}</button>
    </div>
  );
}

export default function TrainerEmployeeMatchesPanel({ onMerged }) {
  const [matches, setMatches] = useState(null);

  const load = () => { api.getTrainerEmployeeCrossMatches().then(setMatches).catch(() => setMatches([])); };
  useEffect(load, []);

  if (!matches || matches.length === 0) return null;

  const handleMerged = () => {
    load();
    if (onMerged) onMerged();
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <h2>Trainers Who May Also Be Employees ({matches.length})</h2>
      <p className="page-subtitle">
        Same name or phone number found on both a trainer profile and a real employee elsewhere in the system.
        Merging keeps the employee's own client and training history, and folds in everything the trainer has taught.
      </p>
      {matches.map((m) => (
        <CrossMatchRow key={`${m.trainer.employee_id}-${m.employee.employee_id}`} match={m} onMerged={handleMerged} onIgnored={load} />
      ))}
    </div>
  );
}
