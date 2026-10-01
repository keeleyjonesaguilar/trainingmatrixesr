import { useEffect } from 'react';

// Minimal reusable popup - a fixed backdrop behind a centered card. Clicking the backdrop
// (not the card itself) or pressing Esc closes it, matching standard modal behavior.
export default function Modal({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
