'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db');

// Users are managed entirely via a plain-text file in the repo (no admin UI).
// One user per line:  username,password[,theme]   (colon also works as a
// separator). theme is optional and is one of pink|blue|gray (default gray).
// Lines that are blank or start with '#' are ignored.
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'COLLEGEBOARD', 'users.txt');
const THEMES = new Set(['pink', 'blue', 'gray', 'green']);

function parseUsersFile(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s*[,:]\s*/);
    if (parts.length < 2) continue;
    const username = (parts[0] || '').trim();
    const password = (parts[1] || '').trim();
    let theme = (parts[2] || 'gray').trim().toLowerCase();
    if (!THEMES.has(theme)) theme = 'gray';
    if (username && password) out.push({ username, password, theme });
  }
  return out;
}

// Read users.txt and upsert into the users table. Existing users keep their
// data; only their password is refreshed from the file. (Removing a user from
// the file does not delete them or their data — that stays a manual choice.)
function loadUsers() {
  let text;
  try {
    text = fs.readFileSync(USERS_FILE, 'utf8');
  } catch (_) {
    console.warn(`[auth] users file not found at ${USERS_FILE} — no users loaded. Add it to enable login.`);
    return 0;
  }
  const users = parseUsersFile(text);
  const up = db.prepare(`
    INSERT INTO users (username, password, theme) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password = excluded.password, theme = excluded.theme
  `);
  for (const u of users) up.run(u.username, u.password, u.theme);
  console.log(`[auth] loaded ${users.length} user(s) from ${path.basename(USERS_FILE)}`);
  return users.length;
}

function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || u.password !== String(password || '')) return null;
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, u.id);
  return { token, user: { id: u.id, username: u.username, theme: u.theme || 'gray' } };
}

function userForToken(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.theme FROM auth_tokens t
    JOIN users u ON u.id = t.user_id WHERE t.token = ?
  `).get(token) || null;
}

function logout(token) {
  if (token) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) n FROM users').get().n;
}

module.exports = { loadUsers, login, userForToken, logout, countUsers, USERS_FILE };
