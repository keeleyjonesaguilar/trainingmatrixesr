import { displayFirstLast } from '../lib/names.js';

// "Other trainers" on a session (Keeley's request, 2026-10-01): pick any number of trainers who
// teach alongside the lead trainer. Each one's name goes on the certificates and roster, any of
// them can close out, and trainees rate each of them separately on the feedback form.
// `value` is an array of employee_ids; the lead trainer (`leadId`) isn't offered again.
export default function CoTrainersPicker({ trainers, value, onChange, leadId }) {
  const selected = value.map((id) => trainers.find((t) => t.employee_id === id)).filter(Boolean);
  const available = trainers.filter((t) => t.employee_id !== leadId && !value.includes(t.employee_id));
  return (
    <div>
      {selected.length > 0 && (
        <div className="training-chip-list" style={{ marginBottom: 6 }}>
          {selected.map((t) => (
            <span key={t.employee_id} className="training-chip">
              {displayFirstLast(t)}
              <button type="button" aria-label={`Remove ${displayFirstLast(t)}`} onClick={() => onChange(value.filter((id) => id !== t.employee_id))}>×</button>
            </span>
          ))}
        </div>
      )}
      <select value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}>
        <option value="">{selected.length ? 'Add another trainer…' : 'Add a trainer (optional)…'}</option>
        {available.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
      </select>
    </div>
  );
}
