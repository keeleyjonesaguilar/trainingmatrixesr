// Minimal reusable popup - a fixed backdrop behind a centered card. Clicking the backdrop
// (not the card itself) closes it, matching standard modal behavior.
export default function Modal({ onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
