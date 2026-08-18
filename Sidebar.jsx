import { NavLink } from 'react-router-dom';
import esrMark from '../assets/brand/esr-mark.png';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/matrix', label: 'Training Matrix' },
  { to: '/clients', label: 'Clients' },
  { to: '/master-trainings', label: 'Master Trainings' },
  { to: '/import', label: 'Import Data' },
  { to: '/reports', label: 'Reports' },
  { to: '/admin/users', label: 'Manage Users' },
];

export default function Sidebar({ username, role, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={esrMark} alt="ESR" className="sidebar-brand-mark" />
        <span className="sidebar-brand-name">Safety Training Matrix</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">{username ? username[0].toUpperCase() : '?'}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name" title={username}>{username}{role ? ` (${role})` : ''}</div>
          <button type="button" className="link-button" onClick={onLogout}>Log Out</button>
        </div>
      </div>
    </aside>
  );
}
