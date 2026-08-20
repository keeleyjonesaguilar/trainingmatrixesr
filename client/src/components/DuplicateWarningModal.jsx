import { Link } from 'react-router-dom';
import Modal from './Modal.jsx';

// Shown when a Client/Employee/Trainer "Add" form finds an existing record that looks like
// the same person/company before actually creating a new one (Keeley's request) - lets the
// admin jump to the existing record instead, or confirm they really do want a new one.
export default function DuplicateWarningModal({ matches, labelFor, linkFor, onUseExisting, onCreateAnyway, onCancel }) {
  return (
    <Modal onClose={onCancel}>
      <h2 style={{ marginTop: 0 }}>Possible Existing Match{matches.length === 1 ? '' : 'es'}</h2>
      <p className="page-subtitle">
        {matches.length === 1 ? 'This already exists:' : 'These already exist:'} use one of these instead, or create a new one anyway.
      </p>
      <ul style={{ paddingLeft: 18, margin: '0 0 16px' }}>
        {matches.map((m) => (
          <li key={linkFor(m)} style={{ marginBottom: 6 }}>
            <Link to={linkFor(m)} onClick={() => onUseExisting(m)}>{labelFor(m)}</Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCreateAnyway}>Create New Anyway</button>{' '}
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </Modal>
  );
}
