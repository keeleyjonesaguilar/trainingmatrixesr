// Records a privileged-action audit trail (server/migrations/037_admin_actions.sql) - who did
// what to which account and when, separate from login_attempts (which only covers login itself).
// This is the log a security team would actually need after a suspected breach: not just "did
// someone log in from a strange IP" but "did anything happen to account access afterward."
const { v4: uuidv4 } = require('uuid');
const { dbRun } = require('../db');

async function logAdminAction({ actor, action, targetUserId, targetUsername, details, req }) {
  await dbRun(
    `INSERT INTO admin_actions (action_id, actor_user_id, actor_username, action, target_user_id, target_username, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      actor ? actor.user_id : null,
      actor ? actor.username : 'unknown',
      action,
      targetUserId || null,
      targetUsername || null,
      details || null,
      req ? req.ip : null,
    ]
  );
}

module.exports = { logAdminAction };
