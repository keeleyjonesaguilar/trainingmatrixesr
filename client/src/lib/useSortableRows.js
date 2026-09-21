import { useMemo, useState } from 'react';

// Shared click-a-header-to-sort behavior (originally built for Reports.jsx, generalized here so
// every other table's headers - Action Required, Training Type Detail, the Employees Matrix,
// Training Sessions - can do the same A-Z/Z-A, oldest/newest sort, Keeley's request, 2026-09-21).
//
// `accessors` maps a field key to a function pulling the sortable value out of one row - define
// it as a module-level constant (like Reports.jsx's SORT_ACCESSORS) or memoize it, never inline
// as a fresh object literal on every render, or the sort recomputes every render for no reason.
export function useSortableRows(rows, accessors, defaultField, defaultDir = 'asc') {
  const [sortField, setSortField] = useState(defaultField);
  const [sortDir, setSortDir] = useState(defaultDir);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field) => (sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const sortedRows = useMemo(() => {
    if (!rows) return rows;
    const accessor = accessors[sortField];
    if (!accessor) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // blanks/missing values sort last regardless of direction
      if (bv == null) return -1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
    // `accessors` deliberately left out - see the doc comment above on why it must be stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortField, sortDir]);

  return { sortedRows, sortField, sortDir, toggleSort, sortIndicator };
}
