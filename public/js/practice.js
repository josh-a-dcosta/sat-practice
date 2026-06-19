// Practice session logic: navigation, timer, answering, and results.

const sessionId = Number(getParam('id'));

let state = null;            // session navigation state
let pos = 1;                 // current position
let current = null;          // current question payload
let pendingSelection = null; // label chosen but not yet submitted
let timeLimit = 120;

// time tracking (active viewing seconds per position)
const accum = {};            // pos -> seconds accumulated
let viewStart = null;        // ms timestamp when current unanswered question shown
let ticker = null;

const $ = (id) => document.getElementById(id);

function currentElapsed() {
  let secs = accum[pos] || 0;
  if (viewStart) secs += (Date.now() - viewStart) / 1000;
  return secs;
}

function stopTiming() {
  if (viewStart) {
    accum[pos] = (accum[pos] || 0) + (Date.now() - viewStart) / 1000;
    viewStart = null;
  }
  if (ticker) { clearInterval(ticker); ticker = null; }
}

function startTimer() {
  if (ticker) clearInterval(ticker);
  updateTimerDisplay();
  ticker = setInterval(updateTimerDisplay, 250);
}

function updateTimerDisplay() {
  const el = $('timer');
  if (current && current.answered) {
    el.textContent = '✓ Answered';
    el.className = 'timer';
    return;
  }
  const remaining = Math.round(timeLimit - currentElapsed());
  el.classList.remove('warn', 'danger');
  if (remaining <= 0) {
    el.textContent = "Time's up — finish when ready!";
    el.classList.add('danger');
  } else {
    el.textContent = fmtTime(remaining);
    if (remaining <= 15) el.classList.add('danger');
    else if (remaining <= 45) el.classList.add('warn');
  }
}

async function loadState() {
  state = await api('GET', `/api/sessions/${sessionId}`);
  const domainEmoji = state.domain === 'math' ? '🔢' : '📖';
  const diffLabel = state.difficulty === 'hard' ? '🔴 Hard' : '🟡 Medium';
  $('sectionLabel').textContent = `${domainEmoji} ${state.topic.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} · ${diffLabel}`;
  if (state.status === 'completed') {
    return showResults();
  }
  renderMap();
  updateFinish();
  pos = state.currentPosition || 1;
  await loadQuestion(pos);
}

function renderMap() {
  const map = $('map');
  map.innerHTML = '';
  for (const item of state.items) {
    const b = document.createElement('button');
    b.textContent = item.position;
    if (item.answered) b.classList.add('answered');
    if (item.position === pos) b.classList.add('current');
    b.onclick = () => gotoPosition(item.position);
    map.appendChild(b);
  }
}

function updateFinish() {
  const done = state.answeredCount;
  const total = state.total;
  $('progressFill').style.width = Math.round((done / total) * 100) + '%';
  const finishBtn = $('finishBtn');
  finishBtn.disabled = !(done === total);
  $('finishNote').textContent = done === total
    ? '🌟 All questions answered! Click "Finish & see results" when you\'re ready.'
    : `Answered ${done} of ${total}. Answer every question to finish — you can go back and forth freely.`;
}

async function gotoPosition(newPos) {
  if (newPos < 1 || newPos > state.total) return;
  stopTiming();
  pos = newPos;
  await loadQuestion(pos);
}

async function loadQuestion(p) {
  current = await api('GET', `/api/sessions/${sessionId}/questions/${p}`);
  timeLimit = current.timeLimit || 120;
  pendingSelection = null;

  $('counter').textContent = `Question ${current.position} of ${current.total}`;

  // passage
  const passEl = $('passage');
  if (current.question.passage) {
    passEl.textContent = current.question.passage;
    passEl.classList.remove('hidden');
  } else {
    passEl.classList.add('hidden');
  }

  $('prompt').textContent = current.question.prompt;

  // choices
  const wrap = $('choices');
  wrap.innerHTML = '';
  for (const c of current.question.choices) {
    const opt = document.createElement('div');
    opt.className = 'opt';
    opt.dataset.label = c.label;
    opt.innerHTML = `<div class="badge">${c.label}</div><div>${escapeHtml(c.text)}</div>`;
    if (current.answered) {
      opt.classList.add('locked');
      if (c.label === current.selected) opt.classList.add('selected');
    } else {
      opt.onclick = () => selectOption(c.label);
    }
    wrap.appendChild(opt);
  }

  // controls
  const lockedNote = $('lockedNote');
  const submitBtn = $('submitBtn');
  if (current.answered) {
    lockedNote.classList.remove('hidden');
    submitBtn.classList.add('hidden');
  } else {
    lockedNote.classList.add('hidden');
    submitBtn.classList.remove('hidden');
    submitBtn.disabled = true;
  }

  $('prevBtn').disabled = current.position <= 1;
  $('nextBtn').disabled = current.position >= current.total;

  // timing
  if (!current.answered) {
    if (accum[pos] === undefined) accum[pos] = 0;
    viewStart = Date.now();
    startTimer();
  } else {
    viewStart = null;
    if (ticker) { clearInterval(ticker); ticker = null; }
    updateTimerDisplay();
  }

  renderMap();
}

