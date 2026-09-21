import { useState } from 'react';
import { api } from '../api';

// General-purpose "merge this profile with another one" tool (Keeley's request, 2026-09-21) -
// searches across every employee AND trainer regardless of client/employee_type, since the
// motivating case is a trainer profile and a real employee that are actually the same person
// but share no name/phone match the automatic Trainers-page detection would catch. Works from
// either direction: opened from an employee's page to find their trainer profile, or vice versa.
export default function MergeWithProfileModal({ employee, onMerged, onCancel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [winnerId, setWinnerId] = useState(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const rows = await api.searchAnyEmployee(query.trim(), employee.employee_id);
      setResults(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const pick = (candidate) => {
    setSelected(candidate);
    setWinnerId(employee.employee_id); // defaults to keeping the current profile
  };

  const merge = async () => {
    const loserId = winnerId === employee.employee_id ? selected.employee_id : employee.employee_id;
    const winnerName = winnerId === employee.employee_id ? employee.full_name : selected.full_name;
    const loserName = winnerId === employee.employee_id ? selected.full_name : employee.full_name;
    if (!window.confirm(`Merge "${loserName}" into "${winnerName}"? This cannot be undone.`)) return;
    setMerging(true);
    setError('');
    try {
      await api.mergeEmployees(winnerId, [loserId]);
      onMerged(winnerId);
    } catch (e) {
      setError(e.message);
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>Merge With Another Profile</h2>
        <p className="page-subtitle">
          Search for the other profile that's actually the same person as {employee.full_name} - works across employees and trainers, any client.
        </p>
        {error && <div className="error-banner">{error}</div>}

        {!selected && (
          <>
            <div className="field-row">
              <label>Search by name</label>
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                placeholder="e.g. Jamie Rivera"
              />
            </div>
            <button type="button" disabled={searching || !query.trim()} onClick={search}>
              {searching ? 'Searching...' : 'Search'}
            </button>{' '}
            <button type="button" className="secondary" onClick={onCancel}>Cancel</button>

            {results && (
              <div style={{ marginTop: 14 }}>
                {results.length === 0 && <p className="page-subtitle">No matches found.</p>}
                {results.map((r) => (
                  <div key={r.employee_id} className="card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                      <div className="page-subtitle" style={{ margin: 0 }}>
                        {r.client_name}{r.employee_type === 'trainer' ? ' · Trainer profile' : ''}{r.job_title ? ` · ${r.job_title}` : ''}
                      </div>
                    </div>
                    <button type="button" className="secondary" onClick={() => pick(r)}>Select</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {selected && (
          <>
            <table>
              <thead><tr><th>Keep</th><th>Name</th><th>Client</th><th>Role / Trade</th></tr></thead>
              <tbody>
                <tr>
                  <td><input type="radio" checked={winnerId === employee.employee_id} onChange={() => setWinnerId(employee.employee_id)} /></td>
                  <td>{employee.full_name}</td>
                  <td>{employee.client_name || (employee.employee_type === 'trainer' ? 'Internal / Trainers' : '—')}</td>
                  <td>{employee.job_title || '—'}</td>
                </tr>
                <tr>
                  <td><input type="radio" checked={winnerId === selected.employee_id} onChange={() => setWinnerId(selected.employee_id)} /></td>
                  <td>{selected.full_name}</td>
                  <td>{selected.client_name}</td>
                  <td>{selected.job_title || '—'}</td>
                </tr>
              </tbody>
            </table>
            <button type="button" disabled={merging} onClick={merge}>{merging ? 'Merging...' : 'Merge Into Selected'}</button>{' '}
            <button type="button" className="secondary" disabled={merging} onClick={() => setSelected(null)}>Back</button>{' '}
            <button type="button" className="secondary" disabled={merging} onClick={onCancel}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
