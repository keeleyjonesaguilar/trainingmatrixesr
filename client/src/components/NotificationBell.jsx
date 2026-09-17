import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatEasternDateTime } from '../lib/dates';

// Polling rather than a websocket/SSE connection - this app has no realtime infrastructure
// elsewhere, and a session closing (the only trigger today) isn't time-critical enough to
// justify adding one just for this (Keeley's request, 2026-09-17).
const POLL_MS = 30000;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  const load = () => {
    api.listNotifications()
      .then((res) => { setNotifications(res.notifications); setUnreadCount(res.unread_count); })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // Close the dropdown on an outside click, same pattern as any other popover in the app.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const openNotification = async (n) => {
    setOpen(false);
    if (!n.read_at) {
      setNotifications((prev) => prev.map((x) => (x.notification_id === n.notification_id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      api.markNotificationRead(n.notification_id).catch(() => {});
    }
    if (n.link_path) navigate(n.link_path);
  };

  const markAllRead = async (e) => {
    e.stopPropagation();
    setNotifications((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnreadCount(0);
    api.markAllNotificationsRead().catch(() => {});
  };

  return (
    <div className="notification-bell" ref={containerRef}>
      <button type="button" className="notification-bell-button" onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <strong>Notifications</strong>
            {unreadCount > 0 && <button type="button" className="link-button" onClick={markAllRead}>Mark all read</button>}
          </div>
          <div className="notification-list">
            {notifications.length === 0 && <p className="notification-empty">No notifications yet.</p>}
            {notifications.map((n) => (
              <button
                type="button"
                key={n.notification_id}
                className={`notification-item${n.read_at ? '' : ' notification-item-unread'}`}
                onClick={() => openNotification(n)}
              >
                <div className="notification-item-title">{n.title}</div>
                {n.body && <div className="notification-item-body">{n.body}</div>}
                <div className="notification-item-time">{formatEasternDateTime(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
