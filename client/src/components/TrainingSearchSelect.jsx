import { useEffect, useRef, useState } from 'react';

// Type-to-filter picker for the master training catalog (Keeley's request, 2026-09-17: a plain
// <select> became unusable once the catalog grew to 100+ trainings). Shared outside-click-closes
// behavior matches every other dropdown/popover already in the app (e.g. NotificationBell.jsx).
function useOutsideClickCloses(open, setOpen) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, setOpen]);
  return containerRef;
}

function filterTrainings(trainings, query, excludeIds) {
  const q = query.trim().toLowerCase();
  return trainings
    .filter((t) => !excludeIds.includes(t.training_id))
    .filter((t) => !q || t.training_id.toLowerCase().includes(q) || t.training_name.toLowerCase().includes(q));
}

// Single-select: value/onChange are a single training_id, like the <select> it replaces.
export function TrainingSearchSelect({ trainings, value, onChange, placeholder = 'Search trainings…', excludeIds = [] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useOutsideClickCloses(open, setOpen);
  const selected = trainings.find((t) => t.training_id === value);
  const filtered = filterTrainings(trainings, query, excludeIds);

  return (
    <div className="training-search-select" ref={containerRef}>
      <input
        type="text"
        value={open ? query : selected ? `${selected.training_id} - ${selected.training_name}` : ''}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        placeholder={placeholder}
      />
      {open && (
        <div className="training-search-dropdown">
          {filtered.length === 0 && <div className="training-search-empty">No matches</div>}
          {filtered.map((t) => (
            <button
              type="button"
              key={t.training_id}
              className="training-search-option"
              onClick={() => { onChange(t.training_id); setQuery(''); setOpen(false); }}
            >
              {t.training_id} - {t.training_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Multi-select: value/onChange are an array of training_ids, shown as removable chips above the
// search box (replaces a <select multiple>, which has the same scroll problem plus needs
// ctrl/cmd-click to use at all).
export function TrainingMultiSearchSelect({ trainings, value, onChange, excludeIds = [] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useOutsideClickCloses(open, setOpen);
  const filtered = filterTrainings(trainings, query, [...excludeIds, ...value]);

  const add = (id) => { onChange([...value, id]); setQuery(''); setOpen(false); };
  const remove = (id) => onChange(value.filter((v) => v !== id));

  return (
    <div ref={containerRef}>
      {value.length > 0 && (
        <div className="training-chip-list">
          {value.map((id) => {
            const t = trainings.find((x) => x.training_id === id);
            return (
              <span key={id} className="training-chip">
                {t ? `${t.training_id} - ${t.training_name}` : id}
                <button type="button" onClick={() => remove(id)} aria-label={`Remove ${t ? t.training_name : id}`}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <div className="training-search-select">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search to add another training…"
        />
        {open && (
          <div className="training-search-dropdown">
            {filtered.length === 0 && <div className="training-search-empty">No matches</div>}
            {filtered.map((t) => (
              <button type="button" key={t.training_id} className="training-search-option" onClick={() => add(t.training_id)}>
                {t.training_id} - {t.training_name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
