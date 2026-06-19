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
    execFileSync(node, ['scripts/generate-seed.js'], { cwd: __dirname, stdio: 'inherit' });
    execFileSync(node, ['--experimental-sqlite', 'scripts/seed.js'], { cwd: __dirname, stdio: 'inherit' });
    console.log('First-time setup complete.');
  } catch (e) {
    console.error('Auto-seed failed:', e.message);
  }
})();

const repo = require('./repo');
const { isValidTopic, isValidDifficulty, domainOfTopic } = require('./topics');

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

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
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
          res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(html);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]

  try {
    // GET /api/overview
    if (req.method === 'GET' && pathname === '/api/overview') {
      return sendJson(res, 200, {
        today:       repo.getTodayProgress(),
        catalogue:   repo.getCatalogue(),
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
      const result = repo.createOrResumeSession(domain, topic, difficulty);
      return sendJson(res, 200, result);
    }

    // GET /api/sessions/:id
    if (req.method === 'GET' && parts[1] === 'sessions' && parts.length === 3) {
      const state = repo.getSessionState(Number(parts[2]));
      if (!state) return sendJson(res, 404, { error: 'Session not found' });
      return sendJson(res, 200, state);
    }

    // GET /api/sessions/:id/questions/:position
    if (req.method === 'GET' && parts[1] === 'sessions' && parts[3] === 'questions' && parts.length === 5) {
      const data = repo.getQuestionAt(Number(parts[2]), Number(parts[4]));
      if (!data) return sendJson(res, 404, { error: 'Question not found' });
      repo.setCurrentPosition(Number(parts[2]), Number(parts[4]));
      return sendJson(res, 200, data);
    }

    // POST /api/sessions/:id/answer
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'answer' && parts.length === 4) {
      const body = await readBody(req);
      const result = repo.submitAnswer(Number(parts[2]), Number(body.questionId), String(body.selected), Number(body.timeTaken));
      return sendJson(res, 200, result);
    }

    // POST /api/sessions/:id/complete
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'complete' && parts.length === 4) {
      return sendJson(res, 200, repo.completeSession(Number(parts[2])));
    }

    // GET /api/dashboard
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      return sendJson(res, 200, repo.getDashboard());
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
