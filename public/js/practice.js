// Practice session: split PDF viewer + answer panel, per-question timer with
// pause/resume, peek/timeout locking, immediate feedback, and a live score.

const sessionId = Number(getParam('id'));

let state = null;            // session navigation state
let pos = 1;                 // current position
let current = null;          // current question payload
let pendingSelection = null; // mcq label or spr text not yet submitted
let timeLimit = 120;
let elapsed = 0;             // seconds spent on the current question
let resolved = false;        // current question already answered/peeked/timed-out
let reviewMode = false;      // attempt completed — review answers, no timing
let viewStart = null;        // wall-clock when the current view started timing
let ticker = null;
let heartbeat = null;

let pdfZoom = 1;
const ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_STEP = 0.25;

const $ = (id) => document.getElementById(id);

// ---------- sound ----------
let audioCtx = null;
function beep(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const notes = kind === 'correct' ? [660, 990] : [200, 150];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = kind === 'correct' ? 'sine' : 'square';
      o.frequency.value = f;
      o.connect(g); g.connect(audioCtx.destination);
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    });
  } catch (_) { /* audio optional */ }
}

// ---------- timing ----------
function currentElapsed() {
  let s = elapsed;
  if (viewStart) s += (Date.now() - viewStart) / 1000;
  return s;
}

function stopTiming() {
  if (viewStart) { elapsed += (Date.now() - viewStart) / 1000; viewStart = null; }
  if (ticker) { clearInterval(ticker); ticker = null; }
}

function startTimer() {
  if (ticker) clearInterval(ticker);
  updateTimerDisplay();
  ticker = setInterval(updateTimerDisplay, 250);
}

// Show how long has been spent on the current question (counts up, always
// tracked for reporting — independent of the countdown limit).
function updateElapsedNote() {
  const en = $('elapsedNote');
  if (en) en.textContent = `⏱ ${fmtTime(Math.round(currentElapsed()))} on this question`;
}

function updateTimerDisplay() {
  updateElapsedNote();
  const el = $('timer');
  if (resolved) { el.textContent = '✓ Done'; el.className = 'timer'; return; }
  const remaining = Math.round(timeLimit - currentElapsed());
  el.classList.remove('warn', 'danger');
  if (remaining <= 0) {
    el.textContent = "Time's up!";
    el.classList.add('danger');
    autoTimeout();
  } else {
    el.textContent = fmtTime(remaining);
    if (remaining <= 15) el.classList.add('danger');
    else if (remaining <= 45) el.classList.add('warn');
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(saveProgress, 5000);
}
function stopHeartbeat() { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } }

