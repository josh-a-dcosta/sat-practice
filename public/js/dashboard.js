// Dashboard: charts + filterable, exportable attempts table.

let DATA = null;
let allAttempts = [];

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

  // goal banner
  const t = DATA.today;
  const pct = Math.min(100, Math.round((t.answeredToday / t.goal) * 100));
  $('goalFill').style.width = pct + '%';
  $('goalCount').textContent = `🔢 ${t.mathToday}/${t.goalPerDomain} · 📖 ${t.readingToday}/${t.goalPerDomain}`;
  $('goalSub').textContent = t.met
    ? '🎉 Both goals reached — 40 Math + 40 Reading done!'
    : `Goal: 40 Math + 40 Reading. Left — 🔢 ${Math.max(0, t.goalPerDomain - t.mathToday)} math, 📖 ${Math.max(0, t.goalPerDomain - t.readingToday)} reading.`;

  renderTiles();
  renderWeeklyReport();
  renderSkills();
  populateSkillFilter();
  populateDateFilter();
  renderSessions();
  renderAttempts();
  renderCalendar();
  loadTasks();
  showView(localStorage.getItem('dashView') || 'dashboard');
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

function populateDateFilter() {
  const sel = $('fDate');
  if (!sel) return;
  const dates = [...new Set(allAttempts.map((a) => a.answered_at.slice(0, 10)))].sort().reverse();
  sel.innerHTML = '<option value="">All dates</option>' + dates.map((d) => `<option value="${d}">${d}</option>`).join('');
  if (dates.length) sel.value = dates[0]; // default to the most recent day
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

function renderWeeklyReport() {
  const reps = DATA.weeklyReports || [];
  const el = $('weeklyReport');
  if (!reps.length) { el.innerHTML = '<p class="note">Practice a few questions and your first weekly report will appear here. 🌱</p>'; return; }
  const items = (arr, fmt) => arr.map((s) => `<li>${fmt(s)}</li>`).join('');
  el.innerHTML = reps.map((r, i) => {
    const totalA = r.domains.reduce((x, d) => x + d.attempts, 0);
    const totalC = r.domains.reduce((x, d) => x + d.correct, 0);
    const overall = totalA ? Math.round((totalC / totalA) * 100) : 0;
    const domLis = r.domains.map((d) => {
      const acc = d.attempts ? Math.round((d.correct / d.attempts) * 100) : 0;
      const name = d.domain === 'math' ? '🔢 Math' : '📖 Reading';
      return `<li><b>${name}:</b> ${d.attempts} questions · ${acc}% accuracy · ~${Math.round(d.avg_time)}s per question</li>`;
    }).join('');
    return `<div class="report-week ${i === 0 ? 'latest' : ''}">
      <div class="report-head"><b>Week of ${escapeHtml(weekLabel(r.weekStart))}</b>${i === 0 ? ' <span class="rep-chip latest-tag">latest</span>' : ''}</div>
      <ul class="report-list">
        <li><b>Overall:</b> ${totalA} questions answered at <b>${overall}%</b> accuracy.</li>
        ${domLis}
        ${r.strengths.length ? `<li>💪 <b>Strengths — keep it up:</b><ul>${items(r.strengths, (s) => `${escapeHtml(s.label)} — <b>${s.acc}%</b>`)}</ul></li>` : ''}
        ${r.focus.length ? `<li>🎯 <b>Work on these:</b><ul>${items(r.focus, (s) => `${escapeHtml(s.label)} — <b>${s.acc}%</b> · do ~10 questions and review explanations to push past 70%`)}</ul></li>` : ''}
        ${(r.slow && r.slow.length) ? `<li>⏱️ <b>Slowest — practice for speed:</b><ul>${items(r.slow, (s) => `${escapeHtml(s.label)} — ~${Math.round(s.avg)}s per question`)}</ul></li>` : ''}
      </ul>
    </div>`;
  }).join('');
}

// ---- Tasks / focus plan ----------------------------------------------------
async function loadTasks() {
  try {
    const { tasks } = await api('GET', '/api/tasks');
    renderTasks(tasks);
  } catch (_) { /* ignore */ }
}

function renderTasks(tasks) {
  const el = $('taskList');
  if (!tasks.length) {
    el.innerHTML = '<p class="note">No focus tasks yet. Click “Build my plan” to turn your weak skills into a checklist. ✨</p>';
    return;
  }
  el.innerHTML = tasks.map((t) => {
    const done = t.status === 'done';
    const due = t.due_date ? `<span class="task-due">📅 ${escapeHtml(t.due_date)}</span>` : '';
    return `<div class="task-item ${done ? 'done' : ''}">
      <label><input type="checkbox" data-task="${t.id}" ${done ? 'checked' : ''}/>
        <span><b>${escapeHtml(t.title)}</b>${t.detail ? `<br><span class="note">${escapeHtml(t.detail)}</span>` : ''}</span></label>
      <span style="margin-left:auto; display:flex; gap:10px; align-items:center">${due}
        <button class="task-del" data-del="${t.id}" title="Delete">✕</button></span>
    </div>`;
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

// ---- Study calendar (countdown to Aug 22) ---------------------------------
// completed sessions grouped by the day they were finished
function sessionsByDay() {
  const map = {};
  for (const s of (DATA.sessions || [])) {
    if (s.status !== 'completed' || !s.completed_at) continue;
    const day = s.completed_at.slice(0, 10);
    (map[day] = map[day] || []).push(s);
  }
  return map;
}

function showCalDay(day) {
  const panel = $('calDayPanel');
  const list = (sessionsByDay()[day] || []);
  if (!list.length) {
    panel.innerHTML = `<div class="note">No completed attempts on ${escapeHtml(day)}.</div>`;
    panel.classList.remove('hidden');
    return;
  }
  panel.innerHTML = `<div class="cal-panel-head"><b>${escapeHtml(day)}</b> · ${list.length} attempt${list.length === 1 ? '' : 's'}
      <button class="task-del" id="calPanelClose" title="Close">✕</button></div>` +
    list.map((s) => {
      const emoji = s.domain === 'math' ? '🔢' : '📖';
      const sc = (s.score != null) ? `${s.score}/${s.total}` : `${s.answered}/${s.total}`;
      const acc = s.total ? Math.round((s.score / s.total) * 100) : 0;
      return `<div class="cal-attempt">
        <span>${emoji} <b>${escapeHtml(fmtTopic(s.topic))}</b> <span class="note">${s.difficulty}</span> · ${sc} (${acc}%)</span>
        <a class="btn btn-ghost" href="/session.html?id=${s.id}">Review answers →</a>
      </div>`;
    }).join('');
  panel.classList.remove('hidden');
  const c = document.getElementById('calPanelClose');
  if (c) c.onclick = () => panel.classList.add('hidden');
}

function renderCalendar() {
  const EXAM = new Date('2026-08-22T00:00:00');
  const cal = $('calendar');
  const activeDays = new Set((DATA.byDay || []).map((d) => d.day)); // YYYY-MM-DD with activity
  const byDaySessions = sessionsByDay();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Monday of this week
  const start = new Date(today); start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const fmt = (d) => d.toISOString().slice(0, 10);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const plan = ['Math + Reading', 'Math + Reading', 'Focus work', 'Math + Reading', 'Math + Reading', 'Focus work', 'Rest'];

  // last 2 weeks before exam are full-length tests
  // Full-length tests = the last 2 calendar weeks (exam week + the one before),
  // i.e. weeks whose Monday is on/after testStartMonday. This keeps the 7
  // practice weeks intact when starting around Jun 22.
  const examMonday = new Date(EXAM); examMonday.setDate(EXAM.getDate() - ((EXAM.getDay() + 6) % 7));
  const testStartMonday = new Date(examMonday); testStartMonday.setDate(examMonday.getDate() - 7);

  let html = '';
  let wk = new Date(start);
  let n = 0;
  while (wk <= EXAM && n < 12) {
    const weekEnd = new Date(wk); weekEnd.setDate(wk.getDate() + 6);
    const isTestWeek = wk >= testStartMonday;
    const isThisWeek = today >= wk && today <= weekEnd;
    html += `<div class="cal-week ${isThisWeek ? 'current' : ''}">
      <div class="cal-week-head">Week of ${wk.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        <span class="cal-badge ${isTestWeek ? 'test' : 'practice'}">${isTestWeek ? '📝 Full tests' : '📚 Practice'}</span></div>
      <div class="cal-days">`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(wk); d.setDate(wk.getDate() + i);
      const ds = fmt(d);
      const past = d < today, isToday = ds === fmt(today);
      const beyond = d > EXAM;
      const did = activeDays.has(ds);
      const nAtt = (byDaySessions[ds] || []).length;
      const label = isTestWeek ? (i === 5 ? 'Full test' : (i === 6 ? 'Rest' : 'Review')) : plan[i];
      const clickable = nAtt ? ' has-attempts' : '';
      html += `<div class="cal-day ${isToday ? 'today' : ''} ${past ? 'past' : ''} ${beyond ? 'beyond' : ''} ${did ? 'did' : ''}${clickable}" ${nAtt ? `data-date="${ds}"` : ''}>
        <span class="cal-dn">${dayNames[i]} ${d.getDate()}</span>
        <span class="cal-plan">${did ? '✅ ' : ''}${beyond ? '—' : label}</span>
        ${nAtt ? `<span class="cal-att-badge">${nAtt} attempt${nAtt === 1 ? '' : 's'} ›</span>` : ''}
      </div>`;
    }
    html += `</div></div>`;
    wk.setDate(wk.getDate() + 7); n++;
  }
  const weeksLeft = Math.max(0, Math.ceil((EXAM - today) / (7 * 86400000)));
  $('calIntro').textContent = `${weeksLeft} week(s) until Aug 22. Mon/Tue/Thu/Fri = Math + Reading sessions; Wed/Sat = focus work; last 2 weeks = full-length tests. ✅ = you practiced that day.`;
  cal.innerHTML = html;
}

function accClass(acc) {
  if (acc >= 80) return 'acc-good';
  if (acc >= 60) return 'acc-ok';
  return 'acc-low';
}

function renderSkills() {
  const rows = DATA.bySkill || [];
  const tbody = $('skillsTable').querySelector('tbody');
  const highlight = $('skillHighlight');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="note">No skills practiced yet. Once she answers questions, her per-skill breakdown shows here.</td></tr>';
    highlight.innerHTML = '';
    return;
  }
  // Highlight the weakest skill with enough attempts to be meaningful.
  const ranked = rows.map((r) => ({ ...r, acc: r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0 }));
  const weak = ranked.filter((r) => r.attempts >= 2).sort((a, b) => a.acc - b.acc)[0] || ranked[0];
  highlight.innerHTML = `<div class="skill-focus">
      <span class="skill-focus-emoji">💡</span>
      <div><b>Top area to work on:</b> ${escapeHtml(weak.skill)}
      <span class="note">(${weak.acc}% over ${weak.attempts} attempt${weak.attempts === 1 ? '' : 's'} · ${fmtTopic(weak.topic)} · ${weak.difficulty})</span></div>
    </div>`;

  tbody.innerHTML = ranked.map((r) => {
    const domainEmoji = r.domain === 'math' ? '🔢' : '📖';
    return `<tr class="skill-row" data-skill="${escapeHtml(r.skill)}" title="Filter attempts by this skill">
      <td><b>${escapeHtml(r.skill)}</b></td>
      <td>${domainEmoji} ${fmtTopic(r.topic)}</td>
      <td>${r.difficulty === 'hard' ? '🔴' : '🟡'} ${r.difficulty}</td>
      <td><div class="acc-bar"><span class="${accClass(r.acc)}" style="width:${r.acc}%"></span><em>${r.acc}%</em></div></td>
      <td>${r.correct}</td>
      <td>${r.wrong}</td>
      <td>${r.attempts}</td>
      <td>${fmtTime(Math.round(r.avg_time))}</td>
    </tr>`;
  }).join('');
}

function populateSkillFilter() {
  const sel = $('fSkill');
  if (!sel) return;
  const skills = [...new Set(allAttempts.map((a) => a.skill).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All</option>' +
    skills.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
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

function getFilteredAttempts() {
  const date   = $('fDate') ? $('fDate').value : '';
  const sec    = $('fSection').value;
  const diff   = $('fDifficulty') ? $('fDifficulty').value : '';
  const result = $('fResult').value;
  const skill  = $('fSkill') ? $('fSkill').value : '';
  const search = $('fSearch').value.trim().toLowerCase();
  return allAttempts.filter((a) => {
    if (date   && a.answered_at.slice(0, 10) !== date) return false;
    if (sec    && a.domain !== sec) return false;
    if (diff   && a.difficulty !== diff) return false;
    if (result !== '' && String(a.is_correct) !== result) return false;
    if (skill  && a.skill !== skill) return false;
    if (search && !a.prompt.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderAttempts() {
  const rows = getFilteredAttempts();
  $('rowCount').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
  const tbody = $('attemptsTable').querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="note">No attempts match your filters yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((a) => {
    const res = a.is_correct
      ? '<span class="pill correct">✓ correct</span>'
      : '<span class="pill wrong">✗ wrong</span>';
    const domainEmoji = a.domain === 'math' ? '🔢' : '📖';
    const topicName = (a.topic||'').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    return `<tr>
      <td>${fmtDate(a.answered_at)}</td>
      <td>${domainEmoji} ${topicName}</td>
      <td>${escapeHtml(a.skill || '—')}</td>
      <td>${a.difficulty === 'hard' ? '🔴' : '🟡'} ${a.difficulty}</td>
      <td><button class="link-cell" data-attempt="${a.id}" title="View this question, your answer, and the solution">${escapeHtml(a.prompt)}${a.prompt.length >= 90 ? '…' : ''} 🔎</button></td>
      <td>${a.selected}</td>
      <td>${a.correct}</td>
      <td>${res}</td>
      <td>${fmtTime(a.time_taken_seconds)}</td>
    </tr>`;
  }).join('');
}

// ---- Question review modal -------------------------------------------------
async function openReview(attemptId) {
  const modal = $('reviewModal');
  const body = $('reviewBody');
  body.innerHTML = '<div class="spinner">Loading…</div>';
  modal.classList.remove('hidden');
  $('reviewCardEl').classList.add('expanded');   // full-screen layout by default
  document.body.style.overflow = 'hidden';
  try {
    const r = await api('GET', `/api/attempts/${attemptId}/review`);
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
  const rows = getFilteredAttempts();
  const header = ['Date', 'Test', 'Domain', 'Topic', 'Skill', 'Difficulty', 'Question', 'HerAnswer', 'Correct', 'Result', 'TimeSeconds'];
  const lines = [header.join(',')];
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  for (const a of rows) {
    const cells = [
      a.answered_at,
      a.test || 'SAT',
      a.domain,
      a.topic,
      q(a.skill || ''),
      a.difficulty,
      q(a.prompt),
      a.selected,
      a.correct,
      a.is_correct ? 'correct' : 'wrong',
      a.time_taken_seconds,
    ];
    lines.push(cells.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sat-attempts.csv';
  link.click();
  URL.revokeObjectURL(url);
}

['fDate', 'fSection', 'fResult', 'fDifficulty', 'fSkill'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', renderAttempts); });
$('fSearch').addEventListener('input', renderAttempts);
$('exportBtn').addEventListener('click', exportCsv);

// Top menu: switch views
document.querySelectorAll('.dash-menu .menu-btn[data-view]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.view));
});

// Click a skill row -> open All Attempts filtered to that skill (across dates)
$('skillsTable').addEventListener('click', (e) => {
  const row = e.target.closest('.skill-row');
  if (!row) return;
  showView('attempts');
  if ($('fDate')) $('fDate').value = '';
  const sel = $('fSkill');
  if (sel) { sel.value = row.dataset.skill; renderAttempts(); }
});

// Click a question in the attempts table -> open the review modal
$('attemptsTable').addEventListener('click', (e) => {
  const btn = e.target.closest('.link-cell');
  if (btn) openReview(Number(btn.dataset.attempt));
});
// Calendar: click a day with attempts to review that day's completed attempts
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
