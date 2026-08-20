import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// Same shape as DuplicateEmployeesPanel: pick which client record to keep, the rest get
// merged into it - every employee, training record, requirement, session, and import batch
// moves over (nothing lost), and anything that becomes a duplicate employee/session as a
// direct result of combining the two client rosters is then auto-merged too.
function DuplicateClientCluster({ cluster, onMerged, onIgnored }) {
  const [winnerId, setWinnerId] = useState(cluster[0].client_id);
  const [merging, setMerging] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [error, setError] = useState('');

  const merge = async () => {
    const loserIds = cluster.filter((c) => c.client_id !== winnerId).map((c) => c.client_id);
    if (!window.confirm(`Merge ${loserIds.length} client record(s) into ${cluster.find((c) => c.client_id === winnerId)?.client_name}? This cannot be undone.`)) return;
    setMerging(true);
    setError('');
    try {
      await api.mergeClients(winnerId, loserIds);
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
      await api.ignoreDuplicateClients(cluster.map((c) => c.client_id));
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
        <thead><tr><th>Keep</th><th>Client Name</th><th>Employees</th><th>Status</th></tr></thead>
        <tbody>
          {cluster.map((c) => (
            <tr key={c.client_id}>
              <td><input type="radio" name={`client-cluster-${cluster[0].client_id}`} checked={winnerId === c.client_id} onChange={() => setWinnerId(c.client_id)} /></td>
              <td><Link to={`/clients/${c.client_id}`}>{c.client_name}</Link></td>
              <td>{c.employee_count ?? '—'}</td>
              <td>{c.active ? 'Active' : 'Inactive'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={merging || ignoring} onClick={merge}>{merging ? 'Merging...' : 'Merge into Selected'}</button>{' '}
      <button type="button" className="secondary" disabled={merging || ignoring} onClick={ignore}>{ignoring ? 'Ignoring...' : 'Ignore'}</button>
    </div>
  );
}

export default function DuplicateClientsPanel({ onMerged }) {
  const [clusters, setClusters] = useState(null);

  const load = () => { api.getPossibleDuplicateClients().then(setClusters).catch(() => setClusters([])); };
  useEffect(load, []);

  if (!clusters || clusters.length === 0) return null;

  const handleMerged = () => {
    load();
    if (onMerged) onMerged();
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <h2>Possible Duplicate Clients ({clusters.length})</h2>
      <p className="page-subtitle">Same client name found more than once. Pick which record to keep for each group - everything from both sides is combined, nothing is lost. Not actually duplicates? Ignore the group instead.</p>
      {clusters.map((cluster) => (
        <DuplicateClientCluster key={cluster.map((c) => c.client_id).join(',')} cluster={cluster} onMerged={handleMerged} onIgnored={load} />
      ))}
    </div>
  );
}