function selectOption(label) {
  if (current.answered) return;
  pendingSelection = label;
  document.querySelectorAll('#choices .opt').forEach((o) => {
    o.classList.toggle('selected', o.dataset.label === label);
  });
  $('submitBtn').disabled = false;
}

async function submitAnswer() {
  if (!pendingSelection || current.answered) return;
  const timeTaken = Math.round(currentElapsed());
  $('submitBtn').disabled = true;
  try {
    const res = await api('POST', `/api/sessions/${sessionId}/answer`, {
      questionId: current.question.id,
      selected: pendingSelection,
      timeTaken,
    });
    stopTiming();
    showToast(randomEncouragement());
    await loadState();             // refresh counts + map
    // auto-advance to the next unanswered question
    if (!res.allAnswered) {
      const next = findNextUnanswered(pos);
      if (next) { pos = next; }
    }
    await loadQuestion(pos);
  } catch (e) {
    showToast(e.message);
    $('submitBtn').disabled = false;
  }
}

function findNextUnanswered(fromPos) {
  const order = [];
  for (let i = fromPos + 1; i <= state.total; i++) order.push(i);
  for (let i = 1; i <= fromPos; i++) order.push(i);
  for (const p of order) {
    const item = state.items.find((x) => x.position === p);
    if (item && !item.answered) return p;
  }
  return null;
}

async function finishSession() {
  stopTiming();
  try {
    await showResults();
  } catch (e) {
    showToast(e.message);
  }
}

async function showResults() {
  const r = await api('POST', `/api/sessions/${sessionId}/complete`);
  $('questionView').classList.add('hidden');
  $('resultsView').classList.remove('hidden');

  $('rScore').textContent = r.score;
  $('rTotal').textContent = r.total;
  $('rAcc').textContent = r.accuracy + '%';
  $('rAvg').textContent = fmtTime(r.avgTimeSeconds);
  $('scoreText').textContent = `You scored ${r.score} / ${r.total}`;

  // encouraging message based on score
  let emoji = '🎉', title = 'Amazing work!', msg = '';
  if (r.accuracy >= 90) { emoji = '🏆'; title = 'Outstanding!'; msg = 'You\'re a star — incredible accuracy! 💖'; }
  else if (r.accuracy >= 70) { emoji = '🌟'; title = 'Great job!'; msg = 'Wonderful effort! A little review and you\'ll be unstoppable.'; }
  else if (r.accuracy >= 50) { emoji = '💪'; title = 'Nice effort!'; msg = 'You\'re learning fast. Review the explanations below — you\'ve got this!'; }
  else { emoji = '🌱'; title = 'Keep going!'; msg = 'Every expert started here. Read the explanations and you\'ll improve so much!'; }
  $('resultEmoji').textContent = emoji;
  $('resultTitle').textContent = title;
  $('resultMsg').textContent = msg;

  const reviewCard = $('reviewCard');
  const list = $('reviewList');
  list.innerHTML = '';
  if (!r.review.length) {
    reviewCard.innerHTML = '<h2>✅ Perfect session!</h2><p class="note">You answered every question correctly. Nothing to review — fantastic! 🎀</p>';
  } else {
    for (const item of r.review) {
      const correctText = (item.choices.find((c) => c.label === item.correct) || {}).text || '';
      const yourText = (item.choices.find((c) => c.label === item.selected) || {}).text || '(no answer)';
      const div = document.createElement('div');
      div.className = 'review-item';
      div.innerHTML = `
        <div style="font-weight:800; margin-bottom:6px">Question ${item.position}</div>
        ${item.passage ? `<div class="passage">${escapeHtml(item.passage)}</div>` : ''}
        <div class="prompt" style="font-size:1.05rem">${escapeHtml(item.prompt)}</div>
        <div class="ans-row">
          <span class="tag-wrong">Your answer: ${item.selected}. ${escapeHtml(yourText)}</span>
        </div>
        <div class="ans-row">
          <span class="tag-right">Correct answer: ${item.correct}. ${escapeHtml(correctText)}</span>
        </div>
        <div class="explanation"><b>Why:</b> ${escapeHtml(item.explanation)}</div>
      `;
      list.appendChild(div);
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// wire up buttons
$('prevBtn').onclick = () => gotoPosition(pos - 1);
$('nextBtn').onclick = () => gotoPosition(pos + 1);
$('submitBtn').onclick = submitAnswer;
$('finishBtn').onclick = finishSession;

// save timing if she leaves the page
window.addEventListener('beforeunload', stopTiming);

if (!sessionId) {
  document.querySelector('.container').innerHTML = '<div class="card center"><h2>No session selected</h2><a class="btn btn-primary" href="/">Go Home</a></div>';
} else {
  loadState().catch((e) => {
    document.querySelector('.container').innerHTML = `<div class="card center"><h2>Could not load session</h2><p class="note">${e.message}</p><a class="btn btn-primary" href="/">Go Home</a></div>`;
  });
}
