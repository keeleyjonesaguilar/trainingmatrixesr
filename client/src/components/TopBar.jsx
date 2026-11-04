import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import NotificationBell from './NotificationBell.jsx';
import Icon from './Icon.jsx';
import esrMark from '../assets/brand/esr-logo-full.png';

// Username/role/log-out moved here from the sidebar footer, alongside the new notification bell
// (Keeley's request, 2026-09-17) - both belong together at the top of the screen rather than
// buried at the bottom of the nav. Shows the person's real name once one's on file (Keeley's
// request) - a username is a login handle, not something to greet someone by. Falls back to the
// username for any account that doesn't have one set yet.
//
// The name opens a small menu with My Account and Log Out (2026-11-03 - My Account used to be a
// sidebar item). On a phone the bar also shows the menu button and the ESR logo.
export default function TopBar({ username, fullName, role, onLogout, onOpenMenu }) {
  const displayName = fullName || username;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <button type="button" className="topbar-menu-button" onClick={onOpenMenu} aria-label="Open menu">
        <Icon name="menu" size={22} />
      </button>
      <img src={esrMark} alt="Evolution Safety Resources" className="topbar-brand" />
      <div className="topbar-spacer" />
      <div className="topbar-right">
        <NotificationBell />
        <div className="topbar-user" ref={menuRef}>
          <button
            type="button"
            className="topbar-user-button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="topbar-user-avatar">{displayName ? displayName[0].toUpperCase() : '?'}</span>
            <span className="topbar-user-info">
              <span className="topbar-user-name" title={displayName}>{displayName}</span>
              {role && <span className="topbar-user-role">{role === 'super_admin' ? 'Super Admin' : role}</span>}
            </span>
            <Icon name="chevronDown" size={16} />
          </button>
          {menuOpen && (
            <div className="topbar-user-menu" role="menu">
              <Link to="/account" role="menuitem" onClick={() => setMenuOpen(false)}>
                <Icon name="account" size={16} /> My Account
              </Link>
              <button type="button" className="topbar-user-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); onLogout(); }}>
                <Icon name="logout" size={16} /> Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
