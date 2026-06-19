// Shared helpers used across pages.

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
    throw new Error(msg);
  }
  return data;
}

async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  location.href = '/login.html';
}

// Show the signed-in user + a log-out link in the top bar of every page.
async function mountUserMenu() {
  const nav = document.querySelector('.navlinks');
  if (!nav) return;
  try {
    const me = await api('GET', '/api/me');
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

if (!location.pathname.endsWith('/login.html')) {
  document.addEventListener('DOMContentLoaded', mountUserMenu);
}

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
