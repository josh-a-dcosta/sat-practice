'use strict';

// Timestamps are stored in UTC (datetime('now')); the UI presents US Eastern.
// Day/week buckets use SQLite 'localtime', which follows this
// process's TZ — so we pin US Eastern here (overridable via the TZ env var on the
// host). Must run before any date use, including db.js below.
process.env.TZ = process.env.TZ || 'America/New_York';

const http = require('http');
const fs   = require('fs');
const path = require('path');

// Auto-seed the database if it's empty (first run on Railway or fresh clone).
(function autoSeed() {
  const { db } = require('./db');
  const count = db.prepare('SELECT COUNT(*) n FROM questions').get().n;
  if (count > 0) return;
  console.log('No questions found — running first-time setup…');
  const { execFileSync } = require('child_process');
  const node = process.execPath;
  try {
    // Load ONLY the real College Board PDF imports (data/questions.*.json).
    // Starter/generated banks are intentionally not seeded.
    execFileSync(node, ['--experimental-sqlite', 'scripts/seed.js'], { cwd: __dirname, stdio: 'inherit' });
    console.log('First-time setup complete.');
  } catch (e) {
    console.error('Auto-seed failed:', e.message);
  }
})();

const repo = require('./repo');
const auth = require('./auth');
const { isValidTopic, isValidDifficulty, domainOfTopic } = require('./topics');

// Ensure initial users, roles, and global timer defaults exist (idempotent).
auth.bootstrap();

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.png' : 'image/png',
};

function sendJson(res, status, data, headers) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) });
  res.end(JSON.stringify(data));
}

