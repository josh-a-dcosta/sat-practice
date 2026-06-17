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
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
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
