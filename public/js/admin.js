// Admin console: users & roles, tutor assignments, global + per-user timers.
const $ = (id) => document.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

let USERS = [];
const THEMES = ['gray', 'pink', 'blue', 'green', 'yellow'];
const ROLES = ['student', 'tutor', 'admin'];
const SUBJECTS = [{ key:'math', label:'🔢 Math' }, { key:'reading', label:'📖 Reading & Writing' }];

function showView(name) {
  document.querySelectorAll('.dash-view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
  document.querySelectorAll('.dash-menu .menu-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'global') loadGlobalTimers();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.dash-menu .menu-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---- Users & roles --------------------------------------------------------
function userName(id) { const u = USERS.find((x) => x.id === id); return u ? u.fullName : '?'; }

function renderUsers() {
  const tb = $('usersTable').querySelector('tbody');
  tb.innerHTML = USERS.map((u) => {
    const themeOpts = THEMES.map((t) => `<option value="${t}" ${u.theme===t?'selected':''}>${t}</option>`).join('');
    const roleBoxes = ROLES.map((r) => `<label class="rl"><input type="checkbox" class="uRole" value="${r}" ${u.roles.includes(r)?'checked':''}/> ${r}</label>`).join(' ');
    return `<tr data-id="${u.id}">
      <td><input class="spr-input uName" value="${esc(u.fullName)}" style="min-width:140px"/></td>
      <td><input class="spr-input uUser" value="${esc(u.username)}" style="width:110px"/></td>
      <td>${roleBoxes}</td>
      <td><select class="uTheme">${themeOpts}</select></td>
      <td><input class="spr-input uPass" type="text" placeholder="(unchanged)" style="width:120px"/></td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary uSave" type="button">Save</button>
        <button class="btn btn-ghost uTimers" type="button">⏱️</button>
        <button class="btn btn-ghost uDel" type="button">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

async function refreshUsers(payload) { USERS = payload ? payload.users : (await api('GET', '/api/admin/users')).users; renderUsers(); populateAssign(); renderAssign(); }

$('usersTable').addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-id]'); if (!row) return;
  const id = Number(row.dataset.id);
  try {
    if (e.target.closest('.uSave')) {
      const roles = [...row.querySelectorAll('.uRole:checked')].map((c) => c.value);
      await api('POST', `/api/admin/users/${id}`, {
        username: row.querySelector('.uUser').value.trim(),
        fullName: row.querySelector('.uName').value.trim(),
        theme: row.querySelector('.uTheme').value,
        password: row.querySelector('.uPass').value || undefined,
      });
      const r = await api('POST', `/api/admin/users/${id}/roles`, { roles });
      showToast('Saved ✓'); refreshUsers(r);
    } else if (e.target.closest('.uTimers')) {
      openUserTimers(id);
    } else if (e.target.closest('.uDel')) {
      if (confirm(`Delete ${userName(id)}? This removes all their data and cannot be undone.`)) {
        const r = await api('DELETE', `/api/admin/users/${id}`); showToast('Deleted'); refreshUsers(r);
      }
    }
  } catch (err) { showToast(err.message); }
});

$('addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const roles = [...document.querySelectorAll('.nuRole:checked')].map((c) => c.value);
  try {
    const r = await api('POST', '/api/admin/users', {
      fullName: $('nuName').value.trim(), username: $('nuUser').value.trim(),
      password: $('nuPass').value, theme: $('nuTheme').value, roles,
    });
    $('nuName').value = $('nuUser').value = $('nuPass').value = '';
    showToast('User added ✓'); refreshUsers(r);
  } catch (err) { showToast(err.message); }
});

// ---- Tutor assignments ----------------------------------------------------
function populateAssign() {
  const tutors = USERS.filter((u) => u.roles.includes('tutor'));
  const students = USERS.filter((u) => u.roles.includes('student'));
  const cur = $('asgTutor').value;
  $('asgTutor').innerHTML = tutors.map((u) => `<option value="${u.id}">${esc(u.fullName)}</option>`).join('') || '<option value="">(no tutors)</option>';
  if (cur) $('asgTutor').value = cur;
  $('asgStudent').innerHTML = students.map((u) => `<option value="${u.id}">${esc(u.fullName)}</option>`).join('');
}

function renderAssign() {
  const tutorId = Number($('asgTutor').value);
  const tutor = USERS.find((u) => u.id === tutorId);
  const wrap = $('asgList');
  if (!tutor) { wrap.innerHTML = '<p class="note">Add a tutor role to a user to assign students.</p>'; return; }
  const list = tutor.studentIds.map((sid) => `<div class="cal-attempt">
      <span>🎒 <b>${esc(userName(sid))}</b></span>
      <button class="btn btn-ghost asgRemove" data-sid="${sid}">✕ Remove</button>
    </div>`).join('') || '<p class="note">No students assigned yet.</p>';
  wrap.innerHTML = `<h3 class="mini-h">${esc(tutor.fullName)}'s students</h3>${list}`;
}

$('asgTutor').addEventListener('change', renderAssign);
$('asgAddBtn').addEventListener('click', async () => {
  const tutorId = Number($('asgTutor').value), studentId = Number($('asgStudent').value);
  if (!tutorId || !studentId) return;
  try { const r = await api('POST', '/api/admin/assign', { tutorId, studentId }); refreshUsers(r); }
  catch (err) { showToast(err.message); }
});
$('asgList').addEventListener('click', async (e) => {
  const b = e.target.closest('.asgRemove'); if (!b) return;
  const tutorId = Number($('asgTutor').value), studentId = Number(b.dataset.sid);
  try { const r = await api('POST', '/api/admin/unassign', { tutorId, studentId }); refreshUsers(r); }
  catch (err) { showToast(err.message); }
});

// ---- Timer grids (shared by global + per-user) ----------------------------
function timerGridHtml(grid, mode) {
  let html = '';
  for (const sub of SUBJECTS) {
    const topics = [];
    for (const g of grid) if (g.subject === sub.key && !topics.find((t) => t.topic === g.topic)) topics.push({ topic: g.topic, name: g.topicName });
    if (!topics.length) continue;
    html += `<h3 class="mini-h">${sub.label}</h3><div style="overflow-x:auto"><table class="data set-table">
      <thead><tr><th>Section</th><th>Difficulty</th><th>Round 1</th><th>Round 2+</th></tr></thead><tbody>`;
    for (const t of topics) {
      for (const diff of ['medium', 'hard']) {
        const c1 = grid.find((g) => g.topic===t.topic && g.difficulty===diff && g.roundTier===1);
        const c2 = grid.find((g) => g.topic===t.topic && g.difficulty===diff && g.roundTier===2);
        html += `<tr><td><b>${esc(t.name)}</b></td><td>${diff==='hard'?'🔴 Hard':'🟡 Medium'}</td>
          <td>${cellHtml(c1, mode)}</td><td>${cellHtml(c2, mode)}</td></tr>`;
      }
    }
    html += `</tbody></table></div>`;
  }
  return html;
}
function cellHtml(c, mode) {
  const eff = c.effectiveSeconds / 60;
  const custom = mode === 'global' ? (c.effectiveSeconds !== 600) : (c.userSeconds != null);
  const def = mode === 'global' ? 10 : (c.globalSeconds / 60);
  return `<div class="set-cell ${custom?'custom':''}">
    <input class="spr-input mins" type="number" min="0.5" max="60" step="0.5" value="${eff}" title="Default ${def} min"
      data-topic="${esc(c.topic)}" data-diff="${c.difficulty}" data-tier="${c.roundTier}" />
    <span class="set-min">min</span>
    <button class="set-reset ${custom?'':'hidden'}" data-topic="${esc(c.topic)}" data-diff="${c.difficulty}" data-tier="${c.roundTier}">↺</button>
  </div>`;
}

// Global timers
async function loadGlobalTimers() {
  try { const g = (await api('GET', '/api/admin/settings/global')).grid; $('globalGrid').innerHTML = timerGridHtml(g, 'global'); }
  catch (e) { $('globalGrid').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
$('globalGrid').addEventListener('change', async (e) => {
  const i = e.target.closest('input.mins'); if (!i) return;
  const m = parseFloat(i.value); if (!m || m <= 0) return showToast('Enter minutes > 0');
  try { const g = (await api('POST', '/api/admin/settings/global', { topic:i.dataset.topic, difficulty:i.dataset.diff, roundTier:Number(i.dataset.tier), minutes:m })).grid; $('globalGrid').innerHTML = timerGridHtml(g,'global'); showToast('Saved ✓'); }
  catch (err) { showToast(err.message); }
});
$('globalGrid').addEventListener('click', async (e) => {
  const b = e.target.closest('.set-reset'); if (!b) return;
  try { const g = (await api('POST', '/api/admin/settings/global/reset', { topic:b.dataset.topic, difficulty:b.dataset.diff, roundTier:Number(b.dataset.tier) })).grid; $('globalGrid').innerHTML = timerGridHtml(g,'global'); }
  catch (err) { showToast(err.message); }
});

// Per-user timers modal
let UT_ID = null;
async function openUserTimers(id) {
  UT_ID = id;
  $('utTitle').textContent = `⏱️ ${userName(id)} — timers`;
  $('userTimerModal').classList.remove('hidden');
  $('utGrid').innerHTML = '<div class="spinner">Loading…</div>';
  try { const g = (await api('GET', `/api/admin/settings/user/${id}`)).grid; $('utGrid').innerHTML = timerGridHtml(g, 'user'); }
  catch (e) { $('utGrid').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}
$('utClose').addEventListener('click', () => $('userTimerModal').classList.add('hidden'));
$('userTimerModal').addEventListener('click', (e) => { if (e.target.id === 'userTimerModal') $('userTimerModal').classList.add('hidden'); });
$('utGrid').addEventListener('change', async (e) => {
  const i = e.target.closest('input.mins'); if (!i || UT_ID == null) return;
  const m = parseFloat(i.value); if (!m || m <= 0) return showToast('Enter minutes > 0');
  try { const g = (await api('POST', `/api/admin/settings/user/${UT_ID}`, { topic:i.dataset.topic, difficulty:i.dataset.diff, roundTier:Number(i.dataset.tier), minutes:m })).grid; $('utGrid').innerHTML = timerGridHtml(g,'user'); showToast('Saved ✓'); }
  catch (err) { showToast(err.message); }
});
$('utGrid').addEventListener('click', async (e) => {
  const b = e.target.closest('.set-reset'); if (!b || UT_ID == null) return;
  try { const g = (await api('POST', `/api/admin/settings/user/${UT_ID}/reset`, { topic:b.dataset.topic, difficulty:b.dataset.diff, roundTier:Number(b.dataset.tier) })).grid; $('utGrid').innerHTML = timerGridHtml(g,'user'); }
  catch (err) { showToast(err.message); }
});

// ---- init ----
(async function init() {
  try { await refreshUsers(); showView('users'); }
  catch (e) { document.querySelector('.container').innerHTML = `<div class="card"><p class="note">Could not load admin: ${esc(e.message)}</p></div>`; }
})();
