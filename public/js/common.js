// Shared helpers used across pages.

// ----- Skill name abbreviation (long College Board names overwhelm kids) -----
// Curated short forms for the known skills; anything else falls back to a smart
// shortener. The full name is always shown in a tooltip.
const SKILL_ABBR = {
  // Algebra
  'Linear equations in one variable': 'Linear eqns · 1 var',
  'Linear equations in two variables': 'Linear eqns · 2 vars',
  'Systems of two linear equations in two variables': 'Systems of linear eqns',
  'Linear functions': 'Linear functions',
  'Linear inequalities in one or two variables': 'Linear inequalities',
  // Advanced Math
  'Nonlinear functions': 'Nonlinear functions',
  'Nonlinear equations in one variable and systems of equations in two variables': 'Nonlinear eqns & systems',
  'Equivalent expressions': 'Equivalent expressions',
  // Problem-Solving & Data Analysis
  'Inference from sample statistics and margin of error': 'Inference & margin of error',
  'Percentages': 'Percentages',
  'One-variable data: Distributions and measures of center and spread': 'One-variable data',
  'Evaluating statistical claims: Observational studies and experiments': 'Evaluating stat claims',
  'Two-variable data: Models and scatterplots': 'Two-variable data',
  'Probability and conditional probability': 'Probability',
  'Ratios, rates, proportional relationships, and units': 'Ratios, rates & units',
  // Geometry & Trig
  'Lines, angles, and triangles': 'Lines, angles & triangles',
  'Area and volume': 'Area & volume',
  'Right triangles and trigonometry': 'Right triangles & trig',
  'Circles': 'Circles',
  // Reading & Writing
  'Central Ideas and Details': 'Central ideas & details',
  'Command of Evidence': 'Command of evidence',
  'Inferences': 'Inferences',
  'Words in Context': 'Words in context',
  'Text Structure and Purpose': 'Text structure & purpose',
  'Cross-Text Connections': 'Cross-text connections',
  'Rhetorical Synthesis': 'Rhetorical synthesis',
  'Transitions': 'Transitions',
  'Boundaries': 'Boundaries',
  'Form, Structure, and Sense': 'Form, structure & sense',
};
function abbrevSkill(name) {
  if (!name) return '';
  if (SKILL_ABBR[name]) return SKILL_ABBR[name];
  // "Label: detail…" → keep the label before the colon when it's short enough.
  const colon = name.indexOf(':');
  if (colon > 0 && colon <= 28) return name.slice(0, colon).trim();
  if (name.length <= 26) return name;
  // Otherwise trim to ~24 chars on a word boundary and add an ellipsis.
  return name.slice(0, 24).replace(/[\s,]+\S*$/, '').trim() + '…';
}

// ----- Theme (accent color) + light/dark mode -----
const THEME_ICON = { pink: '🏆', blue: '⚽', gray: '🎓', green: '🌿', yellow: '🌟' };

function brandIcon(theme) { return THEME_ICON[theme] || THEME_ICON.gray; }

// Resolve the initial mode: saved choice, else default to light.
function initialMode() {
  const saved = localStorage.getItem('mode');
  if (saved === 'light' || saved === 'dark') return saved;
  return 'light';
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

// ----- Roles: landing pages, page access, and per-role nav -----
const ROLE_LANDING = { student: '/', tutor: '/dashboard.html', admin: '/admin.html' };

// Where a freshly-resolved user should land (or the picker if not resolved).
function landingFor(user) {
  if (!user || !user.activeRole) return '/select.html';
  if (user.activeRole === 'tutor' && !user.activeStudentId) return '/select.html';
  return ROLE_LANDING[user.activeRole] || '/';
}

function currentPageKey() {
  const p = location.pathname;
  if (p === '/' || p.endsWith('/index.html')) return 'home';
  if (p.endsWith('/dashboard.html')) return 'dashboard';
  if (p.endsWith('/session.html')) return 'session';
  if (p.endsWith('/settings.html')) return 'settings';
  if (p.endsWith('/admin.html')) return 'admin';
  if (p.endsWith('/select.html')) return 'select';
  if (p.endsWith('/login.html')) return 'login';
  return 'other';
}

// Which pages each role may view (the server also enforces this).
const ROLE_ALLOWED = {
  student: ['home', 'dashboard', 'session', 'settings'],
  tutor:   ['dashboard', 'session'],   // session = read-only review of their student
  admin:   ['admin'],
};

// Rebuild the top-nav links for the active role.
function buildRoleNav(user) {
  const nav = document.querySelector('.navlinks');
  if (!nav) return;
  nav.innerHTML = '';
  const page = currentPageKey();
  const add = (href, label, key) => {
    const a = document.createElement('a');
    a.className = 'nav-btn' + (key === page ? ' active' : '');
    a.href = href; a.textContent = label;
    nav.appendChild(a);
  };
  if (user.activeRole === 'student') {
    add('/', '🏠 Home', 'home');
    add('/dashboard.html', '📊 Dashboard', 'dashboard');
    add('/settings.html', '⚙️ Settings', 'settings');
  } else if (user.activeRole === 'tutor') {
    add('/dashboard.html', '📊 Dashboard', 'dashboard');
  } else if (user.activeRole === 'admin') {
    add('/admin.html', '🛠️ Admin', 'admin');
  }
}

// Show the signed-in user + role nav + switch/log-out, and apply their theme.
// Also enforces page access for the active role (redirects, no back button).
async function mountUserMenu() {
  let me;
  try { me = (await api('GET', '/api/me')).user; } catch (_) { return; /* 401 handled by api() */ }
  applyTheme(me.theme || 'gray');
  localStorage.setItem('theme', me.theme || 'gray');
  window.__ME = me;
  try { document.body.dataset.role = me.activeRole || ''; } catch (_) { /* ignore */ }

  const page = currentPageKey();
  if (page !== 'select' && page !== 'login') {
    if (!me.activeRole || (me.activeRole === 'tutor' && !me.activeStudentId)) {
      location.href = '/select.html'; return;
    }
    if (!(ROLE_ALLOWED[me.activeRole] || []).includes(page)) {
      location.href = landingFor(me); return;
    }
  }

  const nav = document.querySelector('.navlinks');
  if (!nav) return;
  buildRoleNav(me);
  mountModeToggle();

  const chip = document.createElement('span');
  chip.className = 'user-chip';
  chip.textContent = (me.activeRole === 'tutor' && me.activeStudentName)
    ? `👤 ${me.fullName} · viewing ${me.activeStudentName}`
    : `👤 ${me.fullName}`;
  nav.appendChild(chip);

  if ((me.roles && me.roles.length > 1) || me.activeRole === 'tutor') {
    const sw = document.createElement('a');
    sw.href = '/select.html';
    sw.className = 'nav-switch';
    sw.textContent = '🔄 Switch';
    nav.appendChild(sw);
  }

  const out = document.createElement('a');
  out.href = '#';
  out.className = 'nav-logout';
  out.textContent = '⎋ Log out';
  out.addEventListener('click', (e) => { e.preventDefault(); logout(); });
  nav.appendChild(out);
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
