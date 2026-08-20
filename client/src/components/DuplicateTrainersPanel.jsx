import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// Same merge mechanics as DuplicateEmployeesPanel (trainers are employees under the hood, so
// the same api.mergeEmployees endpoint applies) - just scoped to trainer-type duplicates and
// without a "Client" column, since trainers don't belong to one.
function DuplicateTrainerCluster({ cluster, onMerged, onIgnored }) {
  const [winnerId, setWinnerId] = useState(cluster[0].employee_id);
  const [merging, setMerging] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [error, setError] = useState('');

  const distinctPhones = new Set(cluster.map((t) => t.employee_number).filter(Boolean));
  const phonesConflict = distinctPhones.size > 1;

  const merge = async () => {
    const loserIds = cluster.filter((t) => t.employee_id !== winnerId).map((t) => t.employee_id);
    if (!window.confirm(`Merge ${loserIds.length} record(s) into ${cluster.find((t) => t.employee_id === winnerId)?.full_name}? This cannot be undone.`)) return;
    setMerging(true);
    setError('');
    try {
      await api.mergeEmployees(winnerId, loserIds);
      onMerged();
    } catch (e) {
      setError(e.message);
    } finally {
      setMerging(false);
    }
  };

  const ignore = async () => {
    if (!window.confirm("Ignore this group? It won't be flagged as a possible duplicate again unless the records change.")) return;
    setIgnoring(true);
    setError('');
    try {
      await api.ignoreDuplicateTrainers(cluster.map((t) => t.employee_id));
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
      {phonesConflict && (
        <p className="page-subtitle" style={{ color: 'var(--status-expired-text)', fontWeight: 600 }}>
          ⚠ Phone numbers differ between these records - the one not kept will be noted on the merged profile, not discarded.
        </p>
      )}
      <table>
        <thead><tr><th>Keep</th><th>Name</th><th>Phone</th><th>Role / Trade</th></tr></thead>
        <tbody>
          {cluster.map((t) => (
            <tr key={t.employee_id}>
              <td><input type="radio" name={`trainer-cluster-${cluster[0].employee_id}`} checked={winnerId === t.employee_id} onChange={() => setWinnerId(t.employee_id)} /></td>
              <td><Link to={`/employees/${t.employee_id}`}>{t.full_name}</Link></td>
              <td>{t.employee_number || '—'}{phonesConflict && t.employee_number ? ' ⚠' : ''}</td>
              <td>{t.job_title || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={merging || ignoring} onClick={merge}>{merging ? 'Merging...' : 'Merge into Selected'}</button>{' '}
      <button type="button" className="secondary" disabled={merging || ignoring} onClick={ignore}>{ignoring ? 'Ignoring...' : 'Ignore'}</button>
    </div>
  );
}

export default function DuplicateTrainersPanel({ onMerged }) {
  const [clusters, setClusters] = useState(null);

  const load = () => { api.getPossibleDuplicateTrainers().then(setClusters).catch(() => setClusters([])); };
  useEffect(load, []);

  if (!clusters || clusters.length === 0) return null;

  const handleMerged = () => {
    load();
    if (onMerged) onMerged();
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <h2>Possible Duplicate Trainers ({clusters.length})</h2>
      <p className="page-subtitle">Same name or phone number found more than once. Pick which record to keep for each group - nothing on it is lost, blank fields are filled in from the other(s). Not actually duplicates? Ignore the group instead.</p>
      {clusters.map((cluster) => (
        <DuplicateTrainerCluster key={cluster.map((t) => t.employee_id).join(',')} cluster={cluster} onMerged={handleMerged} onIgnored={load} />
      ))}
    </div>
  );
}
