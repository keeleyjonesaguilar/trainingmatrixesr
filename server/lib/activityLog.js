// Writes to activity_log (040_activity_log.sql) - routine usage across the app ("employee 1
// created a training session, downloaded QR code, exported roster"), as distinct from
// adminAudit.js's account-security trail. Best-effort and non-blocking on purpose: several call
// sites are downloads already mid-response (res.download/streaming a ZIP), where a failed insert
// must never break the actual download or bubble into an error page.
const { v4: uuidv4 } = require('uuid');
const { dbRun } = require('../db');

async function logActivity({ actor, action, entityType = null, entityId = null, entityLabel = null, details = null, req = null }) {
  try {
    await dbRun(
      `INSERT INTO activity_log (activity_id, actor_user_id, actor_username, action, entity_type, entity_id, entity_label, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        actor ? actor.user_id : null,
        actor ? actor.username : 'unknown',
        action,
        entityType,
        entityId,
        entityLabel,
        details,
        req ? req.ip : null,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to write activity log entry (action=${action}):`, err);
  }
}

module.exports = { logActivity };
