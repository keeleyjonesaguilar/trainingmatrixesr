import NotificationBell from './NotificationBell.jsx';

// Username/role/log-out moved here from the sidebar footer, alongside the new notification bell
// (Keeley's request, 2026-09-17) - both belong together at the top of the screen rather than
// buried at the bottom of the nav. Shows the person's real name once one's on file (Keeley's
// request) - a username is a login handle, not something to greet someone by. Falls back to the
// username for any account that doesn't have one set yet.
export default function TopBar({ username, fullName, role, onLogout }) {
  const displayName = fullName || username;
  return (
    <header className="topbar">
      <div className="topbar-spacer" />
      <div className="topbar-right">
        <NotificationBell />
        <div className="topbar-user">
          <div className="topbar-user-avatar">{displayName ? displayName[0].toUpperCase() : '?'}</div>
          <div className="topbar-user-info">
            <div className="topbar-user-name" title={displayName}>
              {displayName}{role ? ` (${role === 'super_admin' ? 'Super Admin' : role})` : ''}
            </div>
            <button type="button" className="link-button" onClick={onLogout}>Log Out</button>
          </div>
        </div>
      </div>
    </header>
  );
}
