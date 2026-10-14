import { useState } from 'react';
import { api } from '../api';
import { nameKey, nameParts } from '../lib/names.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "+ Add New Trainer" from any trainer dropdown on the session forms (Keeley's request, 2026-10-14):
// creates the trainer's profile on the spot - email required, since a trainer without one never
// gets their class summary or close-out paperwork ("these are getting missed") - and hands the new
// trainer back so the dropdown can select it.
export default function NewTrainerForm({ trainers, onCreated, onCancel }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [trainerType, setTrainerType] = useState('internal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState(null);

  const save = async () => {
    setError('');
    if (!first.trim() || !last.trim()) return setError('Enter their first and last name.');
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Enter their email address - class details and paperwork are sent there.');
    const key = nameKey(first.trim(), last.trim());
    const same = trainers.find((t) => nameKey(nameParts(t).first, nameParts(t).last) === key);
    if (same && confirmDuplicate !== same.employee_id) {
      setConfirmDuplicate(same.employee_id);
      return setError(`${same.full_name} is already a trainer - pick them from the list, or press Add Trainer again to add a second person with this name.`);
    }
    setSaving(true);
    try {
      const trainer = await api.createTrainer({
        first_name: first.trim(), last_name: last.trim(), email: email.trim(), trainer_type: trainerType,
      });
      onCreated(trainer);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  // Enter in a box adds the trainer instead of submitting the whole session form around it.
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  };

  return (
    <div className="new-trainer-form">
      <div className="new-trainer-title">New trainer</div>
      {error && <p className="error-banner" style={{ margin: 0 }}>{error}</p>}
      <div className="new-trainer-fields">
        <input value={first} onChange={(e) => setFirst(e.target.value)} onKeyDown={onKeyDown} placeholder="First name" aria-label="First name" autoFocus />
        <input value={last} onChange={(e) => setLast(e.target.value)} onKeyDown={onKeyDown} placeholder="Last name" aria-label="Last name" />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKeyDown} placeholder="Email (required)" aria-label="Email" />
        <select value={trainerType} onChange={(e) => setTrainerType(e.target.value)} aria-label="Trainer type">
          <option value="internal">Internal</option>
          <option value="external">External</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-accent btn-sm" disabled={saving} onClick={save}>{saving ? 'Adding…' : 'Add Trainer'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
