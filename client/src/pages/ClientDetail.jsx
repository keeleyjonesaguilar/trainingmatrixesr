import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

const REQUIREMENT_OPTIONS = ['Required', 'Not Required', 'Optional', 'Not Applicable'];
const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];

// At-a-glance summary (Keeley's request) - links out to the existing Dashboard drilldown/Action
// Required page rather than re-rendering their numbers here, so this stays the one place those
// figures actually live and this settings page never shows a stale copy of them.
function ClientSummaryStrip({ clientId }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.getDashboard(clientId).then(setSummary).catch(() => {});
  }, [clientId]);

  if (!summary) return null;

  return (
    <div className="stat-grid" style={{ marginBottom: 16 }}>
      <div className="stat-tile clickable" onClick={() => navigate(`/matrix?client_id=${clientId}`)}>
        <div className="stat-label">Employees</div>
        <div className="value">{summary.totalActiveEmployees}</div>
        <span className="caption">View Employees</span>
      </div>
      <div className="stat-tile clickable" onClick={() => navigate(`/?client_id=${clientId}`)}>
        <div className="stat-label">Compliance</div>
        <div className="value">{summary.complianceRate}%</div>
        <span className="caption">View Client Overview</span>
      </div>
      <div className="stat-tile">
        <div className="stat-label">Status</div>
        {summary.healthStatus === 'Action Required' ? (
          <button
            type="button"
            className="badge pill-action-required"
            style={{ border: 'none', cursor: 'pointer', marginTop: 4 }}
            onClick={() => navigate(`/action-required?client_id=${clientId}`)}
          >
            Action Required →
          </button>
        ) : (
          <span className="badge pill-compliant" style={{ marginTop: 4 }}>Compliant</span>
        )}
      </div>
    </div>
  );
}

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

// Client notes (Keeley's request) - the data column already existed (set at creation time) but
// had no way to view or edit it afterward. Free text for whatever's useful to keep on file:
// site contacts, address, access instructions, anything that doesn't fit the training settings.
function ClientNotes({ client, onSaved }) {
  const isAdmin = useIsAdmin();
  const [notes, setNotes] = useState(client.notes || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateClient(client.client_id, { notes: notes.trim() || null });
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Notes</h2>
      {error && <div className="error-banner">{error}</div>}
      {isAdmin ? (
        <>
          <textarea
            rows={3}
            style={{ width: '100%' }}
            placeholder="Site contacts, address, access instructions, anything worth keeping on file for this client..."
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
          />
          <button style={{ marginTop: 8 }} disabled={!dirty || saving} onClick={save}>{saving ? 'Saving...' : 'Save Notes'}</button>
        </>
      ) : (
        <p className="page-subtitle" style={{ margin: 0 }}>{client.notes || 'No notes on file.'}</p>
      )}
    </div>
  );
}

// Delete Client (Keeley's request): a type-the-name-to-confirm flow, since this cascades to
// every employee/training-record/session/import batch under this client and can't be undone -
// a bare window.confirm() felt too thin for something this destructive. Deactivate sits right
// next to it (reversible, but still requires typing "deactivate" so it's never an accidental
// click) - reactivating back is a plain one-click toggle since that direction is always safe.
function DangerZone({ client, onDeactivated }) {
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivateConfirmText, setDeactivateConfirmText] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState('');

  const doDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await api.deleteClient(client.client_id);
      navigate('/clients');
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  const doDeactivate = async () => {
    setDeactivating(true);
    setError('');
    try {
      await api.updateClient(client.client_id, { active: false });
      setConfirmingDeactivate(false);
      setDeactivateConfirmText('');
      onDeactivated();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeactivating(false);
    }
  };

  const doReactivate = async () => {
    setDeactivating(true);
    setError('');
    try {
      await api.updateClient(client.client_id, { active: true });
      onDeactivated();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Danger Zone</h2>
      {error && <div className="error-banner">{error}</div>}
      <p className="page-subtitle">
        Permanently deletes this client and everything under it — employees, training records, sessions, and
        import history. This cannot be undone. Deactivating just hides it from the active list — reversible any time.
      </p>

      {!client.active ? (
        <button type="button" className="secondary" disabled={deactivating} onClick={doReactivate}>
          {deactivating ? 'Saving...' : 'Reactivate Client'}
        </button>
      ) : !confirmingDeactivate ? (
        <button type="button" className="secondary" onClick={() => setConfirmingDeactivate(true)}>Deactivate Client</button>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div className="field-row">
            <label>Type "deactivate" to confirm</label>
            <input type="text" value={deactivateConfirmText} onChange={(e) => setDeactivateConfirmText(e.target.value)} />
          </div>
          <button
            type="button"
            className="secondary"
            disabled={deactivateConfirmText.trim().toLowerCase() !== 'deactivate' || deactivating}
            onClick={doDeactivate}
          >
            {deactivating ? 'Saving...' : 'Confirm Deactivate'}
          </button>{' '}
          <button type="button" className="secondary" onClick={() => { setConfirmingDeactivate(false); setDeactivateConfirmText(''); }}>Cancel</button>
        </div>
      )}
      {' '}
      {!confirmingDelete ? (
        <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>Delete Client</button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="field-row">
            <label>Type "{client.client_name}" to confirm</label>
            <input type="text" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} />
          </div>
          <button
            type="button"
            className="danger"
            disabled={deleteConfirmText.trim().toLowerCase() !== client.client_name.trim().toLowerCase() || deleting}
            onClick={doDelete}
          >
            {deleting ? 'Deleting...' : 'Permanently Delete'}
          </button>{' '}
          <button type="button" className="secondary" onClick={() => { setConfirmingDelete(false); setDeleteConfirmText(''); }}>Cancel</button>
        </div>
      )}
    </div>
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

      <ClientSummaryStrip clientId={clientId} />

      <ClientNotes client={client} onSaved={loadClient} />

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

      {isAdmin && <DangerZone client={client} onDeactivated={loadClient} />}
    </div>
  );
}
