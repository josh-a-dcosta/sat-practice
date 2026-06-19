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
  renderSkills();
  populateSkillFilter();
  renderSessions();
  renderAttempts();
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
  const sec    = $('fSection').value;
  const diff   = $('fDifficulty') ? $('fDifficulty').value : '';
  const result = $('fResult').value;
  const skill  = $('fSkill') ? $('fSkill').value : '';
  const search = $('fSearch').value.trim().toLowerCase();
  return allAttempts.filter((a) => {
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

['fSection', 'fResult', 'fDifficulty', 'fSkill'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', renderAttempts); });
$('fSearch').addEventListener('input', renderAttempts);
$('exportBtn').addEventListener('click', exportCsv);

// Click a skill row -> filter the attempts table to that skill and scroll to it
$('skillsTable').addEventListener('click', (e) => {
  const row = e.target.closest('.skill-row');
  if (!row) return;
  const sel = $('fSkill');
  if (sel) { sel.value = row.dataset.skill; renderAttempts(); }
  $('attemptsTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Click a question in the attempts table -> open the review modal
$('attemptsTable').addEventListener('click', (e) => {
  const btn = e.target.closest('.link-cell');
  if (btn) openReview(Number(btn.dataset.attempt));
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
