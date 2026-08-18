const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../lib/auth');

// If no login accounts exist yet, create exactly one so the app is never accidentally left
// wide open. Prefers APP_USERNAME/APP_PASSWORD (the old shared-password env vars) so an
// existing deployment keeps working with the credentials already set on Render - once at
// least one account exists, new accounts are added from the in-app Manage Users screen
// instead, and these env vars are no longer read for anything.
function seedAdminIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n;
  if (count > 0) return;

  const username = process.env.APP_USERNAME || 'admin';
  const password = process.env.APP_PASSWORD || uuidv4().slice(0, 12);

  db.prepare(`
    INSERT INTO app_users (user_id, username, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), username, hashPassword(password), new Date().toISOString());

  if (process.env.APP_PASSWORD) {
    console.log(`Created initial login account "${username}" from APP_USERNAME/APP_PASSWORD.`);
  } else {
    console.log(`No APP_USERNAME/APP_PASSWORD set - created initial login account "${username}" with a generated password: ${password}`);
    console.log('Log in with that once, then add real accounts from Manage Users.');
  }
}

module.exports = { seedAdminIfEmpty };
