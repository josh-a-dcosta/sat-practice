'use strict';

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

// Load the username/password list from COLLEGEBOARD/users.txt on startup.
auth.loadUsers();

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

    // GET /api/me
    if (req.method === 'GET' && pathname === '/api/me') {
      return sendJson(res, 200, { user });
    }

    // GET /api/overview
    if (req.method === 'GET' && pathname === '/api/overview') {
      return sendJson(res, 200, {
        user,
        today:       repo.getTodayProgress(uid),
        catalogue:   repo.getCatalogue(uid),
        timeLimit:   repo.TIME_LIMIT,
        sessionSize: repo.SESSION_SIZE,
      });
    }

    // POST /api/sessions  { topic, difficulty }
    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await readBody(req);
      const topic      = String(body.topic || '');
      const difficulty = String(body.difficulty || 'medium').toLowerCase();
      if (!isValidTopic(topic))      return sendJson(res, 400, { error: 'Invalid topic' });
      if (!isValidDifficulty(difficulty)) return sendJson(res, 400, { error: 'difficulty must be "medium" or "hard"' });
      const domain = domainOfTopic(topic);
      const result = repo.createOrResumeSession(uid, domain, topic, difficulty);
      return sendJson(res, 200, result);
    }

    // GET /api/sessions/:id
    if (req.method === 'GET' && parts[1] === 'sessions' && parts.length === 3) {
      const state = repo.getSessionState(uid, Number(parts[2]));
      if (!state) return sendJson(res, 404, { error: 'Session not found' });
      return sendJson(res, 200, state);
    }

    // GET /api/sessions/:id/questions/:position
    if (req.method === 'GET' && parts[1] === 'sessions' && parts[3] === 'questions' && parts.length === 5) {
      const data = repo.getQuestionAt(uid, Number(parts[2]), Number(parts[4]));
      if (!data) return sendJson(res, 404, { error: 'Question not found' });
      repo.setCurrentPosition(uid, Number(parts[2]), Number(parts[4]));
      return sendJson(res, 200, data);
    }

    // POST /api/sessions/:id/answer
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'answer' && parts.length === 4) {
      const body = await readBody(req);
      const result = repo.submitAnswer(uid, Number(parts[2]), Number(body.questionId), String(body.selected), Number(body.timeTaken));
      return sendJson(res, 200, result);
    }

    // POST /api/sessions/:id/complete
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'complete' && parts.length === 4) {
      return sendJson(res, 200, repo.completeSession(uid, Number(parts[2])));
    }

    // GET /api/dashboard
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      return sendJson(res, 200, repo.getDashboard(uid));
    }

    // GET /api/attempts/:id/review
    if (req.method === 'GET' && parts[1] === 'attempts' && parts[3] === 'review' && parts.length === 4) {
      const review = repo.getAttemptReview(uid, Number(parts[2]));
      if (!review) return sendJson(res, 404, { error: 'Attempt not found' });
      return sendJson(res, 200, review);
    }

    return sendJson(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('API error:', err);
    return sendJson(res, status, { error: err.message || 'Server error' });
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
