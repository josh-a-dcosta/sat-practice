'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const repo = require('./repo');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // prevent path traversal
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // SPA-ish fallback: serve index for unknown non-API GET paths
      if (path.extname(filePath) === '') {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// --- API routing ------------------------------------------------------------
async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const parts = pathname.split('/').filter(Boolean); // e.g. ['api','sessions','3','answer']

  try {
    // GET /api/overview  -> section stats + today's progress
    if (req.method === 'GET' && pathname === '/api/overview') {
      return sendJson(res, 200, {
        today: repo.getTodayProgress(),
        sections: ['math', 'reading'].map(repo.getSectionStats),
        timeLimit: repo.TIME_LIMIT_SECONDS,
        sessionSize: repo.SESSION_SIZE,
      });
    }

    // POST /api/sessions  { section }  -> create or resume
    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await readBody(req);
      const section = String(body.section || '').toLowerCase();
      if (!['math', 'reading'].includes(section)) return sendJson(res, 400, { error: 'section must be "math" or "reading"' });
      const result = repo.createOrResumeSession(section);
      return sendJson(res, 200, result);
    }

    // GET /api/sessions/:id  -> session navigation state
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

    // POST /api/sessions/:id/answer  { questionId, selected, timeTaken }
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'answer' && parts.length === 4) {
      const body = await readBody(req);
      const result = repo.submitAnswer(Number(parts[2]), Number(body.questionId), String(body.selected), Number(body.timeTaken));
      return sendJson(res, 200, result);
    }

    // POST /api/sessions/:id/complete  -> finalize + review
    if (req.method === 'POST' && parts[1] === 'sessions' && parts[3] === 'complete' && parts.length === 4) {
      const result = repo.completeSession(Number(parts[2]));
      return sendJson(res, 200, result);
    }

    // GET /api/dashboard
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      return sendJson(res, 200, repo.getDashboard());
    }

    return sendJson(res, 404, { error: 'Unknown API endpoint' });
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
  console.log(`\n  🌸 SAT Practice is running!`);
  console.log(`  Open your browser to:  http://localhost:${PORT}\n`);
});
