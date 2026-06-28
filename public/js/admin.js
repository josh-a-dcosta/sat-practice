// Admin console: users & roles, tutor assignments, global + per-user timers.
const $ = (id) => document.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

let USERS = [];
const THEMES = THEME_KEYS;   // from common.js — single source
const ROLES = ROLE_KEYS;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Fill the Add-user form's theme dropdown + role checkboxes from the shared
// lists (no hardcoded options in the HTML).
function initAddUserForm() {
  const th = $('nuTheme');
  if (th) th.innerHTML = THEMES.map((t) => `<option value="${t}">${cap(t)}</option>`).join('');
  const rl = $('nuRoles');
  if (rl) rl.innerHTML = ROLES.map((r) => `<label class="rl"><input type="checkbox" class="nuRole" value="${r}" ${r === 'student' ? 'checked' : ''}/> ${cap(r)}</label>`).join(' ');
}
const SUBJECTS = SUBJECT_KEYS.map(k => ({ key: k, label: subjectLabel(k) }));

function showView(name) {
  document.querySelectorAll('.dash-view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
  document.querySelectorAll('.dash-menu .menu-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'global') loadGlobalTimers();
  if (name === 'review') initReview();
  if (name === 'bugs') loadBugs();
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
    const acc = u.activeAccess || { math: 'nonactive', reading: 'nonactive' };
    const isStudent = u.roles.includes('student');
    // Per-subject practice pool (nonactive | active | all). Only for students.
    const modeSel = (dom, label) => {
      const v = acc[dom] || 'nonactive';
      const opt = (val, txt) => `<option value="${val}" ${v===val?'selected':''}>${txt}</option>`;
      return `<label class="rl" title="Which ${dom} questions ${esc(u.fullName)} practices">${label}
        <select class="uActive" data-domain="${dom}" data-prev="${v}">${opt('nonactive','Nonactive')}${opt('active','Active')}${opt('all','All')}</select></label>`;
    };
    const accToggles = isStudent ? modeSel('math', subjectEmoji('math')) + modeSel('reading', subjectEmoji('reading')) : '<span class="note">—</span>';
    const engagement = `<span class="eng" title="${u.lastLoginAt ? 'Last login: ' + fmtUserDate(u.lastLoginAt) : 'Never logged in'}">🔑 ${u.loginCount || 0}<br>⏱ ${fmtDuration(u.practiceSeconds || 0)}</span>`;
    return `<tr data-id="${u.id}">
      <td><input class="spr-input uName" value="${esc(u.fullName)}" style="min-width:140px"/></td>
      <td><input class="spr-input uUser" value="${esc(u.username)}" style="width:110px"/></td>
      <td class="active-cell">${accToggles}</td>
      <td>${roleBoxes}</td>
      <td class="eng-cell">${engagement}</td>
      <td style="text-align:center"><button class="btn btn-ghost uTimers icon-btn" type="button" title="Edit per-question timers">⏱️</button></td>
      <td><select class="uTheme">${themeOpts}</select></td>
      <td><input class="spr-input uPass" type="text" placeholder="(unchanged)" style="width:120px"/></td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary uSave" type="button">Save</button>
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

// Per-subject practice-pool dropdowns — save immediately on change.
$('usersTable').addEventListener('change', async (e) => {
  const c = e.target.closest('.uActive'); if (!c) return;
  const row = e.target.closest('tr[data-id]'); if (!row) return;
  const id = Number(row.dataset.id);
  const prev = c.dataset.prev || 'nonactive';
  try {
    await api('POST', `/api/admin/visibility/${id}`, { domain: c.dataset.domain, mode: c.value });
    c.dataset.prev = c.value;
    showToast(`${c.dataset.domain}: ${c.value} questions ✓`);
  } catch (err) { showToast(err.message); c.value = prev; }
});

// ---- small formatters for engagement stats -------------------------------
function fmtDuration(secs) {
  secs = Math.round(secs || 0);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${secs}s`;
}
function fmtUserDate(s) {
  if (!s) return '';
  // Stored UTC ("YYYY-MM-DD HH:MM:SS"); show in the viewer's local (US East) time.
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

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
      <thead><tr><th>Section</th><th>Mode</th><th>Round 1</th><th>Round 2+</th></tr></thead><tbody>`;
    for (const t of topics) {
      for (const diff of ['medium', 'hard']) {
        const c1 = grid.find((g) => g.topic===t.topic && g.difficulty===diff && g.roundTier===1);
        const c2 = grid.find((g) => g.topic===t.topic && g.difficulty===diff && g.roundTier===2);
        html += `<tr><td><b>${esc(t.name)}</b></td><td>${diffLabel(diff)}</td>
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

// Per-user timers modal (active-question visibility lives in the Users table).
let UT_ID = null;
async function openUserTimers(id) {
  UT_ID = id;
  $('utTitle').textContent = `⏱️ ${userName(id)} — timers`;
  $('userTimerModal').classList.remove('hidden');
  $('utGrid').innerHTML = '<div class="spinner">Loading…</div>';
  try { const g = (await api('GET', `/api/admin/settings/user/${id}`)).grid; $('utGrid').innerHTML = timerGridHtml(g, 'user'); }
  catch (e) { $('utGrid').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

// ---- Question Review (answer-panel mask) ----------------------------------
let QR_ALL = null, QR = [], QRI = 0;

async function initReview() {
  if (QR_ALL) return;
  $('qrViewer').innerHTML = '<div class="spinner">Loading questions…</div>';
  try {
    QR_ALL = (await api('GET', '/api/admin/questions')).questions;
    populateReviewFilters();
    $('qrViewer').innerHTML = '<p class="note">Set a filter and click Apply to start reviewing.</p>';
  } catch (e) { $('qrViewer').innerHTML = `<p class="note">${esc(e.message)}</p>`; }
}

function populateReviewFilters() {
  const subj = $('qrSubject').value, prevTop = $('qrTopic').value;
  const topics = [...new Map(QR_ALL.filter((q) => !subj || q.domain === subj).map((q) => [q.topic, q.topicName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  $('qrTopic').innerHTML = '<option value="">All</option>' + topics.map(([t, n]) => `<option value="${esc(t)}">${esc(n)}</option>`).join('');
  if (prevTop && topics.find((t) => t[0] === prevTop)) $('qrTopic').value = prevTop;
  const top = $('qrTopic').value;
  const skills = [...new Set(QR_ALL.filter((q) => (!subj || q.domain === subj) && (!top || q.topic === top)).map((q) => q.skill))].sort();
  $('qrSkill').innerHTML = '<option value="">All</option>' + skills.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}

function applyReviewFilter() {
  const subj = $('qrSubject').value, top = $('qrTopic').value, diff = $('qrDiff').value, skill = $('qrSkill').value, rev = $('qrReviewed').value;
  const act = $('qrActive') ? $('qrActive').value : '';
  QR = QR_ALL.filter((q) =>
    (!subj || q.domain === subj) && (!top || q.topic === top) && (!diff || q.difficulty === diff) &&
    (!skill || q.skill === skill) && (rev === '' || (rev === '1' ? q.reviewed : !q.reviewed)) &&
    (act === '' || (act === '1' ? q.active : !q.active)));
  QRI = 0;
  $('qrCount').textContent = `${QR.length} question(s)`;
  renderReviewQ();
}

function renderReviewQ() {
  const v = $('qrViewer');
  if (!QR.length) { v.innerHTML = '<p class="note">No questions match — nothing to review here. 🎉</p>'; $('qrNav').style.display = 'none'; return; }
  QRI = Math.max(0, Math.min(QRI, QR.length - 1));
  const q = QR[QRI];
  $('qrNav').style.display = '';
  $('qrPos').textContent = `${QRI + 1} / ${QR.length} · ${q.topicName} ${diffLabel(q.difficulty, false)} · ${q.active ? '🟢 active' : '⚪ nonactive'} · ${q.reviewed ? '✓ approved' : 'to review'}`;
  if (!q.image) {
    v.innerHTML = `<p class="note">Text question (no page image / answer mask). ID ${esc(q.extId)}.</p>`;
    return;
  }
  v.innerHTML = `<div class="qr-frame" id="qrFrame">
      <img class="qr-img" id="qrImg" src="${esc(q.image)}" alt="Question ${esc(q.extId)}" />
      <div class="qr-mask" id="qrMask"><div class="qr-handle" id="qrHandle">⇅ drag — answer hidden below this line</div></div>
    </div>
    <div class="note" style="margin-top:6px">ID ${esc(q.extId)} · ${esc(q.skill)} · mask at <span id="qrPct">${Math.round(q.maskFraction * 100)}</span>%</div>`;
  positionMask(q.maskFraction);
  wireMaskDrag(q);
}

function positionMask(frac) {
  const m = $('qrMask'); if (m) m.style.top = (frac * 100) + '%';
  const p = $('qrPct'); if (p) p.textContent = Math.round(frac * 100);
}

function wireMaskDrag(q) {
  const frame = $('qrFrame'), handle = $('qrHandle');
  if (!frame || !handle) return;
  const move = (clientY) => {
    const r = frame.getBoundingClientRect();
    let frac = (clientY - r.top) / r.height;
    frac = Math.max(0, Math.min(1, frac));
    q.maskFraction = frac; positionMask(frac);
  };
  const onMove = (e) => { e.preventDefault(); move(e.touches ? e.touches[0].clientY : e.clientY); };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
    saveMask(q, false);
  };
  const onDown = (e) => {
    e.preventDefault();
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
  };
  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, { passive: false });
}

async function saveMask(q, approve) {
  try {
    await api('POST', `/api/admin/questions/${q.id}/mask`, { maskFraction: q.maskFraction, approve });
    if (approve) q.reviewed = true;
  } catch (e) { showToast(e.message); }
}

async function approveAndNext() {
  if (!QR.length) return;
  const q = QR[QRI];
  await saveMask(q, true);
  showToast('Approved ✓');
  if ($('qrReviewed').value === '0') { QR.splice(QRI, 1); $('qrCount').textContent = `${QR.length} question(s)`; renderReviewQ(); }
  else { QRI++; renderReviewQ(); }
}

$('qrSubject').addEventListener('change', populateReviewFilters);
$('qrTopic').addEventListener('change', populateReviewFilters);
$('qrApply').addEventListener('click', applyReviewFilter);
$('qrApprove').addEventListener('click', () => approveAndNext());
$('qrPrev').addEventListener('click', () => { QRI--; renderReviewQ(); });
$('qrNext').addEventListener('click', () => { QRI++; renderReviewQ(); });
$('qrClear').addEventListener('click', async () => {
  if (!confirm('Clear approval for all questions matching the current filter? They will return to the review queue.')) return;
  try {
    const r = await api('POST', '/api/admin/questions/clear-review', {
      subject: $('qrSubject').value, topic: $('qrTopic').value, difficulty: $('qrDiff').value, skill: $('qrSkill').value,
    });
    QR_ALL = (await api('GET', '/api/admin/questions')).questions;
    applyReviewFilter();
    showToast(`Cleared ${r.cleared} approval(s)`);
  } catch (e) { showToast(e.message); }
});
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

// ---- Bug Tracker ----
let _bugStatus = 'open';

function fmtBugDate(s) {
  if (!s) return '';
  const d = new Date(s + (s.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function loadBugs(status) {
  if (status !== undefined) _bugStatus = status;
  const list = document.getElementById('bugList');
  const total = document.getElementById('bugTotal');
  list.innerHTML = '<div class="spinner">Loading…</div>';
  const bugs = await api('GET', `/api/admin/bugs?status=${_bugStatus}`);
  total.textContent = `${bugs.length} bug${bugs.length !== 1 ? 's' : ''}`;

  if (!bugs.length) {
    list.innerHTML = `<p class="note" style="padding:16px 0">${_bugStatus === 'open' ? '🎉 No open bugs — you\'re all caught up!' : 'Nothing here yet.'}</p>`;
    return;
  }

  const rows = bugs.map((b) => `
    <tr class="bug-row bug-${b.status}">
      <td class="bug-who">
        <span class="bug-reporter">${esc(b.reporter_name || b.reporter_username)}</span>
        <span class="bug-date">${fmtBugDate(b.reported_at)}</span>
      </td>
      <td class="bug-page"><code>${esc(b.page || '—')}</code></td>
      <td class="bug-msg">${esc(b.message)}</td>
      <td class="bug-status">${b.status === 'open' ? '<span class="bug-badge open">🟡 Open</span>' : `<span class="bug-badge closed">✅ Closed</span><span class="bug-date">${b.closed_by_name ? 'by ' + esc(b.closed_by_name) : ''}</span>`}</td>
      <td class="bug-actions">
        ${b.status === 'open'
          ? `<button class="btn btn-primary btn-sm" data-bug-close="${b.id}">✓ Close</button>`
          : `<button class="btn btn-ghost btn-sm" data-bug-reopen="${b.id}">↺ Reopen</button>`}
      </td>
    </tr>`).join('');

  list.innerHTML = `<div style="overflow-x:auto"><table class="data bug-table">
    <thead><tr><th>Reporter</th><th>Screen</th><th>Description</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  list.querySelectorAll('[data-bug-close]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await api('POST', `/api/admin/bugs/${btn.dataset.bugClose}/close`);
      loadBugs();
    });
  });
  list.querySelectorAll('[data-bug-reopen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await api('POST', `/api/admin/bugs/${btn.dataset.bugReopen}/reopen`);
      loadBugs();
    });
  });
}

document.querySelectorAll('#bugTabs .subtab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#bugTabs .subtab').forEach((s) => s.classList.remove('active'));
    t.classList.add('active');
    loadBugs(t.dataset.status);
  });
});

// ---- init ----
(async function init() {
  initAddUserForm();
  try { await refreshUsers(); showView('users'); }
  catch (e) { document.querySelector('.container').innerHTML = `<div class="card"><p class="note">Could not load admin: ${esc(e.message)}</p></div>`; }
})();
