import { useState } from 'react';

// Filters on a phone (2026-11-06): the filter drop-downs and dates fold behind one "Filters"
// button so the list itself is on the first screen, not under a page of drop-downs. The name
// search stays out. On a computer nothing changes - the button is hidden and every filter shows
// as before. `active` is how many filters are set, shown on the button so a filtered list
// isn't mistaken for the whole list.
export default function PhoneFilters({ active = 0, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`phone-filters${open ? ' is-open' : ''}`}>
      <button type="button" className="phone-filters-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 5h18" /><path d="M6 12h12" /><path d="M10 19h4" />
        </svg>
        {open ? 'Hide filters' : 'Filters'}
        {active > 0 && <span className="phone-filters-count">{active}</span>}
      </button>
      {children}
    </div>
  );
}
