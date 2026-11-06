import { NavLink } from 'react-router-dom';
import esrLogo from '../assets/brand/esr-logo-full.png';
import Icon from './Icon.jsx';

// Grouped with an icon on each item (Keeley, 2026-11-03: the menu "feels dense" - nicer and more
// modern). The everyday pages sit up top with no heading; the setup lists and the Super Admin
// pages each get a small heading. My Account moved into the name menu in the top bar.
const NAV_GROUPS = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      // Its own top-level nav item (Keeley's request, 2026-09-16) - this is also the plain 'user'
      // role's main destination: finding employees for job placements by filtering the matrix by
      // trainings completed.
      { to: '/matrix', label: 'Employees', icon: 'employees' },
      { to: '/sessions', label: 'Training Sessions', icon: 'sessions' },
      // Back in the menu (Keeley's request, 2026-10-28) - it had only been reachable from a
      // client's "Generate Report" button, and now holds the Trainings by Class report too.
      { to: '/reports', label: 'Reports', icon: 'reports' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { to: '/clients', label: 'Clients', icon: 'clients' },
      { to: '/trainers', label: 'Trainers', icon: 'trainers' },
      { to: '/training-types', label: 'Training Types', icon: 'trainingTypes' },
      // The PowerPoint library (Keeley's "Training matrix features 11.6", 2026-11-06).
      { to: '/content', label: 'Content', icon: 'content' },
    ],
  },
  // Import, user management, Requests and Security are Super Admin only (Keeley's request,
  // 2026-10-23) - hidden rather than shown-disabled for everyone else.
  {
    title: 'Admin',
    superAdminOnly: true,
    items: [
      { to: '/import', label: 'Import Data', icon: 'import' },
      { to: '/admin/users', label: 'Manage Users', icon: 'users' },
      { to: '/requests', label: 'Requests', icon: 'requests' },
      { to: '/security', label: 'Security', icon: 'security' },
    ],
  },
];

// On a phone the sidebar is a drawer that slides in from the left (`open`), closed by the X, the
// dimmed backdrop, or picking a page.
export default function Sidebar({ role, isTrainer = false, open = false, onClose }) {
  const groups = NAV_GROUPS.filter((g) => !g.superAdminOnly || role === 'super_admin');
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <img src={esrLogo} alt="Evolution Safety Resources" className="sidebar-brand-mark" />
          <span className="sidebar-brand-name">Safety Training Matrix</span>
          <button type="button" className="sidebar-close" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.title || 'main'} className="sidebar-group">
              {group.title && <div className="sidebar-group-title">{group.title}</div>}
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {/* Trainers only (Keeley's request, 2026-10-06) - the office account's email is on an
            employee profile with "This person is a trainer" ticked. Opens the ESR Training Portal
            (its own sign-in) in a new tab. */}
        {isTrainer && (
          <a className="sidebar-portal-link" href="/portal" target="_blank" rel="noopener noreferrer">
            <Icon name="external" />
            <span>Trainer Portal</span>
          </a>
        )}
      </aside>
    </>
  );
}
