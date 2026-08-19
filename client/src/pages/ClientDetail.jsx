import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

const REQUIREMENT_OPTIONS = ['Required', 'Not Required', 'Optional', 'Not Applicable'];
const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];

function RequirementRow({ clientId, row, onSaved, isAdmin }) {
  const [requirementStatus, setRequirementStatus] = useState(row.requirement_status);
  const [expirationUnit, setExpirationUnit] = useState(row.client_expiration_unit || '');
  const [notes, setNotes] = useState(row.client_notes || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const markDirty = (setter) => (value) => { setter(value); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      await api.setClientRequirement(clientId, row.training_id, {
        requirement_status: requirementStatus,
        client_expiration_unit: expirationUnit || null,
        client_notes: notes || null,
        // effective_date intentionally omitted - the backend defaults it to today.
        // Rule 9: records completed before this date keep whatever they already had.
      });
      setDirty(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <tr>
        <td>{row.training_id}</td>
        <td>{row.master_training_name}</td>
        <td>{requirementStatus}</td>
        <td>
          {expirationUnit || `Master Default (${row.master_default_expiration})`}
          {' '}
          <span className="badge badge-notapplicable" style={{ marginLeft: 4 }}>{row.expiration_source}</span>
        </td>
        <td>{notes || '—'}</td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{row.training_id}</td>
      <td>{row.master_training_name}</td>
      <td>
        <select value={requirementStatus} onChange={(e) => markDirty(setRequirementStatus)(e.target.value)}>
          {REQUIREMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td>
        <select value={expirationUnit} onChange={(e) => markDirty(setExpirationUnit)(e.target.value)}>
          <option value="">Master Default ({row.master_default_expiration})</option>
          {EXPIRATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {' '}
        <span className="badge badge-notapplicable" style={{ marginLeft: 4 }}>{row.expiration_source}</span>
      </td>
      <td>
        <input type="text" placeholder="Client notes" value={notes} onChange={(e) => markDirty(setNotes)(e.target.value)} />
      </td>
      <td>
        <button disabled={!dirty || saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
      </td>
    </tr>
  );
}

// Per-client requirements/settings page (split out of the old single-page ClientSettings.jsx,
// 2026-08-18, per Keeley's request) - reached by clicking a client on the Clients directory.
export default function ClientDetail() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const loadClient = () => api.getClient(clientId).then(setClient).catch((e) => setError(e.message));
  const loadRequirements = () => api.getClientRequirements(clientId).then(setRows).catch((e) => setError(e.message));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadClient(); loadRequirements(); }, [clientId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!client) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{client.client_name}</h1>
          <p className="page-subtitle">Per-client training requirements and expiration overrides. Overrides never affect the Master Catalog or other clients.</p>
        </div>
        <div className="page-header-actions">
          <button className="secondary" onClick={() => navigate(`/sessions?client_id=${clientId}`)}>Training Sessions</button>
          <button className="secondary" onClick={() => navigate('/clients')}>&larr; All Clients</button>
        </div>
      </div>

      <div className="card">
        <h2>Training Requirements</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Training ID</th>
                <th>Master Training</th>
                <th>Requirement</th>
                <th>Expiration</th>
                <th>Client Notes</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RequirementRow key={row.training_id} clientId={clientId} row={row} isAdmin={isAdmin} onSaved={loadRequirements} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
