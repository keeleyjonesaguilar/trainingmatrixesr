// In-app notification center (bell icon, client/src/components/NotificationBell.jsx) plus a
// best-effort email via the same Resend integration used for invites/resets - one shared
// function since every notification today goes to every app_user (Keeley's request,
// 2026-09-17: no per-user opt-in, broadcast to whoever's logged in).
const { v4: uuidv4 } = require('uuid');
const { dbAll, dbRun } = require('../db');
const { sendEmail } = require('./email');

async function notifyAllUsers({ type, title, body, link_path }) {
  const users = await dbAll('SELECT user_id, email FROM app_users', []);
  for (const user of users) {
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      'INSERT INTO notifications (notification_id, user_id, type, title, body, link_path) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), user.user_id, type, title, body || null, link_path || null]
    );
  }

  // Email is a "nice to have" alongside the bell, not the primary path - one bad/unconfigured
  // address (or Resend being unset entirely in a dev environment) should never block the
  // in-app notifications that were just written above.
  const base = (process.env.PUBLIC_APP_URL || 'http://localhost:4000').replace(/\/$/, '');
  await Promise.all(
    users
      .filter((u) => u.email)
      .map((u) =>
        sendEmail({
          to: u.email,
          subject: title,
          html: `<p>${body || title}</p>${link_path ? `<p><a href="${base}${link_path}">View in the Training Matrix</a></p>` : ''}`,
        }).catch((err) => console.error(`Notification email failed for ${u.email}:`, err.message))
      )
  );
}

module.exports = { notifyAllUsers };