const COOKIE = 'sat_auth';

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(token, maxAgeDays) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeDays === 0) attrs.push('Max-Age=0');
  else attrs.push(`Max-Age=${Math.round((maxAgeDays || 30) * 86400)}`);
  return { 'Set-Cookie': `${COOKIE}=${token}; ${attrs.join('; ')}` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// Cache policy: pages/code must always revalidate so updates show up without a
// hard refresh; question images are content-stable (unique names) so cache them.
function cacheControl(ext) {
  if (ext === '.png' || ext === '.svg' || ext === '.ico') return 'public, max-age=86400';
  return 'no-cache, must-revalidate';
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const fp = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, content) => {
    if (err) {
      if (path.extname(fp) === '') {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache, must-revalidate' });
          res.end(html);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(ext),
    });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]

  const cookies = parseCookies(req);

  try {
    // ---- auth (no session required) ----
    // POST /api/login  { username, password }
    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const result = auth.login(body.username, body.password);
      if (!result) return sendJson(res, 401, { error: 'Wrong username or password.' });
      return sendJson(res, 200, { user: result.user }, cookieHeader(result.token, 30));
    }

    // POST /api/logout
    if (req.method === 'POST' && pathname === '/api/logout') {
      auth.logout(cookies[COOKIE]);
      return sendJson(res, 200, { ok: true }, cookieHeader('', 0));
    }

    // ---- everything below requires a logged-in user ----
    const user = auth.userForToken(cookies[COOKIE]);
    if (!user) return sendJson(res, 401, { error: 'Not signed in' });
    const uid = user.id;

    // Whose data a read endpoint should show: a tutor views their selected
    // (and still-assigned) student; everyone else views their own data.
    const isTutor = user.activeRole === 'tutor';
    const viewId = isTutor
      ? (user.activeStudentId && auth.isTutorOf(uid, user.activeStudentId) ? user.activeStudentId : null)
      : uid;
    const requireView = () => {
      if (viewId == null) { const e = new Error('Pick a student to view.'); e.status = 403; throw e; }
      return viewId;
    };
    // Tutors are read-only; block any write/practice action while in that role.
    const blockTutorWrites = () => {
      if (isTutor) { const e = new Error('Tutors have read-only access.'); e.status = 403; throw e; }
    };
    const requireAdmin = () => {
      if (user.activeRole !== 'admin') { const e = new Error('Admin access only.'); e.status = 403; throw e; }
    };

    // GET /api/me
    if (req.method === 'GET' && pathname === '/api/me') {
      return sendJson(res, 200, { user });
    }

    // GET /api/context/options — roles to choose from + tutorable students.
    if (req.method === 'GET' && pathname === '/api/context/options') {
      const students = user.roles.includes('tutor') ? auth.studentsOfTutor(uid) : [];
      return sendJson(res, 200, { roles: user.roles, students });
    }

    // POST /api/context { role, studentId } — set the active role/student.
    if (req.method === 'POST' && pathname === '/api/context') {
      const body = await readBody(req);
      const updated = auth.setActiveContext(cookies[COOKIE], String(body.role || ''), body.studentId);
      return sendJson(res, 200, { user: updated });
    }

    // GET /api/overview
    if (req.method === 'GET' && pathname === '/api/overview') {
      return sendJson(res, 200, {
        user,
        catalogue:    repo.getCatalogue(uid),
        skillCatalogue: repo.getSkillCatalogue(uid),
        activeSessions: repo.listActiveSessions(uid),
        dailySummaries: repo.getDailySummaries(uid),
        timeLimits:   repo.TIME_LIMITS,
        sessionMinutes: repo.SESSION_MINUTES,
      });
    }

    // POST /api/sessions  { topic, difficulty }
    if (req.method === 'POST' && pathname === '/api/sessions') {
      blockTutorWrites();
      const body = await readBody(req);
      const topic      = String(body.topic || '');
      const difficulty = String(body.difficulty || 'medium').toLowerCase();
      if (!isValidTopic(topic))      return sendJson(res, 400, { error: 'Invalid topic' });
      if (!isValidDifficulty(difficulty)) return sendJson(res, 400, { error: 'difficulty must be "medium" or "hard"' });
      const domain = domainOfTopic(topic);
      const result = repo.createOrResumeSession(uid, domain, topic, difficulty, { timeLimitSeconds: body.timeLimitSeconds });
      return sendJson(res, 200, result);
    }

    // GET /api/sessions/:id  (a tutor may read their student's session for review)
    if (req.method === 'GET' && parts[1] === 'sessions' && parts.length === 3) {
      const state = repo.getSessionState(requireView(), Number(parts[2]));
      if (!state) return sendJson(res, 404, { error: 'Session not found' });
      return sendJson(res, 200, state);
    }

    // GET /api/sessions/:id/questions/:position
    if (req.method === 'GET' && parts[1] === 'sessions' && parts[3] === 'questions' && parts.length === 5) {
      const data = repo.getQuestionAt(requireView(), Number(parts[2]), Number(parts[4]));
      if (!data) return sendJson(res, 404, { error: 'Question not found' });
      // Only the practicing student advances their own position; tutors just look.
      if (!isTutor) repo.setCurrentPosition(uid, Number(parts[2]), Number(parts[4]));
      return sendJson(res, 200, data);
    }

    // POST /api/sessions/:id/answer
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'answer' && parts.length === 4) {
      const body = await readBody(req);
      const result = repo.submitAnswer(uid, Number(parts[2]), Number(body.questionId), String(body.selected), Number(body.timeTaken));
      return sendJson(res, 200, result);
    }

    // POST /api/sessions/:id/peek  { questionId, timeTaken }
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'peek' && parts.length === 4) {
      const body = await readBody(req);
      return sendJson(res, 200, repo.peekQuestion(uid, Number(parts[2]), Number(body.questionId), Number(body.timeTaken)));
    }

    // POST /api/sessions/:id/timeout  { questionId, timeTaken }
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'timeout' && parts.length === 4) {
      const body = await readBody(req);
      return sendJson(res, 200, repo.timeoutQuestion(uid, Number(parts[2]), Number(body.questionId), Number(body.timeTaken)));
    }

    // POST /api/sessions/:id/skip  { questionId, timeTaken }   (defer, not resolve)
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'skip' && parts.length === 4) {
      const body = await readBody(req);
      return sendJson(res, 200, repo.skipQuestion(uid, Number(parts[2]), Number(body.questionId), Number(body.timeTaken)));
    }

    // POST /api/sessions/:id/progress  { position, elapsed }   (pause/heartbeat)
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'progress' && parts.length === 4) {
      const body = await readBody(req);
      repo.saveProgress(uid, Number(parts[2]), Number(body.position), Number(body.elapsed));
      return sendJson(res, 200, { ok: true });
    }

    // POST /api/sessions/:id/complete
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'complete' && parts.length === 4) {
      return sendJson(res, 200, repo.completeSession(uid, Number(parts[2])));
    }

    // ---- tasks / plan ----
    // Suggested Practice is collaborative: a student manages their own plan, and
    // a tutor can build/manage the plan for their assigned student. Tasks belong
    // to the student (viewId); added_by records who added them (uid).
    if (req.method === 'GET' && pathname === '/api/tasks') {
      return sendJson(res, 200, { tasks: repo.listTasks(requireView()) });
    }
    if (req.method === 'POST' && pathname === '/api/tasks') {
      const body = await readBody(req);
      return sendJson(res, 200, repo.addTask(requireView(), body, uid));
    }
    if (req.method === 'POST' && parts[1] === 'tasks' && parts.length === 3) {
      const body = await readBody(req);
      return sendJson(res, 200, repo.setTaskStatus(requireView(), Number(parts[2]), String(body.status || 'open')));
    }
    if (req.method === 'DELETE' && parts[1] === 'tasks' && parts.length === 3) {
      return sendJson(res, 200, repo.deleteTask(requireView(), Number(parts[2])));
    }
    if (req.method === 'POST' && pathname === '/api/plan/generate') {
      return sendJson(res, 200, repo.generatePlan(requireView(), uid));
    }

    // ---- settings (a user's own per-question timers) ----
    // GET /api/settings
    if (req.method === 'GET' && pathname === '/api/settings') {
      return sendJson(res, 200, { grid: repo.settingsGrid(uid) });
    }
    // POST /api/settings  { topic, difficulty, roundTier, minutes }
    if (req.method === 'POST' && pathname === '/api/settings') {
      blockTutorWrites();
      const b = await readBody(req);
      repo.setUserSetting(uid, String(b.topic || ''), String(b.difficulty || ''), Number(b.roundTier), Math.round(Number(b.minutes) * 60));
      return sendJson(res, 200, { grid: repo.settingsGrid(uid) });
    }
    // POST /api/settings/reset  { topic, difficulty, roundTier }  (revert to default)
    if (req.method === 'POST' && pathname === '/api/settings/reset') {
      blockTutorWrites();
      const b = await readBody(req);
      repo.clearUserSetting(uid, String(b.topic || ''), String(b.difficulty || ''), Number(b.roundTier));
      return sendJson(res, 200, { grid: repo.settingsGrid(uid) });
    }

    // ---- weekly-report comments (student ↔ tutor, per week) ----
    // GET /api/weekly-comments?week=YYYY-WW
    if (req.method === 'GET' && pathname === '/api/weekly-comments') {
      const week = url.searchParams.get('week') || '';
      return sendJson(res, 200, { comments: repo.listWeeklyComments(requireView(), week) });
    }
    // POST /api/weekly-comments { week, text }
    if (req.method === 'POST' && pathname === '/api/weekly-comments') {
      const b = await readBody(req);
      repo.addWeeklyComment(requireView(), String(b.week || ''), uid, user.activeRole, String(b.text || ''));
      return sendJson(res, 200, { comments: repo.listWeeklyComments(requireView(), String(b.week || '')) });
    }
    // GET /api/notes/unseen — unseen tutor notes for the signed-in student.
    if (req.method === 'GET' && pathname === '/api/notes/unseen') {
      if (user.activeRole !== 'student') return sendJson(res, 200, { count: 0, latest: null });
      return sendJson(res, 200, repo.unseenNotes(uid));
    }
    // POST /api/notes/seen — student acknowledges their notes are read.
    if (req.method === 'POST' && pathname === '/api/notes/seen') {
      if (user.activeRole !== 'student') return sendJson(res, 200, { ok: true });
      return sendJson(res, 200, repo.markNotesSeen(uid));
    }

    // GET /api/dashboard  (own data, or the viewed student's for a tutor)
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      const dash = repo.getDashboard(requireView());
      dash.viewer = { role: user.activeRole, readOnly: isTutor, studentName: user.activeStudentName || null };
      return sendJson(res, 200, dash);
    }

    // GET /api/attempts/:id/review
    if (req.method === 'GET' && parts[1] === 'attempts' && parts[3] === 'review' && parts.length === 4) {
      const review = repo.getAttemptReview(requireView(), Number(parts[2]));
      if (!review) return sendJson(res, 404, { error: 'Attempt not found' });
      return sendJson(res, 200, review);
    }

    // GET /api/questions/:id/review  (Filtered List rows, incl. skipped)
    if (req.method === 'GET' && parts[1] === 'questions' && parts[3] === 'review' && parts.length === 4) {
      const review = repo.getQuestionReview(requireView(), Number(parts[2]));
      if (!review) return sendJson(res, 404, { error: 'Question not found' });
      return sendJson(res, 200, review);
    }

    // ---- admin (manage users, roles, assignments, settings) ----
    if (parts[1] === 'admin') {
      requireAdmin();

      // GET /api/admin/users
      if (req.method === 'GET' && pathname === '/api/admin/users') {
        return sendJson(res, 200, { users: auth.listUsers() });
      }
      // POST /api/admin/users  (create)
      if (req.method === 'POST' && pathname === '/api/admin/users') {
        const b = await readBody(req);
        auth.createUser({ username: b.username, password: b.password, fullName: b.fullName, theme: b.theme, roles: b.roles });
        return sendJson(res, 200, { users: auth.listUsers() });
      }
      // POST /api/admin/users/:id  (update fields)
      if (req.method === 'POST' && parts[2] === 'users' && parts.length === 4) {
        const b = await readBody(req);
        auth.updateUser(Number(parts[3]), b);
        return sendJson(res, 200, { users: auth.listUsers() });
      }
      // POST /api/admin/users/:id/roles  { roles: [...] }
      if (req.method === 'POST' && parts[2] === 'users' && parts[4] === 'roles' && parts.length === 5) {
        const b = await readBody(req);
        auth.setRoles(Number(parts[3]), b.roles || []);
        return sendJson(res, 200, { users: auth.listUsers() });
      }
      // DELETE /api/admin/users/:id
      if (req.method === 'DELETE' && parts[2] === 'users' && parts.length === 4) {
        if (Number(parts[3]) === uid) return sendJson(res, 400, { error: 'You cannot delete your own account.' });
        auth.deleteUser(Number(parts[3]));
        return sendJson(res, 200, { users: auth.listUsers() });
      }
      // POST /api/admin/assign | /api/admin/unassign  { tutorId, studentId }
      if (req.method === 'POST' && (pathname === '/api/admin/assign' || pathname === '/api/admin/unassign')) {
        const b = await readBody(req);
        if (pathname.endsWith('unassign')) auth.unassignStudent(b.tutorId, b.studentId);
        else auth.assignStudent(b.tutorId, b.studentId);
        return sendJson(res, 200, { users: auth.listUsers() });
      }
      // GET /api/admin/settings/global  | POST set | POST reset
      if (req.method === 'GET' && pathname === '/api/admin/settings/global') {
        return sendJson(res, 200, { grid: repo.settingsGrid(null) });
      }
      if (req.method === 'POST' && pathname === '/api/admin/settings/global') {
        const b = await readBody(req);
        repo.setGlobalSetting(String(b.topic || ''), String(b.difficulty || ''), Number(b.roundTier), Math.round(Number(b.minutes) * 60));
        return sendJson(res, 200, { grid: repo.settingsGrid(null) });
      }
      if (req.method === 'POST' && pathname === '/api/admin/settings/global/reset') {
        const b = await readBody(req);
        repo.clearGlobalSetting(String(b.topic || ''), String(b.difficulty || ''), Number(b.roundTier));
        return sendJson(res, 200, { grid: repo.settingsGrid(null) });
      }
      // GET /api/admin/settings/user/:id | POST set | POST reset
      if (req.method === 'GET' && parts[2] === 'settings' && parts[3] === 'user' && parts.length === 5) {
        return sendJson(res, 200, { grid: repo.settingsGrid(Number(parts[4])) });
      }
      if (req.method === 'POST' && parts[2] === 'settings' && parts[3] === 'user' && parts[5] === 'reset' && parts.length === 6) {
        const b = await readBody(req);
        repo.clearUserSetting(Number(parts[4]), String(b.topic || ''), String(b.difficulty || ''), Number(b.roundTier));
        return sendJson(res, 200, { grid: repo.settingsGrid(Number(parts[4])) });
      }
      if (req.method === 'POST' && parts[2] === 'settings' && parts[3] === 'user' && parts.length === 5) {
        const b = await readBody(req);
        repo.setUserSetting(Number(parts[4]), String(b.topic || ''), String(b.difficulty || ''), Number(b.roundTier), Math.round(Number(b.minutes) * 60));
        return sendJson(res, 200, { grid: repo.settingsGrid(Number(parts[4])) });
      }
      // ---- per-student active-question visibility ----
      // GET /api/admin/visibility/:userId
      if (req.method === 'GET' && parts[2] === 'visibility' && parts.length === 4) {
        return sendJson(res, 200, { access: repo.getStudentAccess(Number(parts[3])) });
      }
      // POST /api/admin/visibility/:userId  { domain, mode }  (mode: nonactive|active|all)
      if (req.method === 'POST' && parts[2] === 'visibility' && parts.length === 4) {
        const b = await readBody(req);
        const access = repo.setStudentAccess(Number(parts[3]), String(b.domain || ''), String(b.mode || 'nonactive'));
        return sendJson(res, 200, { access });
      }

      // ---- answer-panel (mask) review ----
      // GET /api/admin/questions?subject=&topic=&difficulty=&skill=&reviewed=
      if (req.method === 'GET' && parts[2] === 'questions' && parts.length === 3) {
        const f = {
          subject: url.searchParams.get('subject') || '',
          topic: url.searchParams.get('topic') || '',
          difficulty: url.searchParams.get('difficulty') || '',
          skill: url.searchParams.get('skill') || '',
          reviewed: url.searchParams.get('reviewed') || '',
        };
        return sendJson(res, 200, { questions: repo.listQuestionsForReview(f) });
      }
      // POST /api/admin/questions/clear-review  { subject, topic, difficulty, skill }
      if (req.method === 'POST' && parts[2] === 'questions' && parts[3] === 'clear-review' && parts.length === 4) {
        const b = await readBody(req);
        return sendJson(res, 200, repo.clearMaskReview(b || {}));
      }
      // POST /api/admin/questions/:id/mask  { maskFraction, approve }
      if (req.method === 'POST' && parts[2] === 'questions' && parts[4] === 'mask' && parts.length === 5) {
        const b = await readBody(req);
        return sendJson(res, 200, repo.setQuestionMask(Number(parts[3]), b.maskFraction, !!b.approve));
      }

      // GET /api/admin/bugs?status=open|closed|all
      if (req.method === 'GET' && pathname === '/api/admin/bugs') {
        const st = url.searchParams.get('status') || 'open';
        return sendJson(res, 200, repo.listBugReports({ status: st === 'all' ? undefined : st }));
      }
      // POST /api/admin/bugs/:id/close
      if (req.method === 'POST' && parts[2] === 'bugs' && parts[4] === 'close' && parts.length === 5) {
        return sendJson(res, 200, repo.closeBugReport(Number(parts[3]), uid));
      }
      // POST /api/admin/bugs/:id/reopen
      if (req.method === 'POST' && parts[2] === 'bugs' && parts[4] === 'reopen' && parts.length === 5) {
        return sendJson(res, 200, repo.reopenBugReport(Number(parts[3])));
      }

      return sendJson(res, 404, { error: 'Unknown admin endpoint' });
    }

    // POST /api/bugs  — any authenticated user can report a bug (uid already verified above)
    if (req.method === 'POST' && pathname === '/api/bugs') {
      const b = await readBody(req);
      return sendJson(res, 201, repo.addBugReport(uid, { message: b.message, page: b.page }));
    }

    return sendJson(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('API error:', err);
    const payload = { error: err.message || 'Server error' };
    if (err.activeSessionId) payload.activeSessionId = err.activeSessionId;
    if (err.remaining) payload.remaining = err.remaining;
    return sendJson(res, status, payload);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`\n  🌸 SAT Practice running → http://localhost:${PORT}\n`);
});
