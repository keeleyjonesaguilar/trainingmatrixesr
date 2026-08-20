import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// One cluster of possible-duplicate employees (Keeley's request): pick which record to keep,
// the rest get merged into it - their training records and sign-in-roster links move over,
// and any field left blank on the kept record gets backfilled from a merged one, so no data
// from either side is lost. Shared between the Employees page and the Dashboard.
function DuplicateCluster({ cluster, onMerged, onIgnored }) {
  const [winnerId, setWinnerId] = useState(cluster[0].employee_id);
  const [merging, setMerging] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [error, setError] = useState('');

  const merge = async () => {
    const loserIds = cluster.filter((e) => e.employee_id !== winnerId).map((e) => e.employee_id);
    if (!window.confirm(`Merge ${loserIds.length} record(s) into ${cluster.find((e) => e.employee_id === winnerId)?.full_name}? This cannot be undone.`)) return;
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
      await api.ignoreDuplicateEmployees(cluster.map((e) => e.employee_id));
      onIgnored();
    } catch (e) {
      setError(e.message);
    } finally {
      setIgnoring(false);
    }
  };

  const distinctPhones = new Set(cluster.map((e) => e.employee_number).filter(Boolean));
  const phonesConflict = distinctPhones.size > 1;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      {error && <div className="error-banner">{error}</div>}
      {phonesConflict && (
        <p className="page-subtitle" style={{ color: 'var(--status-expired-text)', fontWeight: 600 }}>
          ⚠ Phone numbers differ between these records - the one not kept will be noted on the merged profile, not discarded.
        </p>
      )}
      <table>
        <thead><tr><th>Keep</th><th>Name</th><th>Phone</th><th>Client</th></tr></thead>
        <tbody>
          {cluster.map((e) => (
            <tr key={e.employee_id}>
              <td><input type="radio" name={`cluster-${cluster[0].employee_id}`} checked={winnerId === e.employee_id} onChange={() => setWinnerId(e.employee_id)} /></td>
              <td><Link to={`/employees/${e.employee_id}`}>{e.full_name}</Link></td>
              <td>{e.employee_number || '—'}{phonesConflict && e.employee_number ? ' ⚠' : ''}</td>
              <td>{e.client_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={merging || ignoring} onClick={merge}>{merging ? 'Merging...' : 'Merge into Selected'}</button>{' '}
      <button type="button" className="secondary" disabled={merging || ignoring} onClick={ignore}>{ignoring ? 'Ignoring...' : 'Ignore'}</button>
    </div>
  );
}

export default function DuplicateEmployeesPanel({ onMerged }) {
  const [clusters, setClusters] = useState(null);

  const load = () => { api.getPossibleDuplicateEmployees().then(setClusters).catch(() => setClusters([])); };
  useEffect(load, []);

  if (!clusters || clusters.length === 0) return null;

  const handleMerged = () => {
    load();
    if (onMerged) onMerged();
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <h2>Possible Duplicate Employees ({clusters.length})</h2>
      <p className="page-subtitle">Same name or phone number found more than once for the same client. Pick which record to keep for each group - nothing on it is lost, blank fields are filled in from the other(s). Not actually duplicates? Ignore the group instead.</p>
      {clusters.map((cluster) => (
        <DuplicateCluster key={cluster.map((e) => e.employee_id).join(',')} cluster={cluster} onMerged={handleMerged} onIgnored={load} />
      ))}
    </div>
  );
}
