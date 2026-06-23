// Dashboard: charts + filterable, exportable attempts table.

let DATA = null;
let allAttempts = [];        // attempts (for trend charts)
let ACTIVITY = [];           // event feed for the Filtered List (incl. skips)
let DAILY = {};              // day -> daily activity entry
let SUMMARY = {};            // day -> daily summary

const PINK = '#ff4d94';
const PINK_LIGHT = '#ffb6d2';
const GREEN = '#2bb673';
const AMBER = '#f5a623';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(s) {
  if (!s) return '—';
  // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC)
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function load() {
  DATA = await api('GET', '/api/dashboard');
  allAttempts = DATA.attempts;
  ACTIVITY = DATA.activity || [];
  DAILY = {}; for (const d of (DATA.dailyActivity || [])) DAILY[d.day] = d;
  SUMMARY = {}; for (const s of (DATA.dailySummaries || [])) SUMMARY[s.day] = s;

  renderTiles();
  renderWeeklyReport();
  renderSkills();
  populateDomainFilter();
  populateSkillFilter();
  populateRoundFilter();
  renderCalendar();
  loadTasks();
  // Filtered List is manual — wait for Search rather than dumping everything.
  $('attemptsTable').querySelector('tbody').innerHTML =
    '<tr><td colspan="10" class="note">Set the filters and click 🔎 Search to see matching questions.</td></tr>';
  // Restore the last section the user was on (default to the charts overview).
  const saved = localStorage.getItem('dashView') || 'dashboard';
  const known = ['dashboard', 'calendar', 'weekly', 'skills', 'tasks'];
  showView(known.includes(saved) ? saved : 'dashboard');
}

// Switch which dashboard section is visible (charts render on show so they
// size correctly — Chart.js can't measure a hidden canvas).
function showView(name) {
  document.querySelectorAll('.dash-view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
  document.querySelectorAll('.dash-menu .menu-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  localStorage.setItem('dashView', name);
  if (name === 'dashboard') renderOverviewCharts();
  if (name === 'weekly') { renderWeeklyTrends(); renderSectionCharts(); }
  window.scrollTo(0, 0);
}

function populateRoundFilter() {
  const sel = $('fRound');
  if (!sel) return;
  const rounds = [...new Set(ACTIVITY.map((a) => a.round || 1))].sort((a, b) => a - b);
  sel.innerHTML = '<option value="">All</option>' + rounds.map((r) => `<option value="${r}">Round ${r}</option>`).join('');
}

// Domain (topic) options depend on the chosen Subject; Skill depends on Domain.
function populateDomainFilter() {
  const sel = $('fDomain');
  if (!sel) return;
  const subject = $('fSubject') ? $('fSubject').value : '';
  const rows = ACTIVITY.filter((a) => !subject || a.domain === subject);
  const topics = [...new Map(rows.map((a) => [a.topic, a.topicName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = '<option value="">All</option>' +
    topics.map(([t, name]) => `<option value="${escapeHtml(t)}">${escapeHtml(name)}</option>`).join('');
}

function populateSkillFilter() {
  const sel = $('fSkill');
  if (!sel) return;
  const subject = $('fSubject') ? $('fSubject').value : '';
  const domain  = $('fDomain') ? $('fDomain').value : '';
  const rows = ACTIVITY.filter((a) => (!subject || a.domain === subject) && (!domain || a.topic === domain));
  const skills = [...new Set(rows.map((a) => a.skill).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All</option>' +
    skills.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

// ---- Weekly trends + domain→skill drilldown -------------------------------
const SERIES_COLORS = ['#ff4d94', '#2f7dff', '#2bb673', '#f5a623', '#c084fc', '#fb923c', '#60a5fa', '#f87171'];

function weekLabel(weekStart) {
  if (!weekStart) return '';
  const d = new Date(weekStart + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pivotWeeks(rows) {
  const weeks = [];
  const seen = new Set();
  for (const r of rows) { if (!seen.has(r.week)) { seen.add(r.week); weeks.push({ week: r.week, start: r.week_start }); } }
  weeks.sort((a, b) => a.week.localeCompare(b.week));
  return weeks;
}

function lineChart(id, labels, datasets, opts) {
  makeChart(id, {
    type: 'line',
    data: { labels, datasets: datasets.map((d, i) => ({
      label: d.label, data: d.data, borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
      backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] + '33', tension: 0.3, spanGaps: true, fill: false,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ...(opts && opts.y) } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
    },
  });
}

function renderWeeklyTrends() {
  const dom = DATA.weeklyByDomain || [];
  const weeks = pivotWeeks(dom);
  const labels = weeks.map((w) => weekLabel(w.start));
  const acc = (correct, attempts) => (attempts ? Math.round((correct / attempts) * 100) : null);

  // Domain-level
  const domains = [['math', '🔢 Math'], ['reading', '📖 Reading']];
  const accSets = domains.map(([d, lbl]) => ({ label: lbl, data: weeks.map((w) => {
    const r = dom.find((x) => x.week === w.week && x.domain === d); return r ? acc(r.correct, r.attempts) : null;
  }) }));
  const timeSets = domains.map(([d, lbl]) => ({ label: lbl, data: weeks.map((w) => {
    const r = dom.find((x) => x.week === w.week && x.domain === d); return r ? Math.round(r.avg_time) : null;
  }) }));
  lineChart('wkDomainAcc', labels, accSets, { y: { max: 100, ticks: { callback: (v) => v + '%' } } });
  lineChart('wkDomainTime', labels, timeSets, { y: { ticks: { callback: (v) => v + 's' } } });

  renderSkillTrends();
}

function renderSkillTrends() {
  const dsel = $('trendDomain') ? $('trendDomain').value : 'math';
  const rows = (DATA.weeklyBySkill || []).filter((r) => r.domain === dsel);
  const weeks = pivotWeeks(rows);
  const labels = weeks.map((w) => weekLabel(w.start));
  // top skills by total attempts
  const totals = {};
  for (const r of rows) { const k = `${r.skill} (${r.difficulty})`; totals[k] = (totals[k] || 0) + r.attempts; }
  const skills = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 8);
  const acc = (c, n) => (n ? Math.round((c / n) * 100) : null);
  const accSets = skills.map((k) => ({ label: k, data: weeks.map((w) => {
    const r = rows.find((x) => x.week === w.week && `${x.skill} (${x.difficulty})` === k); return r ? acc(r.correct, r.attempts) : null;
  }) }));
  const timeSets = skills.map((k) => ({ label: k, data: weeks.map((w) => {
    const r = rows.find((x) => x.week === w.week && `${x.skill} (${x.difficulty})` === k); return r ? Math.round(r.avg_time) : null;
  }) }));
  const dlabel = dsel === 'math' ? 'Math' : 'Reading';
  $('wkSkillAccH').textContent = `Accuracy by skill — ${dlabel}`;
  $('wkSkillTimeH').textContent = `Avg time by skill — ${dlabel}`;
  if (!skills.length) {
    ['wkSkillAcc', 'wkSkillTime'].forEach((id) => { if (charts[id]) charts[id].destroy(); });
    return;
  }
  lineChart('wkSkillAcc', labels, accSets, { y: { max: 100, ticks: { callback: (v) => v + '%' } } });
  lineChart('wkSkillTime', labels, timeSets, { y: { ticks: { callback: (v) => v + 's' } } });
}

let weeklyIndex = 0;  // 0 = latest week (reports are sorted newest-first)
function renderWeeklyReport() {
  const reps = DATA.weeklyReports || [];
  const el = $('weeklyReport');
  if (!reps.length) { el.innerHTML = '<p class="note">Practice a few questions and your first weekly report will appear here. 🌱</p>'; return; }
  weeklyIndex = Math.max(0, Math.min(weeklyIndex, reps.length - 1));
  const r = reps[weeklyIndex];
  const items = (arr, fmt) => arr.map((s) => `<li>${fmt(s)}</li>`).join('');
  const totalA = r.domains.reduce((x, d) => x + d.attempts, 0);
  const totalC = r.domains.reduce((x, d) => x + d.correct, 0);
  const overall = totalA ? Math.round((totalC / totalA) * 100) : 0;
  const domLis = r.domains.map((d) => {
    const acc = d.attempts ? Math.round((d.correct / d.attempts) * 100) : 0;
    const name = d.domain === 'math' ? '🔢 Math' : '📖 Reading';
    return `<li><b>${name}:</b> ${d.attempts} questions · ${acc}% accuracy · ~${Math.round(d.avg_time)}s per question</li>`;
  }).join('');

  const nav = `<div class="cal-toolbar">
      <button class="cal-nav" id="wkOlder" ${weeklyIndex >= reps.length - 1 ? 'disabled' : ''}>◀ Older</button>
      <div class="cal-week-label">Week of ${escapeHtml(weekLabel(r.weekStart))}${weeklyIndex === 0 ? ' · latest' : ''} <span class="note">(${weeklyIndex + 1}/${reps.length})</span></div>
      <button class="cal-nav" id="wkNewer" ${weeklyIndex <= 0 ? 'disabled' : ''}>Newer ▶</button>
    </div>`;

  el.innerHTML = nav + `<div class="report-week latest">
      <ul class="report-list">
        <li><b>Overall:</b> ${totalA} questions answered at <b>${overall}%</b> accuracy.</li>
        ${domLis}
        ${r.strengths.length ? `<li>💪 <b>Strengths — keep it up:</b><ul>${items(r.strengths, (s) => `${escapeHtml(s.label)} — <b>${s.acc}%</b>`)}</ul></li>` : ''}
        ${r.focus.length ? `<li>🎯 <b>Work on these:</b><ul>${items(r.focus, (s) => `${escapeHtml(s.label)} — <b>${s.acc}%</b> · do ~10 questions and review explanations to push past 70%`)}</ul></li>` : ''}
        ${(r.slow && r.slow.length) ? `<li>⏱️ <b>Slowest — practice for speed:</b><ul>${items(r.slow, (s) => `${escapeHtml(s.label)} — ~${Math.round(s.avg)}s per question`)}</ul></li>` : ''}
      </ul>
    </div>`;
  const older = $('wkOlder'), newer = $('wkNewer');
  if (older) older.onclick = () => { weeklyIndex++; renderWeeklyReport(); };
  if (newer) newer.onclick = () => { weeklyIndex--; renderWeeklyReport(); };
}

// ---- Tasks / focus plan ----------------------------------------------------
async function loadTasks() {
  try {
    const { tasks } = await api('GET', '/api/tasks');
    renderTasks(tasks);
  } catch (_) { /* ignore */ }
}

// The round a task belongs to = the current round of its section (from the
// catalogue). Custom tasks with no section go under "Custom".
function taskRoundLabel(t) {
  if (!t.domain || !t.topic || !t.difficulty) return 'Custom';
  const c = (DATA.catalogue || []).find((x) => x.domain === t.domain && x.topic === t.topic && x.difficulty === t.difficulty);
  return c ? `Round ${c.round}` : 'Custom';
}

function renderTasks(tasks) {
  const el = $('taskList');
  if (!tasks.length) {
    el.innerHTML = '<p class="note">No focus tasks yet. Click “Build my plan” to turn your weak skills into a checklist. ✨</p>';
    return;
  }
  const groups = {};
  for (const t of tasks) { const k = taskRoundLabel(t); (groups[k] = groups[k] || []).push(t); }
  const keys = Object.keys(groups).sort((a, b) => {
    const na = a.startsWith('Round') ? parseInt(a.slice(6), 10) : Infinity;
    const nb = b.startsWith('Round') ? parseInt(b.slice(6), 10) : Infinity;
    return na - nb;
  });
  el.innerHTML = keys.map((key) => {
    const rows = groups[key].map((t) => {
      const done = t.status === 'done';
      return `<div class="task-item ${done ? 'done' : ''}">
        <label><input type="checkbox" data-task="${t.id}" ${done ? 'checked' : ''}/>
          <span><b>${escapeHtml(t.title)}</b>${t.detail ? `<br><span class="note">${escapeHtml(t.detail)}</span>` : ''}</span></label>
        <span style="margin-left:auto"><button class="task-del" data-del="${t.id}" title="Delete">✕</button></span>
      </div>`;
    }).join('');
    return `<div class="task-group"><h3 class="mini-h task-group-h">${escapeHtml(key)}</h3>${rows}</div>`;
  }).join('');
}

async function toggleTask(id, done) {
  await api('POST', `/api/tasks/${id}`, { status: done ? 'done' : 'open' });
  loadTasks();
}
async function deleteTask(id) { await api('DELETE', `/api/tasks/${id}`); loadTasks(); }
async function generatePlan() {
  const r = await api('POST', '/api/plan/generate');
  showToast(r.created.length ? `Added ${r.created.length} focus task(s) 🎯` : 'No new weak skills to add yet — great!');
  loadTasks();
}

// ---- Study calendar — a record of what happened each day ------------------
// Local YYYY-MM-DD (avoids UTC off-by-one from toISOString).
function localYmd(d) { return d.toLocaleDateString('en-CA'); }
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localYmd(d);
}
function accClassOf(acc) { return acc >= 80 ? 'ok' : acc >= 60 ? 'mid' : 'low'; }

// The currently-viewed week (Monday). Defaults to this week; arrows move it.
let calWeekMonday = mondayOf(localYmd(new Date()));

// Tiny per-status dots for a day cell.
function dayStatusDots(c) {
  const dot = (n, cls, emoji) => (n ? `<span class="csd ${cls}" title="${emoji} ${n}">${emoji}${n}</span>` : '');
  return `<div class="cal-day-dots">${dot(c.correct, 'ok', '✅')}${dot(c.wrong, 'bad', '❌')}${dot(c.peeked, '', '👀')}${dot(c.timedout, '', '⏰')}${dot(c.skipped, 'warn', '⏭')}</div>`;
}

function showCalDay(day) {
  const panel = $('calDayPanel');
  const entry = DAILY[day];
  const summary = SUMMARY[day];
  const human = new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  let html = `<div class="cal-panel-head">
      <button class="cal-nav" id="calDayPrev" title="Previous day">◀</button>
      <b>${escapeHtml(human)}</b>
      <button class="cal-nav" id="calDayNext" title="Next day">▶</button>
      <button class="task-del" id="calPanelClose" title="Close" style="margin-left:auto">✕</button>
    </div>`;

  if (!entry || entry.total === 0) {
    html += `<p class="note">Nothing recorded on this day. Use ◀ ▶ to look at other days.</p>`;
  } else {
    const c = entry.counts;
    const tags = (entry.tags || ['practice']).map((t) => `<span class="cal-badge ${t === 'full test' ? 'test' : 'practice'}">${t === 'full test' ? '📝 Full test' : '📚 Practice'}</span>`).join(' ');
    html += `<div class="cal-sub">${tags} · ${entry.total} question${entry.total === 1 ? '' : 's'}</div>`;
    if (summary) html += `<p style="margin:6px 0 10px">${escapeHtml(summary.text)}</p>`;
    html += `<div class="ds-chips" style="margin-bottom:10px">
      <span class="ds-chip ok">✅ ${c.correct} correct</span>
      <span class="ds-chip bad">❌ ${c.wrong} wrong</span>
      <span class="ds-chip">👀 ${c.peeked} peeked</span>
      <span class="ds-chip">⏰ ${c.timedout} over time</span>
      <span class="ds-chip warn">⏭ ${c.skipped} skipped</span>
    </div>`;

    html += `<div class="cal-sub">📝 Practices on this day</div>`;
    html += (entry.practices || []).map((p) => {
      const emoji = p.domain === 'math' ? '🔢' : '📖';
      const resolved = p.correct + p.wrong + p.peeked + p.timedout;
      const acc = resolved ? Math.round((p.correct / resolved) * 100) : 0;
      return `<div class="cal-attempt">
        <span>${emoji} <b>${escapeHtml(p.topicName)}</b> <span class="note">${p.difficulty} · Round ${p.round}</span>
          · ${p.events} action${p.events === 1 ? '' : 's'} · ${acc}% on resolved</span>
        <a class="btn btn-ghost" href="/session.html?id=${p.sessionId}">Review →</a>
      </div>`;
    }).join('');
  }

  panel.innerHTML = html;
  panel.classList.remove('hidden');
  $('calPanelClose').onclick = () => panel.classList.add('hidden');
  // Day navigation keeps the week grid below in sync with the day on display.
  const step = (n) => {
    const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n);
    const nd = localYmd(d);
    calWeekMonday = mondayOf(nd);
    renderCalendar();
    showCalDay(nd);
  };
  $('calDayPrev').onclick = () => step(-1);
  $('calDayNext').onclick = () => step(1);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderCalendar() {
  const cal = $('calendar');
  const todayStr = localYmd(new Date());
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const monday = new Date(calWeekMonday + 'T00:00:00');
  const isThisWeek = mondayOf(todayStr) === calWeekMonday;

  let html = `<div class="cal-toolbar">
      <button class="cal-nav" id="calPrev" title="Previous week">◀ Prev</button>
      <div class="cal-week-label">Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${isThisWeek ? ' · this week' : ''}</div>
      <button class="cal-nav" id="calNext" title="Next week">Next ▶</button>
      <button class="cal-nav" id="calToday" title="Jump to this week">Today</button>
    </div>`;

  html += `<div class="cal-week ${isThisWeek ? 'current' : ''}"><div class="cal-days">`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const ds = localYmd(d);
    const isToday = ds === todayStr;
    const entry = DAILY[ds];
    const hasAct = entry && entry.total > 0;
    const badge = hasAct ? `${(entry.practices || []).length || ''} ${(entry.practices || []).length === 1 ? 'practice' : 'practices'} ›`.trim() : '';
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${hasAct ? 'did has-attempts' : ''}" ${hasAct ? `data-date="${ds}"` : ''}>
      <span class="cal-dn">${dayNames[i]} ${d.getDate()}</span>
      ${hasAct ? dayStatusDots(entry.counts) : '<span class="cal-plan note">—</span>'}
      ${badge ? `<span class="cal-att-badge">${badge}</span>` : ''}
    </div>`;
  }
  html += `</div></div>`;
  cal.innerHTML = html;

  $('calPrev').onclick = () => { const m = new Date(calWeekMonday + 'T00:00:00'); m.setDate(m.getDate() - 7); calWeekMonday = localYmd(m); renderCalendar(); };
  $('calNext').onclick = () => { const m = new Date(calWeekMonday + 'T00:00:00'); m.setDate(m.getDate() + 7); calWeekMonday = localYmd(m); renderCalendar(); };
  $('calToday').onclick = () => { calWeekMonday = mondayOf(localYmd(new Date())); renderCalendar(); };
}

function accClass(acc) {
  if (acc >= 80) return 'acc-good';
  if (acc >= 60) return 'acc-ok';
  return 'acc-low';
}

function renderSkills() {
  // Grand current state: each question's latest result across all rounds.
  const rows = DATA.skillFocus || [];
  const tbody = $('skillsTable').querySelector('tbody');
  const highlight = $('skillHighlight');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="note">No skills resolved yet. Once she answers questions, her current per-skill breakdown shows here.</td></tr>';
    highlight.innerHTML = '';
    return;
  }
  // Highlight the weakest skill with enough resolved to be meaningful.
  const weak = rows.filter((r) => r.resolved >= 2)[0] || rows[0];
  highlight.innerHTML = `<div class="skill-focus">
      <span class="skill-focus-emoji">💡</span>
      <div><b>Top area to work on:</b> ${escapeHtml(weak.skill)}
      <span class="note">(currently ${weak.accuracy}% over ${weak.resolved} question${weak.resolved === 1 ? '' : 's'} · ${escapeHtml(weak.topicName)} · ${weak.difficulty})</span></div>
    </div>`;

  tbody.innerHTML = rows.map((r) => {
    const domainEmoji = r.domain === 'math' ? '🔢' : '📖';
    return `<tr class="skill-row" data-skill="${escapeHtml(r.skill)}" title="Filter the list by this skill">
      <td><b>${escapeHtml(r.skill)}</b></td>
      <td>${domainEmoji} ${escapeHtml(r.topicName)}</td>
      <td>${r.difficulty === 'hard' ? '🔴' : '🟡'} ${r.difficulty}</td>
      <td><div class="acc-bar"><span class="${accClass(r.accuracy)}" style="width:${r.accuracy}%"></span><em>${r.accuracy}%</em></div></td>
      <td>${r.correct}</td>
      <td>${r.wrong + (r.peeked || 0) + (r.timedout || 0)}</td>
      <td>${r.resolved}</td>
      <td>${fmtTime(r.avgTime)}</td>
    </tr>`;
  }).join('');
}

function renderTiles() {
  const o = DATA.overall;
  const cat = DATA.catalogue || [];
  const mathTotal    = cat.filter(c => c.domain === 'math').reduce((s,c) => s + c.total, 0);
  const mathMastered = cat.filter(c => c.domain === 'math').reduce((s,c) => s + c.mastered, 0);
  const readTotal    = cat.filter(c => c.domain === 'reading').reduce((s,c) => s + c.total, 0);
  const readMastered = cat.filter(c => c.domain === 'reading').reduce((s,c) => s + c.mastered, 0);
  const tiles = [
    { num: o.attempts, lbl: 'Total attempts' },
    { num: o.correct, lbl: 'Correct' },
    { num: o.accuracy + '%', lbl: 'Overall accuracy' },
    { num: fmtTime(o.avgTime), lbl: 'Avg time / question' },
    { num: `${mathMastered}/${mathTotal}`, lbl: '🔢 Math mastered' },
    { num: `${readMastered}/${readTotal}`, lbl: '📖 Reading mastered' },
  ];
  $('statTiles').innerHTML = tiles.map((t) =>
    `<div class="stat"><div class="num">${t.num}</div><div class="lbl">${t.lbl}</div></div>`).join('');
}

let charts = {};
function makeChart(id, config) {
  if (typeof Chart === 'undefined') {
    const c = $(id);
    if (c && c.parentElement) c.parentElement.innerHTML = '<p class="note">Charts need an internet connection to load. Your data and table below still work offline.</p>';
    return;
  }
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), config);
}

function renderOverviewCharts() {
  // Daily activity (stacked bar)
  const days = DATA.byDay;
  makeChart('dailyChart', {
    type: 'bar',
    data: {
      labels: days.map((d) => d.day),
      datasets: [
        { label: 'Correct', data: days.map((d) => d.correct), backgroundColor: GREEN, borderRadius: 6 },
        { label: 'Wrong', data: days.map((d) => d.wrong), backgroundColor: PINK_LIGHT, borderRadius: 6 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: 'bottom' } },
    },
  });

  // Overall accuracy doughnut
  const o = DATA.overall;
  makeChart('accuracyChart', {
    type: 'doughnut',
    data: {
      labels: ['Correct', 'Wrong'],
      datasets: [{ data: [o.correct, o.wrong], backgroundColor: [GREEN, PINK] }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  });
}

function renderSectionCharts() {
  // Accuracy by topic (bar)
  const bt = DATA.byTopic || [];
  const topicLabels = bt.map(t => {
    const name = t.topic.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    return `${name} (${t.difficulty})`;
  });
  const colors = bt.map((_, i) => [PINK, PINK_LIGHT, AMBER, '#c084fc', '#60a5fa', '#34d399', '#fb923c', '#f87171'][i % 8]);
  makeChart('sectionChart', {
    type: 'bar',
    data: {
      labels: topicLabels,
      datasets: [{
        label: 'Accuracy %',
        data: bt.map(t => t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0),
        backgroundColor: colors, borderRadius: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { legend: { display: false } },
    },
  });

  // Avg time by topic (bar)
  makeChart('timeChart', {
    type: 'bar',
    data: {
      labels: topicLabels,
      datasets: [{
        label: 'Avg seconds',
        data: bt.map(t => Math.round(t.avg_time)),
        backgroundColor: colors, borderRadius: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      scales: { x: { beginAtZero: true, ticks: { callback: v => v + 's' } } },
      plugins: { legend: { display: false } },
    },
  });
}

function fmtTopic(t) {
  return t.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}
function renderSessions() {
  const tbody = $('sessionsTable').querySelector('tbody');
  if (!DATA.sessions.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="note">No sessions yet. Start practicing from the Home page!</td></tr>';
    return;
  }
  tbody.innerHTML = DATA.sessions.map((s) => {
    const domainEmoji = s.domain === 'math' ? '🔢' : '📖';
    const status = s.status === 'completed'
      ? '<span class="pill correct">completed</span>'
      : '<span class="pill wrong">in progress</span>';
    const score = s.status === 'completed' ? `${s.score} / ${s.total}` : '—';
    const resume = s.status === 'in_progress'
      ? `<a href="/session.html?id=${s.id}">▶ resume</a>`
      : `${s.answered}/${s.total}`;
    return `<tr>
      <td>${s.id}</td>
      <td>${domainEmoji} ${fmtTopic(s.topic)}</td>
      <td>${s.difficulty === 'hard' ? '🔴' : '🟡'} ${s.difficulty}</td>
      <td>${status}</td>
      <td>${fmtDate(s.created_at)}</td>
      <td>${fmtDate(s.completed_at)}</td>
      <td>${score}</td>
      <td>${resume}</td>
    </tr>`;
  }).join('');
}

const STATUS_PILL = {
  correct:  '<span class="pill correct">✅ correct</span>',
  wrong:    '<span class="pill wrong">❌ wrong</span>',
  peeked:   '<span class="pill peeked">👀 peeked</span>',
  timedout: '<span class="pill peeked">⏰ over time</span>',
  skipped:  '<span class="pill skipped">⏭ skipped</span>',
};

function getFilteredActivity() {
  const subject = $('fSubject') ? $('fSubject').value : '';
  const domain  = $('fDomain') ? $('fDomain').value : '';
  const skill   = $('fSkill') ? $('fSkill').value : '';
  const round   = $('fRound') ? $('fRound').value : '';
  const diff    = $('fDifficulty') ? $('fDifficulty').value : '';
  const status  = $('fStatus') ? $('fStatus').value : '';
  const search  = $('fSearch').value.trim().toLowerCase();
  return ACTIVITY.filter((a) => {
    if (subject && a.domain !== subject) return false;
    if (domain  && a.topic !== domain) return false;
    if (skill   && a.skill !== skill) return false;
    if (round   && String(a.round) !== round) return false;
    if (diff    && a.difficulty !== diff) return false;
    if (status  && a.status !== status) return false;
    if (search  && !(a.prompt || '').toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderAttempts() {
  const rows = getFilteredActivity();
  $('rowCount').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
  const tbody = $('attemptsTable').querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="note">No activity matches your filters.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((a) => {
    const domainEmoji = a.domain === 'math' ? '🔢' : '📖';
    const pill = STATUS_PILL[a.status] || a.status;
    return `<tr>
      <td>${fmtDate(a.occurredAt)}</td>
      <td>R${a.round || 1}</td>
      <td>${domainEmoji} ${escapeHtml(a.topicName)}</td>
      <td>${escapeHtml(a.skill || '—')}</td>
      <td>${a.difficulty === 'hard' ? '🔴' : '🟡'} ${a.difficulty}</td>
      <td><button class="link-cell" data-question="${a.questionId}" title="View this question, her answer, and the solution">${escapeHtml(a.prompt)}${(a.prompt || '').length >= 90 ? '…' : ''} 🔎</button></td>
      <td>${escapeHtml(a.selected || '—')}</td>
      <td>${escapeHtml(a.correct)}</td>
      <td>${pill}</td>
      <td>${fmtTime(a.timeTaken)}</td>
    </tr>`;
  }).join('');
}

// ---- Question review modal -------------------------------------------------
async function openReview(questionId) {
  const modal = $('reviewModal');
  const body = $('reviewBody');
  body.innerHTML = '<div class="spinner">Loading…</div>';
  modal.classList.remove('hidden');
  $('reviewCardEl').classList.add('expanded');   // full-screen layout by default
  document.body.style.overflow = 'hidden';
  try {
    const r = await api('GET', `/api/questions/${questionId}/review`);
    renderReview(r);
  } catch (e) {
    body.innerHTML = `<p class="note">Could not load this question: ${escapeHtml(e.message)}</p>`;
  }
}

function closeReview() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  $('reviewCardEl').classList.remove('expanded');
  $('reviewModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ----- Review zoom + full screen (mirrors the practice page) -----
let rvZoom = 1;
const RV_MIN = 1, RV_MAX = 3, RV_STEP = 0.25;
function applyReviewZoom() {
  const wrap = $('rvImgWrap');
  rvZoom = Math.max(RV_MIN, Math.min(RV_MAX, rvZoom));
  if (wrap) wrap.style.width = (rvZoom * 100) + '%';
  $('rvZoomLevel').textContent = Math.round(rvZoom * 100) + '%';
  $('rvZoomOut').disabled = rvZoom <= RV_MIN;
  $('rvZoomIn').disabled = rvZoom >= RV_MAX;
}
function reviewFullscreen() {
  const card = $('reviewCardEl');
  if (!document.fullscreenElement) {
    card.requestFullscreen?.();
    card.classList.add('expanded');
    $('rvFull').textContent = '🡼 Exit full screen';
  } else {
    document.exitFullscreen?.();
  }
}

function renderReview(r) {
  const domainEmoji = r.domain === 'math' ? '🔢' : '📖';
  const topicName = fmtTopic(r.topic);
  const resultPill = r.isCorrect
    ? '<span class="pill correct">✓ You got this right</span>'
    : '<span class="pill wrong">✗ You missed this one</span>';

  const skillLine = r.skill ? `<div class="note" style="margin-top:2px">🎯 ${escapeHtml(r.skill)}</div>` : '';
  let html = `<div class="review-head">
      <div>
        <h2 style="margin:0">${domainEmoji} ${topicName} <span class="note">· ${r.difficulty}</span></h2>
        ${skillLine}
      </div>
      ${resultPill}
    </div>`;

  if (r.image) {
    // The full, unmasked page already shows the question AND the rationale.
    html += `<div class="review-imgframe" id="rvImgFrame"><div class="review-imgwrap" id="rvImgWrap">`;
    html += `<img class="review-img" src="${r.image}" alt="Question" />`;
    if (r.answerImage) html += `<img class="review-img" src="${r.answerImage}" alt="Answer continued" />`;
    html += `</div></div>`;
    html += `<div class="ans-row">
        <span class="tag-wrong">Your answer: ${escapeHtml(r.selected || '(no answer)')}</span>
        <span class="tag-right">Correct answer: ${escapeHtml(r.correct)}</span>
      </div>
      <p class="note">☝️ The full worked solution and rationale are shown on the page above.</p>`;
  } else {
    if (r.passage) html += `<div class="passage">${escapeHtml(r.passage)}</div>`;
    html += `<div class="prompt" style="font-size:1.1rem; font-weight:700; margin:8px 0">${escapeHtml(r.prompt)}</div>`;
    if (r.choices && r.choices.length) {
      html += '<div class="review-choices">';
      for (const c of r.choices) {
        const isCorrect = c.label === r.correct;
        const isYours = c.label === r.selected;
        let cls = 'review-choice';
        if (isCorrect) cls += ' is-correct';
        else if (isYours) cls += ' is-yours';
        const tags = `${isCorrect ? ' ✓ correct' : ''}${isYours && !isCorrect ? ' ← your answer' : ''}${isYours && isCorrect ? ' ← your answer' : ''}`;
        html += `<div class="${cls}"><b>${c.label}.</b> ${escapeHtml(c.text || '')}<span class="choice-tag">${tags}</span></div>`;
      }
      html += '</div>';
    } else {
      html += `<div class="ans-row">
          <span class="tag-wrong">Your answer: ${escapeHtml(r.selected || '(no answer)')}</span>
          <span class="tag-right">Correct answer: ${escapeHtml(r.correct)}</span>
        </div>`;
    }
    if (r.explanation) html += `<div class="explanation"><b>Why:</b> ${escapeHtml(r.explanation)}</div>`;
  }

  $('reviewBody').innerHTML = html;
  // Zoom/full-screen controls apply only to the image (PDF page) review.
  $('reviewToolbar').classList.toggle('hidden', !r.image);
  rvZoom = 1;
  applyReviewZoom();
}

function exportCsv() {
  const rows = getFilteredActivity();
  const header = ['Date', 'Round', 'Domain', 'Topic', 'Skill', 'Difficulty', 'Question', 'HerAnswer', 'Correct', 'Status', 'TimeSeconds'];
  const lines = [header.join(',')];
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  for (const a of rows) {
    const cells = [
      a.occurredAt,
      a.round || 1,
      a.domain,
      q(a.topicName),
      q(a.skill || ''),
      a.difficulty,
      q(a.prompt),
      q(a.selected || ''),
      q(a.correct),
      a.status,
      a.timeTaken,
    ];
    lines.push(cells.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sat-activity.csv';
  link.click();
  URL.revokeObjectURL(url);
}

// The Filtered List is manual: dependent dropdowns update on change, but the
// table only re-runs when Search (or a quick skill click) is pressed.
$('fSubject').addEventListener('change', () => { populateDomainFilter(); populateSkillFilter(); });
$('fDomain').addEventListener('change', populateSkillFilter);
$('fSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderAttempts(); });
$('searchBtn').addEventListener('click', renderAttempts);
$('clearBtn').addEventListener('click', () => {
  ['fSubject', 'fDomain', 'fSkill', 'fRound', 'fDifficulty', 'fStatus'].forEach((id) => { if ($(id)) $(id).value = ''; });
  $('fSearch').value = '';
  populateDomainFilter(); populateSkillFilter();
  renderAttempts();
});
$('exportBtn').addEventListener('click', exportCsv);

// Top menu: switch views
document.querySelectorAll('.dash-menu .menu-btn[data-view]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.view));
});

// Click a skill row -> filter the list below to that skill (clears other filters)
$('skillsTable').addEventListener('click', (e) => {
  const row = e.target.closest('.skill-row');
  if (!row) return;
  ['fSubject', 'fDomain', 'fRound', 'fDifficulty', 'fStatus'].forEach((id) => { if ($(id)) $(id).value = ''; });
  $('fSearch').value = '';
  populateDomainFilter(); populateSkillFilter();
  const sel = $('fSkill');
  if (sel) { sel.value = row.dataset.skill; renderAttempts(); }
  $('attemptsTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Click a question in the list -> open the review modal
$('attemptsTable').addEventListener('click', (e) => {
  const btn = e.target.closest('.link-cell');
  if (btn) openReview(Number(btn.dataset.question));
});
// Calendar: click a day with activity to see that day's practices + summary
$('calendar').addEventListener('click', (e) => {
  const day = e.target.closest('.cal-day.has-attempts');
  if (day) showCalDay(day.dataset.date);
});

// Weekly-trends drilldown
if ($('trendDomain')) $('trendDomain').addEventListener('change', renderSkillTrends);
// Tasks
$('genPlanBtn').addEventListener('click', () => generatePlan().catch((e) => showToast(e.message)));
$('addTaskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('taskTitle').value.trim();
  if (!title) return;
  await api('POST', '/api/tasks', { title });
  $('taskTitle').value = '';
  loadTasks();
});
$('taskList').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-task]');
  if (cb) toggleTask(Number(cb.dataset.task), cb.checked);
});
$('taskList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) deleteTask(Number(del.dataset.del));
});

$('reviewClose').addEventListener('click', closeReview);
$('reviewModal').addEventListener('click', (e) => { if (e.target === $('reviewModal')) closeReview(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.fullscreenElement) closeReview(); });

// Review zoom + full-screen controls
$('rvZoomIn').addEventListener('click', () => { rvZoom += RV_STEP; applyReviewZoom(); });
$('rvZoomOut').addEventListener('click', () => { rvZoom -= RV_STEP; applyReviewZoom(); });
$('rvZoomFit').addEventListener('click', () => { rvZoom = 1; applyReviewZoom(); });
$('rvFull').addEventListener('click', reviewFullscreen);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    $('reviewCardEl').classList.remove('expanded');
    $('rvFull').textContent = '⛶ Full screen';
  }
});

load().catch((e) => {
  $('statTiles').innerHTML = `<p class="note">Could not load dashboard: ${e.message}</p>`;
});
