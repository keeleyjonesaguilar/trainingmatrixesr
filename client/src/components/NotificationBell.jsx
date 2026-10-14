import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatEasternDateTime, parseTimestamp, easternToday, EASTERN_TZ } from '../lib/dates';

// Polling rather than a websocket/SSE connection - this app has no realtime infrastructure
// elsewhere, and a session closing (the only trigger today) isn't time-critical enough to
// justify adding one just for this (Keeley's request, 2026-09-17).
const POLL_MS = 30000;

// Three tabs instead of one long list (Keeley's request, 2026-10-14: "a little clogged up"). The
// server decides which tab a notification belongs to (server/routes/notifications.js). The red
// badge counts only Needs attention; unread items in the other tabs show as a small dot.
const TABS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'completed', label: 'Completed' },
  { key: 'updates', label: 'Updates' },
];

// The short tag on each item, by notification type.
const TYPE_TAGS = {
  feedback_needs_training: 'Follow up',
  trainer_summary_missing_email: 'No email',
  session_email_problem: 'Not delivered',
  session_reminder: 'Not closed',
  trainer_notes: 'Trainer notes',
  session_completed: 'Closed',
  portal_profile_updated: 'Portal',
};

const EASTERN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN_TZ });

// "Today: 4 trainings closed · 58 attendees" - from the closed-training notifications made today.
function todaysDigest(items) {
  const today = easternToday();
  const closed = items.filter((n) => n.type === 'session_completed' && EASTERN_DAY.format(parseTimestamp(n.created_at)) === today);
  if (!closed.length) return null;
  const attendees = closed.reduce((sum, n) => sum + (Number((/(\d+) attendee/.exec(n.body || '') || [])[1]) || 0), 0);
  return `Today: ${closed.length} training${closed.length === 1 ? '' : 's'} closed · ${attendees} attendee${attendees === 1 ? '' : 's'}`;
}

const EMPTY_GROUPS = { attention: { items: [], unread: 0 }, completed: { items: [], unread: 0 }, updates: { items: [], unread: 0 } };

export default function NotificationBell() {
  const [groups, setGroups] = useState(EMPTY_GROUPS);
  const [tab, setTab] = useState(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  const load = () => {
    api.listNotifications()
      .then((res) => setGroups(res.groups || EMPTY_GROUPS))
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

  const attentionUnread = groups.attention.unread;
  const otherUnread = groups.completed.unread + groups.updates.unread;
  // Opens on the first tab with something unread.
  const openBell = () => {
    if (!open) setTab(TABS.find((t) => groups[t.key].unread > 0)?.key || 'attention');
    setOpen((v) => !v);
  };
  const activeTab = tab || 'attention';
  const current = groups[activeTab];

  const markRead = (n) => {
    setGroups((prev) => ({
      ...prev,
      [n.group]: {
        items: prev[n.group].items.map((x) => (x.notification_id === n.notification_id ? { ...x, read_at: new Date().toISOString() } : x)),
        unread: Math.max(0, prev[n.group].unread - 1),
      },
    }));
    api.markNotificationRead(n.notification_id).catch(() => {});
  };

  const openNotification = (n) => {
    setOpen(false);
    if (!n.read_at) markRead(n);
    if (n.link_path) navigate(n.link_path);
  };

  const markTabRead = (e) => {
    e.stopPropagation();
    setGroups((prev) => ({
      ...prev,
      [activeTab]: { items: prev[activeTab].items.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })), unread: 0 },
    }));
    api.markAllNotificationsRead(activeTab).catch(() => {});
  };

  const digest = activeTab === 'completed' ? todaysDigest(current.items) : null;

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className="notification-bell-button"
        onClick={openBell}
        aria-label={`Notifications${attentionUnread ? `, ${attentionUnread} need attention` : ''}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {attentionUnread > 0 && <span className="notification-badge">{attentionUnread > 99 ? '99+' : attentionUnread}</span>}
        {attentionUnread === 0 && otherUnread > 0 && <span className="notification-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <strong>Notifications</strong>
            {current.unread > 0 && <button type="button" className="link-button" onClick={markTabRead}>Mark tab read</button>}
          </div>
          <div className="notification-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                className={`notification-tab notification-tab-${t.key}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {groups[t.key].unread > 0 && <span className="notification-tab-count">{groups[t.key].unread}</span>}
              </button>
            ))}
          </div>
          <div className="notification-list" role="tabpanel">
            {digest && <div className="notification-digest">{digest}</div>}
            {current.items.length === 0 && (
              <p className="notification-empty">
                {activeTab === 'attention' ? 'Nothing needs attention right now.' : activeTab === 'completed' ? 'No closed trainings yet.' : 'No updates.'}
              </p>
            )}
            {current.items.map((n) => (
              <button
                type="button"
                key={n.notification_id}
                className={`notification-item notification-item-${n.group}${n.read_at ? '' : ' notification-item-unread'}`}
                onClick={() => openNotification(n)}
              >
                <div className="notification-item-title">
                  <span className={`notification-tag notification-tag-${n.group}`}>{TYPE_TAGS[n.type] || 'Update'}</span>
                  {n.title}
                </div>
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
