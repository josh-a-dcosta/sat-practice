// Shared helpers used across pages.

// ----- Theme (accent color) + light/dark mode -----
const THEME_ICON = { pink: '🌸', blue: '⚽', gray: '🎓' };

function brandIcon(theme) { return THEME_ICON[theme] || THEME_ICON.gray; }

// Resolve the initial mode: saved choice, else default to dark.
function initialMode() {
  const saved = localStorage.getItem('mode');
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
}

function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
  const btn = document.getElementById('modeToggle');
  if (btn) btn.textContent = mode === 'dark' ? '☀️' : '🌙';
}

function setMode(mode) { localStorage.setItem('mode', mode); applyMode(mode); }
function toggleMode() { setMode(document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark'); }

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'gray';
  document.querySelectorAll('.brand-icon').forEach((el) => { el.textContent = brandIcon(theme); });
}

// Apply remembered theme + mode immediately (a tiny inline <head> script also
// does this to avoid any flash; this is the safety net if that's absent).
applyMode(initialMode());
applyTheme(localStorage.getItem('theme') || 'gray');

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  if (res.status === 401 && !location.pathname.endsWith('/login.html')) {
    location.href = '/login.html';
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  localStorage.removeItem('theme');
  applyTheme('gray');                  // back to the neutral pre-login look
  location.href = '/login.html';
}

// Add a light/dark toggle to the top bar (every page that has a nav).
function mountModeToggle() {
  const nav = document.querySelector('.navlinks');
  if (!nav || document.getElementById('modeToggle')) return;
  const btn = document.createElement('button');
  btn.id = 'modeToggle';
  btn.type = 'button';
  btn.className = 'mode-toggle';
  btn.title = 'Toggle light / dark';
  btn.addEventListener('click', toggleMode);
  nav.appendChild(btn);
  applyMode(document.documentElement.dataset.mode || 'light');
}

// Show the signed-in user + a log-out link, and apply their accent theme.
async function mountUserMenu() {
  mountModeToggle();
  const nav = document.querySelector('.navlinks');
  if (!nav) return;
  try {
    const me = await api('GET', '/api/me');
    const theme = me.user.theme || 'gray';
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    const chip = document.createElement('span');
    chip.className = 'user-chip';
    chip.textContent = `👤 ${me.user.username}`;
    const out = document.createElement('a');
    out.href = '#';
    out.textContent = 'Log out';
    out.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    nav.appendChild(chip);
    nav.appendChild(out);
  } catch (_) { /* api() handles the 401 redirect */ }
}

document.addEventListener('DOMContentLoaded', mountUserMenu);

const ENCOURAGEMENTS = [
  'You\'ve got this! 💪',
  'Keep going, superstar! ⭐',
  'Nice work — on to the next! 🌸',
  'You\'re doing amazing! 💖',
  'One step closer! 🚀',
  'Stay focused, you\'re shining! ✨',
  'Great effort! Keep it up! 🌟',
  'Brain power activated! 🧠💕',
  'Look at you go! 🎀',
  'Every question makes you stronger! 🌷',
];

function randomEncouragement() {
  return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
}

let _toastTimer = null;
function showToast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  // force reflow then show
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function fmtTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}