function saveProgress() {
  if (resolved || !current) return;
  const body = JSON.stringify({ position: pos, elapsed: Math.round(currentElapsed()) });
  // Use sendBeacon when leaving; normal fetch on heartbeat.
  fetch(`/api/sessions/${sessionId}/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
  }).catch(() => {});
}

// ---------- load ----------
async function loadState() {
  state = await api('GET', `/api/sessions/${sessionId}`);
  const domainEmoji = state.domain === 'math' ? '🔢' : '📖';
  const diffLabel = state.difficulty === 'hard' ? '🔴 Hard' : '🟡 Medium';
  $('sectionLabel').textContent = `${domainEmoji} ${state.topicName || titleCase(state.topic)} · ${diffLabel}`;
  renderMap();
  if (state.status === 'completed') {
    enterReviewUI();
    pos = firstWrong() || state.currentPosition || 1;
  } else {
    updateFinish();
    pos = state.currentPosition || 1;
  }
  await loadQuestion(pos);
}

function firstWrong() {
  const w = state.items.find((i) => i.answered && !i.correct);
  return w ? w.position : null;
}

// Switch the screen into "attempt complete" review mode.
function enterReviewUI() {
  reviewMode = true;
  stopTiming(); stopHeartbeat();
  $('finishControls').classList.add('hidden');
  $('doneControls').classList.remove('hidden');
  $('pauseBtn').classList.add('hidden');
  $('topCloseBtn').classList.remove('hidden');
  $('doneTag').classList.remove('hidden');
  const pl = $('pauseLink'); if (pl) pl.classList.add('hidden');
  const correct = state.items.filter((i) => i.correct).length;
  $('doneScore').textContent = `Score ${correct} / ${state.items.length}`;
  $('finishNote').textContent = 'All done! 🎉 Tap any 🟥 box to revisit it with the answer and explanation.';
}

async function completeAndReview() {
  try {
    await api('POST', `/api/sessions/${sessionId}/complete`);
    await refreshState();
    enterReviewUI();
  } catch (e) { showToast(e.message); }
}

function pauseExit() { saveProgress(); location.href = '/'; }

function titleCase(t) { return t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function renderMap() {
  const map = $('map');
  map.innerHTML = '';
  for (const item of state.items) {
    const b = document.createElement('button');
    b.textContent = item.position;
    if (item.resolved) {
      b.classList.add('answered');
      b.classList.add(item.correct ? 'correct' : 'wrong');  // green vs red border
    } else if (item.skipped) {
      b.classList.add('skipped');                            // amber border
    }
    if (item.position === pos) b.classList.add('current');
    b.title = item.resolved ? (item.correct ? 'Correct' : 'Review this one')
            : (item.skipped ? 'Skipped — come back to it' : 'Not done yet');
    b.onclick = () => gotoPosition(item.position);
    map.appendChild(b);
  }
}

function updateFinish() {
  const done = state.resolvedCount;
  const total = state.total;
  const skipped = state.skippedCount || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progressFill').style.width = pct + '%';
  const pp = $('progressPct'); if (pp) pp.textContent = pct + '%';
  $('finishBtn').disabled = !state.allResolved;

  const skBtn = $('skippedBtn');
  if (skipped > 0) {
    skBtn.classList.remove('hidden');
    skBtn.textContent = `⏭ Skipped (${skipped})`;
  } else {
    skBtn.classList.add('hidden');
  }

  if (state.allResolved) {
    $('finishNote').textContent = '🌟 Every question resolved! Click Finish to see your round scorecard.';
  } else if (skipped > 0) {
    $('finishNote').textContent = `Resolved ${done} of ${total}. You have ${skipped} skipped — clear them (and any not done) to finish the round.`;
  } else {
    $('finishNote').textContent = `Resolved ${done} of ${total}. Finish unlocks when every question is resolved.`;
  }
}

function updateScore(running) {
  if (!running) return;
  $('scAcc').textContent = `${running.accuracy}%`;
  $('scNum').textContent = `· ${running.score}/${running.answered}`;
}

async function gotoPosition(newPos) {
  if (newPos < 1 || newPos > state.total) return;
  saveProgress();
  stopTiming();
  pos = newPos;
  await loadQuestion(pos);
}

async function loadQuestion(p) {
  current = await api('GET', `/api/sessions/${sessionId}/questions/${p}`);
  timeLimit = current.timeLimit || 120;
  elapsed = current.elapsedSeconds || 0;
  resolved = !!current.answered;
  pendingSelection = null;
  viewStart = null;
  const q = current.question;
  updateScore(current.running);

  $('counter').textContent = `Question ${current.position} of ${current.total}`;
  $('feedback').classList.add('hidden');

  // ----- LEFT PANE -----
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
    // Reveal answer for resolved questions; hide it while still working.
    mask.classList.toggle('hidden', resolved);
    answerExtra.dataset.src = q.answerImage || (current.feedback && current.feedback.answerImage) || '';
    if (resolved && answerExtra.dataset.src) { answerExtra.src = answerExtra.dataset.src; answerExtra.classList.remove('hidden'); }
    else answerExtra.removeAttribute('src');
  } else {
    pdfFrame.classList.add('hidden');
    $('pdfTools').classList.add('hidden');
    textQ.classList.remove('hidden');
    const passEl = $('passage');
    if (q.passage) { passEl.textContent = q.passage; passEl.classList.remove('hidden'); }
    else passEl.classList.add('hidden');
    $('prompt').textContent = q.prompt;
  }

  // ----- RIGHT PANE: inputs -----
  renderInputs(q);

  // ----- controls / state -----
  $('prevBtn').disabled = current.position <= 1;
  $('nextBtn').disabled = current.position >= current.total;

  // Skip is only offered while the question is still open (not in review mode).
  $('skipBtn').classList.toggle('hidden', resolved || reviewMode);

  if (resolved) {
    showFeedback(current.feedback, { silent: true });
  } else {
    $('submitBtn').classList.remove('hidden');
    $('submitBtn').disabled = true;
    $('answerHint').textContent = q.qtype === 'spr' ? 'Type your answer below 💭' : 'Choose your answer below 💭';
    viewStart = Date.now();
    startTimer();
    startHeartbeat();
    // If time was already used up before a pause, lock immediately.
    if (timeLimit - currentElapsed() <= 0) autoTimeout();
  }

  renderMap();
}

function renderInputs(q) {
  const choicesWrap = $('choices');
  const sprWrap = $('sprWrap');
  const sprInput = $('sprInput');
  choicesWrap.innerHTML = '';
  const lock = resolved;

  if (q.qtype === 'spr') {
    choicesWrap.classList.add('hidden');
    sprWrap.classList.remove('hidden');
    sprInput.value = (resolved && current.selected) ? current.selected : '';
    sprInput.disabled = lock;
    sprInput.oninput = lock ? null : () => {
      pendingSelection = sprInput.value.trim();
      $('submitBtn').disabled = !pendingSelection;
    };
  } else {
    sprWrap.classList.add('hidden');
    choicesWrap.classList.remove('hidden');
    const correctLabel = current.feedback ? current.feedback.correctLabel : null;
    for (const c of q.choices) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'opt';
      opt.dataset.label = c.label;
      const txt = c.text ? `<div class="opt-text">${escapeHtml(c.text)}</div>` : '';
      opt.innerHTML = `<div class="badge">${c.label}</div>${txt}`;
      if (lock) {
        opt.classList.add('locked');
        if (c.label === current.selected) opt.classList.add('selected');
        if (correctLabel && c.label === correctLabel) opt.classList.add('is-correct');
      } else {
        opt.onclick = () => selectOption(c.label);
      }
      choicesWrap.appendChild(opt);
    }
  }
}

function selectOption(label) {
  if (resolved) return;
  pendingSelection = label;
  document.querySelectorAll('#choices .opt').forEach((o) => {
    o.classList.toggle('selected', o.dataset.label === label);
  });
  $('submitBtn').disabled = false;
}

// ---------- resolution ----------
async function submitAnswer() {
  if (!pendingSelection || resolved) return;
  $('submitBtn').disabled = true;
  await resolve('answer', { selected: pendingSelection });
}

async function peekAnswer() {
  if (resolved) return;
  await resolve('peek', {});
  $('answerMask').classList.add('hidden');
}

async function autoTimeout() {
  if (resolved) return;
  resolved = true;            // guard against repeat
  await resolve('timeout', {});
}

// Defer this question (logged as a skip) and jump to the next one needing work.
async function skipCurrent() {
  if (resolved || !current) return;
  saveProgress(); stopTiming(); stopHeartbeat();
  const timeTaken = Math.round(currentElapsed());
  try {
    await api('POST', `/api/sessions/${sessionId}/skip`, { questionId: current.question.id, timeTaken });
    await refreshState();
    const next = findNextUnresolved(pos);
    if (next && next !== pos) await gotoPosition(next);
    else await loadQuestion(pos); // nothing else left to do — reload (will offer finish)
  } catch (e) { showToast(e.message); }
}

async function resolve(kind, extra) {
  stopTiming(); stopHeartbeat();
  const timeTaken = Math.round(currentElapsed());
  try {
    const res = await api('POST', `/api/sessions/${sessionId}/${kind}`, {
      questionId: current.question.id, timeTaken, ...extra,
    });
    resolved = true;
    current.feedback = res;
    current.answered = true;
    current.selected = res.selected;
    // reveal answer on the page image
    const mask = $('answerMask'); if (mask) mask.classList.add('hidden');
    const extraImg = $('answerImage');
    if (res.answerImage) { extraImg.src = res.answerImage; extraImg.classList.remove('hidden'); }
    renderInputs(current.question);
    showFeedback(res, {});
    await refreshState();
    if (state.allAnswered && !reviewMode) await completeAndReview();
  } catch (e) {
    showToast(e.message);
  }
}

function showFeedback(fb, opts) {
  const box = $('feedback');
  const emoji = $('fbEmoji'), title = $('fbTitle'), msg = $('fbMsg'), explain = $('fbExplain');
  $('submitBtn').classList.add('hidden');
  $('answerHint').textContent = '';
  box.classList.remove('hidden', 'good', 'bad');

  if (fb.isCorrect) {
    box.classList.add('good');
    emoji.textContent = '⭐';
    title.textContent = pick(['Gold star! 🌟', 'Correct! 🎉', 'Nailed it! 💯', 'Brilliant! ✨']);
    msg.textContent = pick(['You earned a gold star for this one!', 'Way to go — keep that streak alive!', 'Smart work! On to the next.']);
    explain.classList.add('hidden');
    if (!opts.silent) beep('correct');
  } else {
    box.classList.add('bad');
    emoji.textContent = fb.peeked ? '👀' : (fb.overLimit ? '⏰' : '💡');
    title.textContent = fb.peeked ? 'Peeked' : (fb.overLimit ? 'Time was up' : 'No worries!');
    const ca = String(fb.correct || '').replace(/\.+$/, '');  // avoid "B.."
    msg.textContent = (ca ? `Correct answer is ${ca}. ` : '') + 'Read the explanation.';
    if (fb.explanation) { explain.textContent = fb.explanation; explain.classList.remove('hidden'); }
    else explain.classList.add('hidden');
    if (!opts.silent) beep('wrong');
  }
  updateScore(fb.running);
  updateElapsedNote();   // freeze the per-question time at its final value
  // Offer "Next" only while something else still needs work.
  $('fbNext').style.display = hasUnresolvedElsewhere() ? '' : 'none';
}

async function refreshState() {
  state = await api('GET', `/api/sessions/${sessionId}`);
  updateFinish();
  renderMap();
}

function goNext() {
  const next = findNextUnresolved(pos) || (pos < state.total ? pos + 1 : pos);
  gotoPosition(next);
}

// Next thing needing work, scanning forward then wrapping. Pending questions
// come before skipped ones, so a round flows through fresh questions first and
// the skipped ones resurface near the end.
function findNextUnresolved(fromPos) {
  const order = [];
  for (let i = fromPos + 1; i <= state.total; i++) order.push(i);
  for (let i = 1; i <= fromPos; i++) order.push(i);
  const byStatus = (wantSkipped) => {
    for (const p of order) {
      const item = state.items.find((x) => x.position === p);
      if (item && !item.resolved && (!!item.skipped === wantSkipped)) return p;
    }
    return null;
  };
  return byStatus(false) || byStatus(true); // pending first, then skipped
}

function firstSkipped() {
  const s = state.items.find((i) => i.skipped);
  return s ? s.position : null;
}

function hasUnresolvedElsewhere() {
  return state.items.some((i) => !i.resolved && i.position !== pos);
}

async function finishSession() {
  saveProgress(); stopTiming(); stopHeartbeat();
  try { await showResults(); } catch (e) { showToast(e.message); }
}

// ---------- zoom + fullscreen ----------
function applyZoom() {
  pdfZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pdfZoom));
  $('pdfInner').style.width = (pdfZoom * 100) + '%';
  $('zoomLevel').textContent = Math.round(pdfZoom * 100) + '%';
  $('zoomOut').disabled = pdfZoom <= ZOOM_MIN;
  $('zoomIn').disabled = pdfZoom >= ZOOM_MAX;
}
function zoomBy(d) { pdfZoom += d; applyZoom(); }
function zoomReset() { pdfZoom = 1; applyZoom(); }

let wideMode = false;
function setWide(on) {
  wideMode = on;
  document.body.classList.toggle('fullscreen-mode', on);
  $('fullscreenBtn').textContent = on ? '🡼 Exit full screen' : '⛶ Full screen';
}
function toggleFullscreen() {
  setWide(!wideMode);
  try {
    if (wideMode && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else if (!wideMode && document.fullscreenElement) document.exitFullscreen?.();
  } catch (_) { /* layout class still applies */ }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && wideMode) setWide(false);
});

// ---------- results ----------
async function showResults() {
  const r = await api('POST', `/api/sessions/${sessionId}/complete`);
  $('questionView').classList.add('hidden');
  $('resultsView').classList.remove('hidden');
  document.body.classList.remove('fullscreen-mode');
  clearBacklog();
  renderScorecard(r);
}

function renderScorecard(r) {
  $('rScore').textContent = r.score;
  $('rTotal').textContent = r.total;
  $('rAcc').textContent = r.accuracy + '%';
  $('rAvg').textContent = fmtTime(r.avgTimeSeconds);
  $('scoreText').textContent = `You scored ${r.score} / ${r.total}`;

  // Encouraging + funny messages regardless of score.
  let emoji = '🎉', title = 'Amazing work!', msg = '';
  if (r.accuracy >= 90) { emoji = '🏆'; title = 'Superstar!'; msg = pick(['You\'re basically an SAT wizard now. 🧙‍♀️', 'Incredible! Save some genius for the rest of us. 💖']); }
  else if (r.accuracy >= 70) { emoji = '🌟'; title = 'Great job!'; msg = pick(['So close to perfect — a little polish and you\'re unstoppable!', 'High five! ✋ Your brain did push-ups today.']); }
  else if (r.accuracy >= 50) { emoji = '💪'; title = 'Nice effort!'; msg = pick(['Every champ started here. Review the tricky ones and watch yourself soar!', 'You\'re leveling up — XP gained! 🎮']); }
  else { emoji = '🌱'; title = 'Keep growing!'; msg = pick(['Mistakes are proof you\'re trying. Future-you says thanks! 🌻', 'Plot twist: this is where the comeback story begins. 🚀']); }
  $('resultEmoji').textContent = emoji;
  $('resultTitle').textContent = title;
  let sub = msg;
  if (r.peekedCount || r.overLimitCount) {
    sub += `  (👀 ${r.peekedCount} peeked · ⏰ ${r.overLimitCount} over time)`;
  }
  $('resultMsg').textContent = sub;

  const reviewCard = $('reviewCard');
  const list = $('reviewList');
  list.innerHTML = '';
  if (!r.review.length) {
    reviewCard.innerHTML = '<h2>✅ Perfect session!</h2><p class="note">You answered every question correctly. Nothing to review — fantastic! 🎀</p>';
    return;
  }
  for (const item of r.review) {
    const div = document.createElement('div');
    div.className = 'review-item';
    const flags = `${item.peeked ? ' 👀 peeked' : ''}${item.overLimit ? ' ⏰ over time' : ''}`;
    let body = `<div style="font-weight:800; margin-bottom:6px">Question ${item.position}${flags ? ` ·${flags}` : ''}
      <span class="note">${item.skill ? '· ' + escapeHtml(item.skill) : ''} · ⏱ ${fmtTime(item.timeTaken || 0)}</span></div>`;
    if (item.image) {
      body += `<img class="review-img" src="${item.image}" alt="Question ${item.position}" />`;
      if (item.answerImage) body += `<img class="review-img" src="${item.answerImage}" alt="Answer ${item.position}" />`;
      body += `<div class="ans-row"><span class="tag-wrong">Your answer: ${escapeHtml(item.selected || '(none)')}</span>
               <span class="tag-right">Correct: ${escapeHtml(item.correct)}</span></div>`;
    } else {
      const correctText = (item.choices.find((c) => c.label === item.correct) || {}).text || item.correct;
      const yourText = (item.choices.find((c) => c.label === item.selected) || {}).text || item.selected || '(none)';
      if (item.passage) body += `<div class="passage">${escapeHtml(item.passage)}</div>`;
      body += `<div class="prompt" style="font-size:1.05rem">${escapeHtml(item.prompt)}</div>`;
      body += `<div class="ans-row"><span class="tag-wrong">Your answer: ${escapeHtml(yourText)}</span></div>`;
      body += `<div class="ans-row"><span class="tag-right">Correct: ${escapeHtml(item.correct)}. ${escapeHtml(correctText)}</span></div>`;
      if (item.explanation) body += `<div class="explanation"><b>Why:</b> ${escapeHtml(item.explanation)}</div>`;
    }
    div.innerHTML = body;
    list.appendChild(div);
  }
}

// Gentle break reminder after a long single sitting (a round can span days).
function checkBacklog() {
  const key = `sessStart_${sessionId}`;
  let start = Number(localStorage.getItem(key));
  if (!start) { start = Date.now(); localStorage.setItem(key, String(start)); }
  const mins = (Date.now() - start) / 60000;
  const remindKey = `sessRemind_${sessionId}`;
  if (mins >= 90 && !localStorage.getItem(remindKey) && (!state || !state.allResolved)) {
    localStorage.setItem(remindKey, '1');
    showToast("⏰ 90 minutes in — great focus! Take a break whenever you like; this round will be right here when you come back. 💪");
  }
}
function clearBacklog() {
  localStorage.removeItem(`sessStart_${sessionId}`);
  localStorage.removeItem(`sessRemind_${sessionId}`);
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- wire up ----------
$('prevBtn').onclick = () => gotoPosition(pos - 1);
$('nextBtn').onclick = () => gotoPosition(pos + 1);
$('submitBtn').onclick = submitAnswer;
$('skipBtn').onclick = skipCurrent;
$('skippedBtn').onclick = () => { const p = firstSkipped(); if (p) gotoPosition(p); };
$('finishBtn').onclick = () => completeAndReview();
$('pauseBtn').onclick = pauseExit;
// Close returns to wherever the session was opened from (dashboard vs home).
$('topCloseBtn').onclick = () => { location.href = getParam('return') === 'dashboard' ? '/dashboard.html' : '/'; };
$('revealBtn').onclick = peekAnswer;
$('fbNext').onclick = goNext;
$('zoomIn').onclick = () => zoomBy(ZOOM_STEP);
$('zoomOut').onclick = () => zoomBy(-ZOOM_STEP);
$('zoomReset').onclick = zoomReset;
$('fullscreenBtn').onclick = toggleFullscreen;

window.addEventListener('beforeunload', () => {
  if (!resolved && current) {
    try {
      navigator.sendBeacon(`/api/sessions/${sessionId}/progress`,
        new Blob([JSON.stringify({ position: pos, elapsed: Math.round(currentElapsed()) })], { type: 'application/json' }));
    } catch (_) { /* ignore */ }
  }
});

if (!sessionId) {
  document.querySelector('.container').innerHTML = '<div class="card center"><h2>No session selected</h2><a class="btn btn-primary" href="/">Go Home</a></div>';
} else {
  setWide(true); // full-screen practice by default
  checkBacklog();
  setInterval(checkBacklog, 60000);
  loadState().catch((e) => {
    document.querySelector('.container').innerHTML = `<div class="card center"><h2>Could not load session</h2><p class="note">${e.message}</p><a class="btn btn-primary" href="/">Go Home</a></div>`;
  });
}
