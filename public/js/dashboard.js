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
  $('goalCount').textContent = `${t.answeredToday} / ${t.goal}`;
  $('goalSub').textContent = t.met
    ? '🎉 Daily goal reached — wonderful!'
    : `${t.goal - t.answeredToday} more to reach today's goal of ${t.goal}.`;

  renderTiles();
  renderCharts();
  renderSessions();
  renderAttempts();
}

function renderTiles() {
  const o = DATA.overall;
  const mathS = DATA.sections.find((s) => s.section === 'math') || {};
  const readS = DATA.sections.find((s) => s.section === 'reading') || {};
  const tiles = [
    { num: o.attempts, lbl: 'Total attempts' },
    { num: o.correct, lbl: 'Correct' },
    { num: o.accuracy + '%', lbl: 'Overall accuracy' },
    { num: fmtTime(o.avgTime), lbl: 'Avg time / question' },
    { num: `${mathS.mastered || 0}/${mathS.total || 0}`, lbl: '🔢 Math mastered' },
    { num: `${readS.mastered || 0}/${readS.total || 0}`, lbl: '📖 Reading mastered' },
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

function renderCharts() {
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

  // Accuracy by section (bar)
  const bs = DATA.bySection;
  makeChart('sectionChart', {
    type: 'bar',
    data: {
      labels: bs.map((s) => s.section === 'math' ? 'Math' : 'Reading'),
      datasets: [{
        label: 'Accuracy %',
        data: bs.map((s) => s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0),
        backgroundColor: [PINK, PINK_LIGHT], borderRadius: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } } },
      plugins: { legend: { display: false } },
    },
  });

  // Avg time by section (bar)
  makeChart('timeChart', {
    type: 'bar',
    data: {
      labels: bs.map((s) => s.section === 'math' ? 'Math' : 'Reading'),
      datasets: [{
        label: 'Avg seconds',
        data: bs.map((s) => Math.round(s.avg_time)),
        backgroundColor: [AMBER, PINK_LIGHT], borderRadius: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + 's' } } },
      plugins: { legend: { display: false } },
    },
  });
}

function renderSessions() {
  const tbody = $('sessionsTable').querySelector('tbody');
  if (!DATA.sessions.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="note">No sessions yet. Start practicing from the Home page!</td></tr>';
    return;
  }
  tbody.innerHTML = DATA.sessions.map((s) => {
    const status = s.status === 'completed'
      ? '<span class="pill correct">completed</span>'
      : '<span class="pill wrong">in progress</span>';
    const score = s.status === 'completed' ? `${s.score} / ${s.total}` : '—';
    const resume = s.status === 'in_progress'
      ? `<a href="/session.html?id=${s.id}">▶ resume</a>`
      : `${s.answered}/${s.total}`;
    return `<tr>
      <td>${s.id}</td>
      <td>${s.section === 'math' ? '🔢 Math' : '📖 Reading'}</td>
      <td>${status}</td>
      <td>${fmtDate(s.created_at)}</td>
      <td>${fmtDate(s.completed_at)}</td>
      <td>${score}</td>
      <td>${resume}</td>
    </tr>`;
  }).join('');
}

function getFilteredAttempts() {
  const sec = $('fSection').value;
  const result = $('fResult').value;
  const search = $('fSearch').value.trim().toLowerCase();
  return allAttempts.filter((a) => {
    if (sec && a.section !== sec) return false;
    if (result !== '' && String(a.is_correct) !== result) return false;
    if (search && !a.prompt.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderAttempts() {
  const rows = getFilteredAttempts();
  $('rowCount').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;
  const tbody = $('attemptsTable').querySelector('tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="note">No attempts match your filters yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((a) => {
    const res = a.is_correct
      ? '<span class="pill correct">✓ correct</span>'
      : '<span class="pill wrong">✗ wrong</span>';
    return `<tr>
      <td>${fmtDate(a.answered_at)}</td>
      <td>${a.section === 'math' ? '🔢' : '📖'} ${a.section}</td>
      <td>${escapeHtml(a.prompt)}${a.prompt.length >= 90 ? '…' : ''}</td>
      <td>${a.selected}</td>
      <td>${a.correct}</td>
      <td>${res}</td>
      <td>${fmtTime(a.time_taken_seconds)}</td>
    </tr>`;
  }).join('');
}

function exportCsv() {
  const rows = getFilteredAttempts();
  const header = ['Date', 'Section', 'Question', 'HerAnswer', 'Correct', 'Result', 'TimeSeconds'];
  const lines = [header.join(',')];
  for (const a of rows) {
    const cells = [
      a.answered_at,
      a.section,
      '"' + a.prompt.replace(/"/g, '""') + '"',
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

['fSection', 'fResult'].forEach((id) => $(id).addEventListener('change', renderAttempts));
$('fSearch').addEventListener('input', renderAttempts);
$('exportBtn').addEventListener('click', exportCsv);

load().catch((e) => {
  $('statTiles').innerHTML = `<p class="note">Could not load dashboard: ${e.message}</p>`;
});
