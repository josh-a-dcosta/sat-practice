// Practice session: split PDF viewer + answer panel, navigation, timer, results.

const sessionId = Number(getParam('id'));

let state = null;            // session navigation state
let pos = 1;                 // current position
let current = null;          // current question payload
let pendingSelection = null; // mcq label or spr text not yet submitted
let timeLimit = 120;
let pdfZoom = 1;             // image zoom level, persists across questions
const ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_STEP = 0.25;

const accum = {};            // pos -> seconds accumulated
let viewStart = null;
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
  $('sectionLabel').textContent = `${domainEmoji} ${titleCase(state.topic)} · ${diffLabel}`;
  if (state.status === 'completed') {
    return showResults();
  }
  renderMap();
  updateFinish();
  pos = state.currentPosition || 1;
  await loadQuestion(pos);
}

function titleCase(t) { return t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

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
  $('finishBtn').disabled = !(done === total);
  $('finishNote').textContent = done === total
    ? '🌟 All answered! Click Finish when you\'re ready.'
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
  const q = current.question;

  $('counter').textContent = `Question ${current.position} of ${current.total}`;

  // ----- LEFT PANE: image (real PDF) or text -----
  const pdfFrame = $('pdfFrame');
  const textQ = $('textQuestion');
  const answerExtra = $('answerImage');
  answerExtra.classList.add('hidden');

  if (q.image) {
    textQ.classList.add('hidden');
    pdfFrame.classList.remove('hidden');
    $('pdfTools').classList.remove('hidden');
    $('qImage').src = q.image;
    applyZoom();
    const mask = $('answerMask');
    const frac = (q.maskFraction != null ? q.maskFraction : 1);
    mask.style.top = (frac * 100) + '%';
    mask.classList.remove('hidden');           // re-hide answer on every load
    answerExtra.dataset.src = q.answerImage || '';
    answerExtra.removeAttribute('src');
  } else {
    pdfFrame.classList.add('hidden');
    $('pdfTools').classList.add('hidden');
    textQ.classList.remove('hidden');
    const passEl = $('passage');
    if (q.passage) { passEl.textContent = q.passage; passEl.classList.remove('hidden'); }
    else passEl.classList.add('hidden');
    $('prompt').textContent = q.prompt;
  }

  // ----- RIGHT PANE: answer input -----
  const choicesWrap = $('choices');
  const sprWrap = $('sprWrap');
  const sprInput = $('sprInput');
  choicesWrap.innerHTML = '';

  if (q.qtype === 'spr') {
    choicesWrap.classList.add('hidden');
    sprWrap.classList.remove('hidden');
    sprInput.value = current.answered ? (current.selected || '') : '';
    sprInput.disabled = !!current.answered;
    if (!current.answered) {
      sprInput.oninput = () => {
        pendingSelection = sprInput.value.trim();
        $('submitBtn').disabled = !pendingSelection;
      };
    }
  } else {
    sprWrap.classList.add('hidden');
    choicesWrap.classList.remove('hidden');
    for (const c of q.choices) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'opt';
      opt.dataset.label = c.label;
      const txt = c.text ? `<div class="opt-text">${escapeHtml(c.text)}</div>` : '';
      opt.innerHTML = `<div class="badge">${c.label}</div>${txt}`;
      if (current.answered) {
        opt.classList.add('locked');
        if (c.label === current.selected) opt.classList.add('selected');
      } else {
        opt.onclick = () => selectOption(c.label);
      }
      choicesWrap.appendChild(opt);
    }
  }

  // ----- controls -----
  const lockedNote = $('lockedNote');
  const submitBtn = $('submitBtn');
  const hint = $('answerHint');
  if (current.answered) {
    lockedNote.classList.remove('hidden');
    submitBtn.classList.add('hidden');
    hint.textContent = 'You answered this one. Review or move on! ✨';
  } else {
    lockedNote.classList.add('hidden');
    submitBtn.classList.remove('hidden');
    submitBtn.disabled = true;
    hint.textContent = q.qtype === 'spr' ? 'Type your answer below 💭' : 'Choose your answer below 💭';
  }

  $('prevBtn').disabled = current.position <= 1;
  $('nextBtn').disabled = current.position >= current.total;

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

function applyZoom() {
  pdfZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pdfZoom));
  $('pdfInner').style.width = (pdfZoom * 100) + '%';
  $('zoomLevel').textContent = Math.round(pdfZoom * 100) + '%';
  $('zoomOut').disabled = pdfZoom <= ZOOM_MIN;
  $('zoomIn').disabled = pdfZoom >= ZOOM_MAX;
}

function zoomBy(delta) { pdfZoom += delta; applyZoom(); }
function zoomReset() { pdfZoom = 1; applyZoom(); }

function revealAnswer() {
  $('answerMask').classList.add('hidden');
  const extra = $('answerImage');
  if (extra.dataset.src) { extra.src = extra.dataset.src; extra.classList.remove('hidden'); }
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
    await loadState();
    if (!res.allAnswered) {
      const next = findNextUnanswered(pos);
      if (next) pos = next;
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
  try { await showResults(); } catch (e) { showToast(e.message); }
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
      const div = document.createElement('div');
      div.className = 'review-item';
      let body = `<div style="font-weight:800; margin-bottom:6px">Question ${item.position}</div>`;
      if (item.image) {
        body += `<img class="review-img" src="${item.image}" alt="Question ${item.position}" />`;
        if (item.answerImage) body += `<img class="review-img" src="${item.answerImage}" alt="Answer ${item.position}" />`;
        const your = item.selected || '(no answer)';
        body += `<div class="ans-row"><span class="tag-wrong">Your answer: ${escapeHtml(your)}</span>
                 <span class="tag-right">Correct answer: ${escapeHtml(item.correct)}</span></div>`;
      } else {
        const correctText = (item.choices.find((c) => c.label === item.correct) || {}).text || item.correct;
        const yourText = (item.choices.find((c) => c.label === item.selected) || {}).text || item.selected || '(no answer)';
        if (item.passage) body += `<div class="passage">${escapeHtml(item.passage)}</div>`;
        body += `<div class="prompt" style="font-size:1.05rem">${escapeHtml(item.prompt)}</div>`;
        body += `<div class="ans-row"><span class="tag-wrong">Your answer: ${item.selected}. ${escapeHtml(yourText)}</span></div>`;
        body += `<div class="ans-row"><span class="tag-right">Correct answer: ${item.correct}. ${escapeHtml(correctText)}</span></div>`;
        if (item.explanation) body += `<div class="explanation"><b>Why:</b> ${escapeHtml(item.explanation)}</div>`;
      }
      div.innerHTML = body;
      list.appendChild(div);
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// wire up
$('prevBtn').onclick = () => gotoPosition(pos - 1);
$('nextBtn').onclick = () => gotoPosition(pos + 1);
$('submitBtn').onclick = submitAnswer;
$('finishBtn').onclick = finishSession;
$('revealBtn').onclick = revealAnswer;
$('zoomIn').onclick = () => zoomBy(ZOOM_STEP);
$('zoomOut').onclick = () => zoomBy(-ZOOM_STEP);
$('zoomReset').onclick = zoomReset;

window.addEventListener('beforeunload', stopTiming);

if (!sessionId) {
  document.querySelector('.container').innerHTML = '<div class="card center"><h2>No session selected</h2><a class="btn btn-primary" href="/">Go Home</a></div>';
} else {
  loadState().catch((e) => {
    document.querySelector('.container').innerHTML = `<div class="card center"><h2>Could not load session</h2><p class="note">${e.message}</p><a class="btn btn-primary" href="/">Go Home</a></div>`;
  });
}
