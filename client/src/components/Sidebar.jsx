import { NavLink } from 'react-router-dom';
import esrMark from '../assets/brand/esr-mark.png';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  // Its own top-level nav item (Keeley's request, 2026-09-16) - used to only be reachable via an
  // "Open Employees" button buried on a client's Compliance Overview page. This is also the
  // plain 'user' role's main destination: finding employees for job placements by filtering the
  // matrix by trainings completed.
  { to: '/matrix', label: 'Employees' },
  { to: '/clients', label: 'Clients' },
  { to: '/trainers', label: 'Trainers' },
  { to: '/sessions', label: 'Training Sessions' },
  { to: '/training-types', label: 'Training Types' },
  // Import and user management are admin-only (Keeley's request, 2026-09-16) - the plain 'user'
  // role is for people finding employees for job placements (filtering the matrix by trainings
  // completed) who can add a client/trainer/employee/session they encounter, but doesn't manage
  // accounts or bulk-import data.
  { to: '/import', label: 'Import Data', adminOnly: true },
  { to: '/admin/users', label: 'Manage Users', adminOnly: true },
  { to: '/account', label: 'My Account' },
  // Super Admin only - login/IP audit trail. Hidden rather than shown-disabled for everyone
  // else, same as this app hides other things a given role can't reach.
  { to: '/security', label: 'Security', superAdminOnly: true },
];

export default function Sidebar({ username, role, onLogout }) {
  const isAdmin = role === 'admin' || role === 'super_admin';
  const visibleItems = NAV_ITEMS.filter((item) => (!item.adminOnly || isAdmin) && (!item.superAdminOnly || role === 'super_admin'));
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={esrMark} alt="ESR" className="sidebar-brand-mark" />
        <span className="sidebar-brand-name">Safety Training Matrix</span>
      </div>
      <nav className="sidebar-nav">
        {visibleItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">{username ? username[0].toUpperCase() : '?'}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name" title={username}>
            {username}{role ? ` (${role === 'super_admin' ? 'Super Admin' : role})` : ''}
          </div>
          <button type="button" className="link-button" onClick={onLogout}>Log Out</button>
        </div>
      </div>
    </aside>
  );
}
