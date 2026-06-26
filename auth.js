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
  { username: 'dcosta', password: 'dad',    theme: 'yellow', fullName: 'Agnello DCosta', roles: ['admin', 'student'] }
];

// First-run bootstrap: seed the initial accounts ONLY when the users table is
// empty (a fresh volume). On any existing DB this is a no-op, so users added,
// edited, or deleted via the Admin UI are never overwritten or re-created.
// Only questions get refreshed on boot — never users.
function bootstrap() {
  const haveUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (haveUsers) return;  // existing DB — leave users exactly as they are

  const insUser = db.prepare('INSERT OR IGNORE INTO users (username, password, theme, full_name) VALUES (?,?,?,?)');
  const insRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)');
  for (const u of INITIAL_USERS) {
    insUser.run(u.username, u.password, u.theme, u.fullName);
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (row) for (const r of u.roles) insRole.run(row.id, r);
  }
  // Timer defaults are not seeded — an unset (topic,difficulty,tier) falls back
  // to 10 minutes in repo.resolveTimer; admin can set global overrides later.
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
    activeStudentName: ctx ? (ctx.activeStudentName || null) : null,
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
  let activeStudentName = null;
  if (t.active_role === 'tutor' && t.active_student_id) {
    const s = db.prepare('SELECT COALESCE(full_name, username) n FROM users WHERE id = ?').get(t.active_student_id);
    activeStudentName = s ? s.n : null;
  }
  const user = publicUser(u, roles, {
    activeRole: t.active_role || null,
    activeStudentId: t.active_student_id || null,
    activeStudentName,
  });
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

// ---------------------------------------------------------------------------
// Admin: manage users, roles, and tutor↔student assignments.
// ---------------------------------------------------------------------------
function err(msg, code) { const e = new Error(msg); e.status = code || 400; return e; }

function listUsers() {
  const users = db.prepare('SELECT id, username, COALESCE(full_name, username) full_name, theme FROM users ORDER BY full_name').all();
  const rolesByUser = {};
  for (const r of db.prepare('SELECT user_id, role FROM user_roles').all()) {
    (rolesByUser[r.user_id] = rolesByUser[r.user_id] || []).push(r.role);
  }
  const studentsByTutor = {}, tutorsByStudent = {};
  for (const r of db.prepare('SELECT tutor_id, student_id FROM tutor_students').all()) {
    (studentsByTutor[r.tutor_id] = studentsByTutor[r.tutor_id] || []).push(r.student_id);
    (tutorsByStudent[r.student_id] = tutorsByStudent[r.student_id] || []).push(r.tutor_id);
  }
  return users.map((u) => ({
    id: u.id, username: u.username, fullName: u.full_name, theme: u.theme || 'gray',
    roles: (rolesByUser[u.id] || []).sort(),
    studentIds: studentsByTutor[u.id] || [],
    tutorIds: tutorsByStudent[u.id] || [],
  }));
}

function setRoles(userId, roles) {
  const valid = [...new Set((roles || []).filter((r) => ROLES.includes(r)))];
  if (!valid.length) throw err('Pick at least one role.');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)');
    for (const r of valid) ins.run(userId, r);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return valid;
}

function createUser({ username, password, fullName, theme, roles }) {
  username = String(username || '').trim();
  if (!username) throw err('Username is required.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw err('That username already exists.', 409);
  if (!String(password || '')) throw err('Password is required.');
  const th = THEMES.has(theme) ? theme : 'gray';
  const info = db.prepare('INSERT INTO users (username, password, theme, full_name) VALUES (?,?,?,?)')
    .run(username, String(password), th, String(fullName || '').trim() || username);
  const id = Number(info.lastInsertRowid);
  setRoles(id, (roles && roles.length) ? roles : ['student']);
  return id;
}

function updateUser(id, { username, password, fullName, theme }) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw err('User not found.', 404);
  if (username !== undefined) {
    username = String(username).trim();
    if (!username) throw err('Username is required.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(username, id)) throw err('That username already exists.', 409);
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  }
  if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(String(password), id);
  if (theme !== undefined && THEMES.has(theme)) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, id);
  if (fullName !== undefined) db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(String(fullName).trim() || u.username, id);
  return true;
}

function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id); // FK cascades roles/links/data
  return true;
}

function assignStudent(tutorId, studentId) {
  tutorId = Number(tutorId); studentId = Number(studentId);
  if (!tutorId || !studentId || tutorId === studentId) throw err('Pick a tutor and a different student.');
  db.prepare('INSERT OR IGNORE INTO tutor_students (tutor_id, student_id) VALUES (?, ?)').run(tutorId, studentId);
  return true;
}

function unassignStudent(tutorId, studentId) {
  db.prepare('DELETE FROM tutor_students WHERE tutor_id = ? AND student_id = ?').run(Number(tutorId), Number(studentId));
  return true;
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
  listUsers, createUser, updateUser, setRoles, deleteUser, assignStudent, unassignStudent,
};
