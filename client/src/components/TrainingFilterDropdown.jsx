import { useState } from 'react';

// Shared by the main Employee Matrix (client/src/pages/Matrix.jsx) and the per-client employee
// list embedded on a client's Compliance Overview (client/src/pages/Dashboard.jsx) - extracted
// so both get the same "Has All Selected Trainings" filter UX (Keeley's request, 2026-09-16)
// instead of the client-scoped view having a weaker, name-search-only filter set.
export default function TrainingFilterDropdown({ masterTrainings, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = masterTrainings.filter(
    (mt) => !search || mt.training_name.toLowerCase().includes(search.toLowerCase()) || mt.training_id.toLowerCase().includes(search.toLowerCase())
  );
  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  return (
    <div className="field-row" style={{ position: 'relative' }}>
      <label>Has All Selected Trainings</label>
      <button type="button" className="secondary" onClick={() => setOpen((o) => !o)}>
        {selected.length ? `${selected.length} training${selected.length === 1 ? '' : 's'} selected` : 'Select trainings...'}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, width: 340, maxHeight: 380, overflowY: 'auto' }}>
          <input
            type="search"
            placeholder="Search trainings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8, width: '100%' }}
          />
          {filtered.map((mt) => (
            <label key={mt.training_id} style={{ display: 'block', fontSize: 13, padding: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(mt.training_id)} onChange={() => toggle(mt.training_id)} />{' '}
              {mt.training_id} - {mt.training_name}
            </label>
          ))}
          {filtered.length === 0 && <p className="page-subtitle" style={{ margin: 0 }}>No matches.</p>}
          <div style={{ marginTop: 8 }}>
            {selected.length > 0 && <button type="button" className="secondary" onClick={() => onChange([])}>Clear</button>}
            {' '}
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
