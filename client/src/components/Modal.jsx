import { useEffect } from 'react';

// Minimal reusable popup - a fixed backdrop behind a centered card. Clicking the backdrop
// (not the card itself) or pressing Esc closes it, matching standard modal behavior. `maxWidth`
// widens it for wider content (default 420px).
export default function Modal({ onClose, children, maxWidth }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={maxWidth ? { maxWidth } : undefined} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
