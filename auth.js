'use strict';

const crypto = require('crypto');
const { db } = require('./db');

const THEMES = new Set(['pink', 'blue', 'gray', 'green', 'yellow']);
const ROLES = ['student', 'tutor', 'admin'];

// Initial accounts (migrated from the old users.txt). Seeded idempotently so a
// fresh database can log in; on an existing volume these already exist and only
// missing full names / roles are filled in. Users are managed in the DB / Admin
// UI from here on — there is no users.txt anymore.
const INITIAL_USERS = [
  { username: 'ad', password: 'dad',    theme: 'yellow', fullName: 'Agnello DCosta', roles: ['admin', 'student'] },
  { username: 'jd', password: 'sat265', theme: 'pink',   fullName: 'Jiselle DCosta', roles: ['student'] },
  { username: 'fg', password: 'sat263', theme: 'blue',   fullName: 'Flavio Grimaldi', roles: ['student'] },
  { username: 'aj', password: 'sir',    theme: 'gray',   fullName: 'Avichal Jain',   roles: ['tutor', 'student'] },
  { username: 'as', password: 'sir',    theme: 'gray',   fullName: 'Abhinav Rai',    roles: ['tutor', 'student'] },
];

// Idempotent bootstrap: ensure the initial users, their roles, and the global
// timer defaults exist. Safe to run on every boot.
function bootstrap() {
  const insUser = db.prepare('INSERT OR IGNORE INTO users (username, password, theme) VALUES (?,?,?)');
  const setName = db.prepare('UPDATE users SET full_name = ? WHERE username = ? AND (full_name IS NULL OR full_name = \'\')');
  const insRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)');
  for (const u of INITIAL_USERS) {
    insUser.run(u.username, u.password, u.theme);
    setName.run(u.fullName, u.username);
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (row) for (const r of u.roles) insRole.run(row.id, r);
  }
  // Any pre-existing user without a role becomes a student (keeps logins working).
  const orphans = db.prepare(`
    SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_roles)
  `).all();
  for (const o of orphans) insRole.run(o.id, 'student');

  // Global per-question timer defaults: 10 min everywhere (tweakable later).
  const insG = db.prepare('INSERT OR IGNORE INTO settings_global (domain, difficulty, round_tier, time_limit_seconds) VALUES (?,?,?,?)');
  for (const domain of ['math', 'reading']) {
    for (const difficulty of ['medium', 'hard']) {
      for (const tier of [1, 2]) insG.run(domain, difficulty, tier, 600);
    }
  }
}

function rolesFor(userId) {
  return db.prepare('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role').all(userId).map((r) => r.role);
}

function isTutorOf(tutorId, studentId) {
  return !!db.prepare('SELECT 1 FROM tutor_students WHERE tutor_id = ? AND student_id = ?').get(tutorId, studentId);
}

function studentsOfTutor(tutorId) {
  return db.prepare(`
    SELECT u.id, u.username, COALESCE(u.full_name, u.username) full_name
    FROM tutor_students ts JOIN users u ON u.id = ts.student_id
    WHERE ts.tutor_id = ? ORDER BY full_name
  `).all(tutorId);
}

function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || u.password !== String(password || '')) return null;
  const token = crypto.randomBytes(24).toString('hex');
  const roles = rolesFor(u.id);
  // One-role users skip the picker; multi-role users choose after login.
  const activeRole = roles.length === 1 ? roles[0] : null;
  db.prepare('INSERT INTO auth_tokens (token, user_id, active_role) VALUES (?,?,?)').run(token, u.id, activeRole);
  return { token, user: publicUser(u, roles, { activeRole, activeStudentId: null }) };
}

function publicUser(u, roles, ctx) {
  return {
    id: u.id, username: u.username,
    fullName: u.full_name || u.username,
    theme: u.theme || 'gray',
    roles,
    activeRole: ctx ? ctx.activeRole : null,
    activeStudentId: ctx ? ctx.activeStudentId : null,
  };
}

// Resolve a token to its user + active context. Returns null if unknown.
function sessionForToken(token) {
  if (!token) return null;
  const t = db.prepare('SELECT * FROM auth_tokens WHERE token = ?').get(token);
  if (!t) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
  if (!u) return null;
  const roles = rolesFor(u.id);
  const user = publicUser(u, roles, { activeRole: t.active_role || null, activeStudentId: t.active_student_id || null });
  return { token, user };
}

// Back-compat shape used by the API gate (id/username/theme + context).
function userForToken(token) {
  const s = sessionForToken(token);
  return s ? s.user : null;
}

// Set the active role (and student, for tutors) on a token, with validation.
function setActiveContext(token, role, studentId) {
  const s = sessionForToken(token);
  if (!s) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  if (!ROLES.includes(role) || !s.user.roles.includes(role)) {
    const e = new Error('You do not have that role.'); e.status = 403; throw e;
  }
  let sid = null;
  if (role === 'tutor') {
    sid = Number(studentId) || null;
    if (!sid || !isTutorOf(s.user.id, sid)) {
      const e = new Error('Pick a student you are assigned to.'); e.status = 400; throw e;
    }
  }
  db.prepare('UPDATE auth_tokens SET active_role = ?, active_student_id = ? WHERE token = ?').run(role, sid, token);
  return userForToken(token);
}

function logout(token) {
  if (token) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) n FROM users').get().n;
}

module.exports = {
  ROLES, bootstrap, login, userForToken, sessionForToken, setActiveContext,
  rolesFor, isTutorOf, studentsOfTutor, logout, countUsers,
};
