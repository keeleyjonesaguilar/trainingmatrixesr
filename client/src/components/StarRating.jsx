// A simple 5-star clickable rating input. Controlled, like a text input - the parent owns the
// value and passes onChange, no internal state beyond hover for the preview highlight.
import { useState } from 'react';

export default function StarRating({ value, onChange, size = 28 }) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value || 0;

  return (
    <div style={{ display: 'inline-flex', gap: 4 }} onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: size,
            lineHeight: 1,
            color: n <= display ? 'var(--esr-gold)' : 'var(--color-border, #ccc)',
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}
