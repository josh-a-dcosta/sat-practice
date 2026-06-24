'use strict';

const { db } = require('./db');
const { TAXONOMY, isValidTopic, isValidDifficulty, domainOfTopic, topicLabel } = require('./topics');

const SESSION_SIZE = 40;
const DAILY_GOAL   = 40;
const TIME_LIMIT   = 600; // legacy default (10 min)
const TIME_LIMITS  = { medium: 600, hard: 600 }; // 10:00 per question
const SESSION_MINUTES = 90;

// Per-question time limits by round. Default is 10 minutes per question.
const ROUND_LIMITS = {
  1: { medium: 600, hard: 600 }, // 10:00 / 10:00
  2: { medium: 600, hard: 600 }, // 10:00 / 10:00
};
function timeLimitFor(difficulty) {
  return TIME_LIMITS[difficulty] || TIME_LIMIT;
}
function defaultLimitFor(round, difficulty) {
  const tbl = ROUND_LIMITS[round >= 2 ? 2 : 1];
  return tbl[difficulty] || TIME_LIMIT;
}

function totalQuestions(domain, topic, difficulty) {
  return db.prepare('SELECT COUNT(*) n FROM questions WHERE domain=? AND topic=? AND difficulty=?')
    .get(domain, topic, difficulty).n;
}
// Round = practice: one full pass through every question in a (domain, topic,
// difficulty). Each round is its own `sessions` row holding all the section's
// questions; progress comes from the per-question `status` on session_questions.
function sectionRounds(userId, domain, topic, difficulty) {
  const rows = db.prepare(`
    SELECT s.id, s.round, s.status,
           COUNT(sq.id) total,
           SUM(CASE WHEN sq.status IN ('correct','wrong','peeked','timedout') THEN 1 ELSE 0 END) resolved,
           SUM(CASE WHEN sq.status='skipped' THEN 1 ELSE 0 END) skipped,
           SUM(CASE WHEN sq.status='correct' THEN 1 ELSE 0 END) correct
    FROM sessions s
    LEFT JOIN session_questions sq ON sq.session_id = s.id
    WHERE s.user_id=? AND s.domain=? AND s.topic=? AND s.difficulty=?
    GROUP BY s.id ORDER BY s.round, s.id
  `).all(userId, domain, topic, difficulty);
  return rows.map((r) => ({
    sessionId: r.id, round: r.round, status: r.status,
    total: r.total, resolved: r.resolved, skipped: r.skipped, correct: r.correct,
    pct: r.total ? Math.round((r.resolved / r.total) * 100) : 0,
  }));
}

// The in-progress round for a section (at most one), or null.
function getActiveForSection(userId, domain, topic, difficulty) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE user_id=? AND domain=? AND topic=? AND difficulty=? AND status='in_progress'
    ORDER BY round DESC, id DESC LIMIT 1
  `).get(userId, domain, topic, difficulty) || null;
}

// The round number a NEW practice would start (called only when none is active).
function nextRoundNumber(userId, domain, topic, difficulty) {
  const r = db.prepare('SELECT MAX(round) m FROM sessions WHERE user_id=? AND domain=? AND topic=? AND difficulty=?')
    .get(userId, domain, topic, difficulty);
  return (r && r.m) ? r.m + 1 : 1;
}

// Display summary for a section: the active round (resume) or the next round to
// start, plus the per-round bars Home shows.
function roundInfo(userId, domain, topic, difficulty) {
  const total = totalQuestions(domain, topic, difficulty);
  const rounds = sectionRounds(userId, domain, topic, difficulty);
  const active = rounds.find((r) => r.status === 'in_progress') || null;
  if (active) {
    return {
      round: active.round, attempted: active.resolved, total: active.total || total,
      skipped: active.skipped, prevComplete: false,
      activeSessionId: active.sessionId, rounds,
    };
  }
  const next = rounds.length ? Math.max(...rounds.map((r) => r.round)) + 1 : 1;
  return {
    round: next, attempted: 0, total, skipped: 0,
    prevComplete: rounds.length > 0, activeSessionId: null, rounds,
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseQ(row) {
  if (!row) return null;
  return { ...row, choices: JSON.parse(row.choices) };
}

function publicQuestion(q) {
  return {
    id: q.id,
    domain: q.domain,
    topic: q.topic,
    difficulty: q.difficulty,
    passage: q.passage,
    prompt: q.prompt,
    qtype: q.qtype || 'mcq',
    image: q.image || null,
    maskFraction: q.mask_fraction != null ? q.mask_fraction : null,
    answerImage: q.answer_image || null,
    // For image questions the choice text lives in the picture, so only labels
    // are sent; for text questions we send the full choice text.
    choices: q.choices.map((c) => ({ label: c.label, text: c.text || '' })),
  };
}

// Normalize a student-produced response for tolerant comparison.
function toNumber(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/\s+/g, '');
  const frac = t.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
  if (frac) { const d = parseFloat(frac[2]); return d ? parseFloat(frac[1]) / d : NaN; }
  if (t.endsWith('%')) { const v = parseFloat(t.slice(0, -1)); return isNaN(v) ? NaN : v / 100; }
  return parseFloat(t);
}

function sprIsCorrect(selected, acceptableJson) {
  let acceptable;
  try { acceptable = JSON.parse(acceptableJson); } catch (_) { acceptable = [acceptableJson]; }
  if (!Array.isArray(acceptable)) acceptable = [acceptable];
  const norm = (x) => String(x).trim().replace(/\s+/g, '').toLowerCase();
  const sel = norm(selected);
  if (!sel) return false;
  for (const a of acceptable) {
    if (norm(a) === sel) return true;
    const an = toNumber(a), sn = toNumber(selected);
    if (!isNaN(an) && !isNaN(sn)) {
      const tol = Math.max(0.001, Math.abs(an) * 0.01);
      if (Math.abs(an - sn) <= tol) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// catalogue: what's available per topic+difficulty
// ---------------------------------------------------------------------------
function getCatalogue(userId) {
  const counts = db.prepare(`
    SELECT domain, topic, difficulty, COUNT(*) total FROM questions
    GROUP BY domain, topic, difficulty
  `).all();

  const mastered = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty, COUNT(DISTINCT a.question_id) n
    FROM attempts a JOIN questions q ON q.id = a.question_id
    WHERE a.is_correct = 1 AND a.user_id = ?
    GROUP BY q.domain, q.topic, q.difficulty
  `).all(userId);

  const masteredMap = {};
  for (const r of mastered) masteredMap[`${r.domain}|${r.topic}|${r.difficulty}`] = r.n;

  const catalogue = [];
  for (const [domain, domainDef] of Object.entries(TAXONOMY)) {
    for (const [topic, topicName] of Object.entries(domainDef.topics)) {
      for (const difficulty of ['medium', 'hard']) {
        const key = `${domain}|${topic}|${difficulty}`;
        const countRow = counts.find((r) => r.domain === domain && r.topic === topic && r.difficulty === difficulty);
        const total = countRow ? countRow.total : 0;
        const masteredN = masteredMap[key] || 0;
        const ri = total > 0 ? roundInfo(userId, domain, topic, difficulty)
                             : { round: 1, attempted: 0, total: 0, skipped: 0, prevComplete: false, activeSessionId: null, rounds: [] };
        catalogue.push({
          domain, topic, topicName, difficulty,
          total, mastered: masteredN,
          available: total > 0,
          activeSessionId: ri.activeSessionId,
          round: ri.round,             // round Start/Resume will use
          roundAttempted: ri.attempted,
          roundTotal: ri.total,
          roundSkipped: ri.skipped,
          prevComplete: ri.prevComplete,
          rounds: ri.rounds,           // per-round bars for Home
          defaultTimeLimit: defaultLimitFor(ri.round, difficulty),
        });
      }
    }
  }
  return catalogue;
}

// Per-skill mastery across ALL of a user's attempts, for the Home breakdown.
function getSkillCatalogue(userId) {
  const rows = db.prepare("SELECT id, domain, topic, difficulty, COALESCE(skill,'(unspecified)') skill FROM questions").all();
  const mastered = new Set(db.prepare('SELECT DISTINCT question_id id FROM attempts WHERE user_id=? AND is_correct=1').all(userId).map((r) => r.id));
  const attempted = new Set(db.prepare('SELECT DISTINCT question_id id FROM attempts WHERE user_id=?').all(userId).map((r) => r.id));
  const map = {};
  for (const q of rows) {
    const k = `${q.domain}|${q.topic}|${q.difficulty}|${q.skill}`;
    if (!map[k]) map[k] = { domain: q.domain, topic: q.topic, difficulty: q.difficulty, skill: q.skill, total: 0, mastered: 0, attempted: 0 };
    map[k].total++;
    if (mastered.has(q.id)) map[k].mastered++;
    if (attempted.has(q.id)) map[k].attempted++;
  }
  return Object.values(map);
}

function getTodayProgress(userId) {
  // A question resolved today (correct/wrong/peeked/timedout) counts toward the
  // daily goal; skips don't (they're deferred, not done).
  const rows = db.prepare(`
    SELECT domain, COUNT(*) n
    FROM activity_events
    WHERE user_id = ? AND status != 'skipped'
      AND date(occurred_at) = date('now','localtime')
    GROUP BY domain
  `).all(userId);
  let mathToday = 0, readingToday = 0;
  for (const r of rows) { if (r.domain === 'math') mathToday = r.n; else if (r.domain === 'reading') readingToday = r.n; }
  const perDomain = DAILY_GOAL; // 40 math + 40 reading on practice days
  const answeredToday = mathToday + readingToday;
  return {
    answeredToday, mathToday, readingToday,
    goalPerDomain: perDomain, goal: perDomain * 2,
    mathMet: mathToday >= perDomain, readingMet: readingToday >= perDomain,
    met: mathToday >= perDomain && readingToday >= perDomain,
  };
}

// ---------------------------------------------------------------------------
// question selection for a session
// ---------------------------------------------------------------------------
// A round is a full pass through the whole section, so a fresh round seeds ALL
// of the section's questions, shuffled (so no two users get the same order).
function selectQuestions(domain, topic, difficulty) {
  const all = db.prepare(
    'SELECT id FROM questions WHERE domain=? AND topic=? AND difficulty=?'
  ).all(domain, topic, difficulty).map((r) => r.id);
  return shuffle(all);
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
// Every in-progress round across all sections (many may be open at once — one
// per section). Used by Home to show "resume" targets.
function listActiveSessions(userId) {
  const rows = db.prepare(`
    SELECT * FROM sessions WHERE user_id=? AND status='in_progress'
    ORDER BY (domain='math') DESC, topic, difficulty
  `).all(userId);
  return rows.map((a) => {
    const st = getSessionState(userId, a.id);
    return {
      id: a.id, domain: a.domain, topic: a.topic, difficulty: a.difficulty,
      round: a.round, topicName: topicLabel(a.topic),
      answeredCount: st ? st.resolvedCount : 0,
      skippedCount: st ? st.skippedCount : 0,
      total: st ? st.total : 0,
    };
  });
}

function createOrResumeSession(userId, domain, topic, difficulty, opts = {}) {
  // One in-progress round per section: resume it if present.
  const active = getActiveForSection(userId, domain, topic, difficulty);
  if (active) {
    return { id: active.id, resumed: true, size: countSQ(active.id), round: active.round };
  }

  const round = nextRoundNumber(userId, domain, topic, difficulty);
  const ids = selectQuestions(domain, topic, difficulty);
  if (!ids.length) {
    const e = new Error(`No questions available for ${topicLabel(topic)} ${difficulty}. Upload questions for this section.`);
    e.status = 409; throw e;
  }

  let tl = Number(opts.timeLimitSeconds);
  if (!tl || tl < 5) tl = defaultLimitFor(round, difficulty);
  tl = Math.max(10, Math.min(Math.round(tl), 3600));

  db.exec('BEGIN');
  try {
    const info = db.prepare(
      'INSERT INTO sessions (user_id, domain, topic, difficulty, round, time_limit_seconds) VALUES (?,?,?,?,?,?)'
    ).run(userId, domain, topic, difficulty, round, tl);
    const sid = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO session_questions (session_id,question_id,position) VALUES (?,?,?)');
    ids.forEach((qid, i) => ins.run(sid, qid, i + 1));
    db.exec('COMMIT');
    return { id: sid, resumed: false, size: ids.length, round };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function countSQ(sid) {
  return db.prepare('SELECT COUNT(*) n FROM session_questions WHERE session_id=?').get(sid).n;
}

function getSessionRow(userId, sid) {
  return db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=?').get(sid, userId);
}

const TERMINAL = ['correct', 'wrong', 'peeked', 'timedout'];
function isTerminal(status) { return TERMINAL.indexOf(status) >= 0; }

function getSessionState(userId, sid) {
  const s = getSessionRow(userId, sid);
  if (!s) return null;
  const items = db.prepare(`
    SELECT sq.position, sq.question_id, sq.status,
           a.is_correct, a.peeked, a.over_limit
    FROM session_questions sq
    LEFT JOIN attempts a ON a.session_id=sq.session_id AND a.question_id=sq.question_id
    WHERE sq.session_id=? ORDER BY sq.position
  `).all(sid);

  const counts = { pending: 0, correct: 0, wrong: 0, peeked: 0, timedout: 0, skipped: 0 };
  for (const r of items) counts[r.status] = (counts[r.status] || 0) + 1;
  const resolvedCount = counts.correct + counts.wrong + counts.peeked + counts.timedout;
  const skippedCount = counts.skipped;
  const pendingCount = counts.pending;

  return {
    id: s.id, domain: s.domain, topic: s.topic, difficulty: s.difficulty,
    round: s.round, status: s.status, currentPosition: s.current_position,
    total: items.length, resolvedCount, skippedCount, pendingCount, counts,
    // Round is done only when nothing is left pending OR skipped.
    allResolved: items.length > 0 && resolvedCount === items.length,
    answeredCount: resolvedCount, // legacy alias
    allAnswered: items.length > 0 && resolvedCount === items.length,
    items: items.map((r) => ({
      position: r.position,
      status: r.status,
      resolved: isTerminal(r.status),
      answered: isTerminal(r.status), // legacy alias
      skipped: r.status === 'skipped',
      correct: r.status === 'correct' ? true : (isTerminal(r.status) ? false : null),
      peeked: r.status === 'peeked' || !!r.peeked,
      overLimit: r.status === 'timedout' || !!r.over_limit,
    })),
  };
}

// Positions still needing work (pending first, then skipped) for "next" routing.
function remainingPositions(sid) {
  return db.prepare(`
    SELECT position FROM session_questions
    WHERE session_id=? AND status IN ('pending','skipped')
    ORDER BY (status='pending') DESC, position
  `).all(sid).map((r) => r.position);
}

function runningScore(sid) {
  const r = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('correct','wrong','peeked','timedout') THEN 1 ELSE 0 END) answered,
      SUM(CASE WHEN status='correct' THEN 1 ELSE 0 END) score
    FROM session_questions WHERE session_id=?
  `).get(sid);
  const answered = r.answered || 0, score = r.score || 0;
  const total = countSQ(sid);
  // Accuracy counts peeked/timedout as not-correct (still tracked separately).
  return { answered, score, total, accuracy: answered ? Math.round((score / answered) * 100) : 0 };
}

// Reveal info for a resolved question (correct answer, rationale, flags).
function attemptFeedback(q, attempt) {
  let correctDisplay = q.correct, correctLabel = null;
  if (q.qtype === 'spr') {
    try { correctDisplay = JSON.parse(q.correct).join(', '); } catch (_) { /* keep raw */ }
  } else {
    correctLabel = q.correct;
    const c = q.choices.find((x) => x.label === q.correct);
    correctDisplay = c ? `${c.label}. ${c.text || ''}`.trim() : q.correct;
  }
  return {
    isCorrect: !!attempt.is_correct,
    peeked: !!attempt.peeked,
    overLimit: !!attempt.over_limit,
    correct: correctDisplay,
    correctLabel,
    explanation: q.explanation || null,
    answerImage: q.answer_image || null,
    selected: attempt.selected || '',
    timeTaken: attempt.time_taken_seconds,
  };
}

function getQuestionAt(userId, sid, position) {
  const srow = getSessionRow(userId, sid);
  if (!srow) return null;
  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id=? AND position=?').get(sid, position);
  if (!sq) return null;
  const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(sq.question_id));
  const attempt = db.prepare('SELECT * FROM attempts WHERE session_id=? AND question_id=?').get(sid, sq.question_id);
  const state = getSessionState(userId, sid);
  const limit = srow.time_limit_seconds || timeLimitFor(q.difficulty);
  const out = {
    position, total: state.total, answeredCount: state.answeredCount,
    resolvedCount: state.resolvedCount, skippedCount: state.skippedCount,
    pendingCount: state.pendingCount, round: srow.round,
    status: sq.status,
    question: publicQuestion(q),
    timeLimit: limit,
    elapsedSeconds: attempt ? attempt.time_taken_seconds : (sq.elapsed_seconds || 0),
    peeked: !!sq.peeked || (attempt ? !!attempt.peeked : false),
    answered: !!attempt,
    skipped: sq.status === 'skipped',
    selected: attempt ? attempt.selected : null,
    running: runningScore(sid),
  };
  // Resolved questions reveal the answer; unanswered ones never include it.
  if (attempt) out.feedback = attemptFeedback(q, attempt);
  return out;
}

function setCurrentPosition(userId, sid, position) {
  db.prepare("UPDATE sessions SET current_position=? WHERE id=? AND user_id=? AND status='in_progress'").run(position, sid, userId);
}

// Persist time spent on a (still unresolved) question so a pause/resume keeps it.
function saveProgress(userId, sid, position, elapsed) {
  if (!getSessionRow(userId, sid)) return false;
  const e = Math.max(0, Math.min(Number(elapsed) || 0, 36000));
  db.prepare('UPDATE session_questions SET elapsed_seconds=? WHERE session_id=? AND position=?').run(e, sid, position);
  return true;
}

// Log one row in the daily activity feed (calendar / weekly report source).
function logEvent(userId, sid, q, round, status, selected, timeTaken, overLimit) {
  db.prepare(`
    INSERT INTO activity_events
      (user_id, session_id, question_id, domain, topic, difficulty, skill, round,
       status, selected, time_taken_seconds, over_limit)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, sid, q.id, q.domain, q.topic, q.difficulty, q.skill || null, round,
         status, selected || '', Math.max(0, Math.round(timeTaken || 0)), overLimit ? 1 : 0);
}

// Mark the round complete once every question is resolved (nothing pending/skipped).
function maybeComplete(sid) {
  const left = db.prepare(
    "SELECT COUNT(*) n FROM session_questions WHERE session_id=? AND status IN ('pending','skipped')"
  ).get(sid).n;
  if (left === 0) {
    const score = db.prepare("SELECT COUNT(*) n FROM session_questions WHERE session_id=? AND status='correct'").get(sid).n;
    db.prepare("UPDATE sessions SET status='completed', completed_at=datetime('now'), score=? WHERE id=? AND status='in_progress'").run(score, sid);
  }
}

// Resolve a question once — by answering, peeking, or timing out. A previously
// skipped question can be resolved later (status flips from skipped to terminal).
function resolveQuestion(userId, sid, questionId, opts) {
  const s = getSessionRow(userId, sid);
  if (!s) { const e = new Error('Session not found'); e.status = 404; throw e; }
  if (s.status !== 'in_progress') { const e = new Error('Session already completed.'); e.status = 409; throw e; }
  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id=? AND question_id=?').get(sid, questionId);
  if (!sq) { const e = new Error('Question not in this session.'); e.status = 400; throw e; }
  const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(questionId));
  const limit = s.time_limit_seconds || timeLimitFor(q.difficulty);

  let attempt = db.prepare('SELECT * FROM attempts WHERE session_id=? AND question_id=?').get(sid, questionId);
  if (!attempt) {
    const elapsed = Math.max(0, Math.min(Number(opts.elapsed) || 0, 36000));
    const overLimit = (opts.timedOut || elapsed > limit + 1) ? 1 : 0;
    const peeked = opts.peeked ? 1 : 0;
    let selected = '', isCorrect = 0;
    if (!opts.peeked && !opts.timedOut && opts.selected != null && String(opts.selected) !== '') {
      selected = String(opts.selected);
      isCorrect = (q.qtype === 'spr') ? (sprIsCorrect(selected, q.correct) ? 1 : 0) : (q.correct === selected ? 1 : 0);
    }
    const status = peeked ? 'peeked' : (opts.timedOut ? 'timedout' : (isCorrect ? 'correct' : 'wrong'));

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO attempts (user_id, session_id, question_id, selected, is_correct, time_taken_seconds, over_limit, peeked)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(userId, sid, questionId, selected, isCorrect, elapsed, overLimit, peeked);
      db.prepare("UPDATE session_questions SET status=?, peeked=?, elapsed_seconds=?, resolved_at=datetime('now') WHERE id=?")
        .run(status, peeked, elapsed, sq.id);
      logEvent(userId, sid, q, s.round, status, selected, elapsed, overLimit);
      maybeComplete(sid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    attempt = db.prepare('SELECT * FROM attempts WHERE session_id=? AND question_id=?').get(sid, questionId);
  }
  const state = getSessionState(userId, sid);
  return {
    resolved: true,
    ...attemptFeedback(q, attempt),
    timeLimit: limit,
    running: runningScore(sid),
    answeredCount: state.answeredCount, resolvedCount: state.resolvedCount,
    skippedCount: state.skippedCount, total: state.total,
    allResolved: state.allResolved, allAnswered: state.allAnswered,
    remaining: remainingPositions(sid),
  };
}

// Defer a question without resolving it. Logged as a skip event each time; the
// question stays selectable until it's actually resolved.
function skipQuestion(userId, sid, questionId, timeTaken) {
  const s = getSessionRow(userId, sid);
  if (!s) { const e = new Error('Session not found'); e.status = 404; throw e; }
  if (s.status !== 'in_progress') { const e = new Error('Session already completed.'); e.status = 409; throw e; }
  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id=? AND question_id=?').get(sid, questionId);
  if (!sq) { const e = new Error('Question not in this session.'); e.status = 400; throw e; }
  if (isTerminal(sq.status)) { const e = new Error('Question already resolved.'); e.status = 409; throw e; }
  const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(questionId));
  const elapsed = Math.max(0, Math.min(Number(timeTaken) || 0, 36000));

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE session_questions SET status='skipped', elapsed_seconds=? WHERE id=?").run(elapsed, sq.id);
    logEvent(userId, sid, q, s.round, 'skipped', '', elapsed, 0);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const state = getSessionState(userId, sid);
  return {
    skipped: true,
    resolvedCount: state.resolvedCount, skippedCount: state.skippedCount,
    pendingCount: state.pendingCount, total: state.total,
    remaining: remainingPositions(sid),
  };
}

function submitAnswer(userId, sid, questionId, selected, timeTaken) {
  return resolveQuestion(userId, sid, questionId, { selected, elapsed: timeTaken });
}
function peekQuestion(userId, sid, questionId, timeTaken) {
  return resolveQuestion(userId, sid, questionId, { peeked: true, elapsed: timeTaken });
}
function timeoutQuestion(userId, sid, questionId, timeTaken) {
  return resolveQuestion(userId, sid, questionId, { timedOut: true, elapsed: timeTaken });
}

function completeSession(userId, sid) {
  const s = getSessionRow(userId, sid);
  if (!s) { const e = new Error('Session not found'); e.status = 404; throw e; }

  const state = getSessionState(userId, sid);
  if (!state.allResolved) {
    const left = state.pendingCount + state.skippedCount;
    const e = new Error(`Finish ${left} more question${left === 1 ? '' : 's'} (including any you skipped) before completing this round.`);
    e.status = 409; e.remaining = remainingPositions(sid); throw e;
  }

  const attempts = db.prepare(`
    SELECT a.question_id, a.selected, a.is_correct, a.time_taken_seconds,
           a.over_limit, a.peeked, sq.position
    FROM attempts a JOIN session_questions sq
      ON sq.session_id=a.session_id AND sq.question_id=a.question_id
    WHERE a.session_id=? ORDER BY sq.position
  `).all(sid);

  const score = attempts.filter((a) => a.is_correct).length;
  const totalTime = attempts.reduce((acc, a) => acc + a.time_taken_seconds, 0);
  const peekedCount = attempts.filter((a) => a.peeked).length;
  const overLimitCount = attempts.filter((a) => a.over_limit).length;

  if (s.status !== 'completed') {
    db.prepare("UPDATE sessions SET status='completed', completed_at=datetime('now'), score=? WHERE id=?").run(score, sid);
  }

  const review = attempts.filter((a) => !a.is_correct).map((a) => {
    const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(a.question_id));
    let correctDisplay = q.correct;
    if (q.qtype === 'spr') {
      try { correctDisplay = JSON.parse(q.correct).join(', '); } catch (_) { /* keep raw */ }
    }
    return {
      position: a.position, passage: q.passage, prompt: q.prompt,
      qtype: q.qtype, image: q.image, answerImage: q.answer_image,
      skill: q.skill, difficulty: q.difficulty,
      timeTaken: a.time_taken_seconds, overLimit: !!a.over_limit, peeked: !!a.peeked,
      choices: q.choices, selected: a.selected, correct: correctDisplay, explanation: q.explanation,
    };
  });

  return {
    sessionId: sid, domain: s.domain, topic: s.topic, difficulty: s.difficulty,
    round: s.round,
    score, total: attempts.length,
    accuracy: attempts.length ? Math.round((score / attempts.length) * 100) : 0,
    totalTimeSeconds: totalTime,
    avgTimeSeconds: attempts.length ? Math.round(totalTime / attempts.length) : 0,
    peekedCount, overLimitCount,
    review,
  };
}

// Full review of a single past attempt: question + the student's answer + the
// correct answer/rationale fully revealed (used by the dashboard click-through).
function getAttemptReview(userId, attemptId) {
  const a = db.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').get(attemptId, userId);
  if (!a) return null;
  const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(a.question_id));
  if (!q) return null;

  let correctDisplay = q.correct;
  if (q.qtype === 'spr') {
    try { correctDisplay = JSON.parse(q.correct).join(', '); } catch (_) { /* keep raw */ }
  }
  return {
    attemptId: a.id,
    domain: q.domain, topic: q.topic, difficulty: q.difficulty,
    skill: q.skill || null, test: q.test || 'SAT',
    qtype: q.qtype || 'mcq',
    image: q.image || null,        // full, unmasked page (rationale visible)
    answerImage: q.answer_image || null,
    passage: q.passage, prompt: q.prompt,
    choices: q.choices,
    selected: a.selected,
    correct: correctDisplay,
    isCorrect: !!a.is_correct,
    explanation: q.explanation || null,
    timeTaken: a.time_taken_seconds,
    answeredAt: a.answered_at,
  };
}

// ---------------------------------------------------------------------------
// activity log: per-day status counts, daily summaries, current-state skills
// ---------------------------------------------------------------------------
function correctDisplay(q) {
  if (q.qtype === 'spr') {
    try { return JSON.parse(q.correct).join(', '); } catch (_) { return q.correct; }
  }
  return q.correct;
}

const STATUS_LABEL = {
  correct: 'Correct', wrong: 'Wrong', peeked: 'Peeked', timedout: 'Over time', skipped: 'Skipped',
};

// Per-day status counts + the practices (rounds touched) that day. Drives the
// calendar and daily summaries; "full test" days will tag the same way later.
function getDailyActivity(userId) {
  const dayRows = db.prepare(`
    SELECT date(occurred_at,'localtime') day, status, COUNT(*) n
    FROM activity_events WHERE user_id=?
    GROUP BY day, status
  `).all(userId);

  const practiceRows = db.prepare(`
    SELECT date(occurred_at,'localtime') day, session_id, domain, topic, difficulty, round,
           COUNT(*) events,
           SUM(CASE WHEN status='correct'  THEN 1 ELSE 0 END) correct,
           SUM(CASE WHEN status='wrong'    THEN 1 ELSE 0 END) wrong,
           SUM(CASE WHEN status='peeked'   THEN 1 ELSE 0 END) peeked,
           SUM(CASE WHEN status='timedout' THEN 1 ELSE 0 END) timedout,
           SUM(CASE WHEN status='skipped'  THEN 1 ELSE 0 END) skipped
    FROM activity_events WHERE user_id=?
    GROUP BY date(occurred_at,'localtime'), session_id
    ORDER BY day, session_id
  `).all(userId);

  const days = {};
  const blank = () => ({ correct: 0, wrong: 0, peeked: 0, timedout: 0, skipped: 0 });
  for (const r of dayRows) {
    days[r.day] = days[r.day] || { day: r.day, counts: blank(), practices: [], tags: ['practice'] };
    days[r.day].counts[r.status] = r.n;
  }
  for (const p of practiceRows) {
    days[p.day] = days[p.day] || { day: p.day, counts: blank(), practices: [], tags: ['practice'] };
    days[p.day].practices.push({
      sessionId: p.session_id, domain: p.domain, topic: p.topic, topicName: topicLabel(p.topic),
      difficulty: p.difficulty, round: p.round, events: p.events,
      correct: p.correct, wrong: p.wrong, peeked: p.peeked, timedout: p.timedout, skipped: p.skipped,
    });
  }
  return Object.values(days)
    .map((d) => {
      const c = d.counts;
      const resolved = c.correct + c.wrong + c.peeked + c.timedout;
      return { ...d, resolved, total: resolved + c.skipped,
               accuracy: resolved ? Math.round((c.correct / resolved) * 100) : 0 };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}

// A short, encouraging per-day note built from that day's counts.
function buildDailySummaries(dailyActivity) {
  return dailyActivity.map((d) => {
    const c = d.counts;
    const review = c.wrong + c.peeked + c.timedout;
    const sections = [...new Set(d.practices.map((p) => `${p.topicName} (${p.difficulty})`))];
    const parts = [];
    parts.push(`You worked through ${d.total} question${d.total === 1 ? '' : 's'}.`);
    if (d.resolved) parts.push(`✅ ${c.correct} correct (${d.accuracy}%).`);
    if (review) parts.push(`📚 ${review} to review.`);
    if (c.skipped) parts.push(`⏭ ${c.skipped} skipped to revisit.`);
    if (sections.length) parts.push(`Focus: ${sections.slice(0, 3).join(', ')}.`);
    parts.push('Keep it up! 💪');
    return { day: d.day, counts: c, total: d.total, resolved: d.resolved,
             accuracy: d.accuracy, sections, text: parts.join(' ') };
  });
}

// "Skills to focus on" — the GRAND current state: for each question take its
// latest result across all rounds (a question wrong in R1 then correct in R2
// counts as correct now), then roll up per skill, weakest first.
function getSkillFocus(userId) {
  const rows = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty, COALESCE(q.skill,'(unspecified)') skill, ae.status,
           ae.time_taken_seconds
    FROM activity_events ae
    JOIN (
      SELECT question_id, MAX(id) mid
      FROM activity_events
      WHERE user_id=? AND status!='skipped'
      GROUP BY question_id
    ) m ON m.mid = ae.id
    JOIN questions q ON q.id = ae.question_id
  `).all(userId);

  const map = {};
  for (const r of rows) {
    const k = `${r.domain}|${r.topic}|${r.difficulty}|${r.skill}`;
    if (!map[k]) map[k] = { domain: r.domain, topic: r.topic, topicName: topicLabel(r.topic),
                            difficulty: r.difficulty, skill: r.skill,
                            resolved: 0, correct: 0, wrong: 0, peeked: 0, timedout: 0, timeSum: 0 };
    const m = map[k];
    m.resolved++; m[r.status] = (m[r.status] || 0) + 1; m.timeSum += r.time_taken_seconds || 0;
  }
  return Object.values(map).map((m) => ({
    ...m,
    accuracy: m.resolved ? Math.round((m.correct / m.resolved) * 100) : 0,
    avgTime: m.resolved ? Math.round(m.timeSum / m.resolved) : 0,
  })).sort((a, b) => a.accuracy - b.accuracy || b.resolved - a.resolved);
}

function getDailySummaries(userId) {
  return buildDailySummaries(getDailyActivity(userId));
}

// Event feed for the Filtered List (includes skips). One row per action.
function getActivityFeed(userId) {
  const rows = db.prepare(`
    SELECT ae.id, ae.question_id, date(ae.occurred_at,'localtime') day, ae.occurred_at,
           ae.round, ae.domain, ae.topic, ae.difficulty,
           COALESCE(ae.skill,'(unspecified)') skill, ae.status, ae.selected,
           ae.time_taken_seconds, q.correct, q.qtype, substr(q.prompt,1,90) prompt
    FROM activity_events ae JOIN questions q ON q.id = ae.question_id
    WHERE ae.user_id=?
    ORDER BY ae.occurred_at DESC, ae.id DESC
  `).all(userId);
  return rows.map((r) => ({
    id: r.id, questionId: r.question_id, day: r.day, occurredAt: r.occurred_at,
    round: r.round, domain: r.domain, topic: r.topic, topicName: topicLabel(r.topic),
    difficulty: r.difficulty, skill: r.skill, status: r.status, statusLabel: STATUS_LABEL[r.status] || r.status,
    selected: r.selected, correct: correctDisplay(r), timeTaken: r.time_taken_seconds,
  }));
}

// Full review of a question by id (for Filtered List rows, incl. skipped ones
// that have no attempt): the question + her most recent answer for it.
function getQuestionReview(userId, questionId) {
  const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(questionId));
  if (!q) return null;
  const last = db.prepare(`
    SELECT status, selected, time_taken_seconds, occurred_at
    FROM activity_events WHERE user_id=? AND question_id=?
    ORDER BY id DESC LIMIT 1
  `).get(userId, questionId);
  return {
    questionId: q.id, domain: q.domain, topic: q.topic, difficulty: q.difficulty,
    skill: q.skill || null, test: q.test || 'SAT', qtype: q.qtype || 'mcq',
    image: q.image || null, answerImage: q.answer_image || null,
    passage: q.passage, prompt: q.prompt, choices: q.choices,
    selected: last ? last.selected : '', status: last ? last.status : null,
    correct: correctDisplay(q),
    isCorrect: last ? last.status === 'correct' : false,
    explanation: q.explanation || null,
    timeTaken: last ? last.time_taken_seconds : 0,
    answeredAt: last ? last.occurred_at : null,
  };
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------
function getDashboard(userId) {
  const catalogue = getCatalogue(userId);
  const overall = db.prepare(`
    SELECT COUNT(*) attempts, SUM(is_correct) correct,
           SUM(CASE WHEN is_correct=0 THEN 1 ELSE 0 END) wrong,
           COALESCE(AVG(time_taken_seconds),0) avg_time
    FROM attempts WHERE user_id=?
  `).get(userId);

  const byDay = db.prepare(`
    SELECT date(answered_at) day, COUNT(*) total,
           SUM(is_correct) correct, SUM(CASE WHEN is_correct=0 THEN 1 ELSE 0 END) wrong
    FROM attempts WHERE user_id=? GROUP BY date(answered_at) ORDER BY day
  `).all(userId);

  const byTopic = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty,
           COUNT(*) attempts, SUM(a.is_correct) correct,
           COALESCE(AVG(a.time_taken_seconds),0) avg_time
    FROM attempts a JOIN questions q ON q.id=a.question_id
    WHERE a.user_id=?
    GROUP BY q.domain, q.topic, q.difficulty
    ORDER BY q.domain, q.topic, q.difficulty
  `).all(userId);

  // Per-skill performance so she can see exactly which skills need work.
  const bySkill = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty, COALESCE(q.skill,'(unspecified)') skill,
           COUNT(*) attempts, SUM(a.is_correct) correct,
           SUM(CASE WHEN a.is_correct=0 THEN 1 ELSE 0 END) wrong,
           COALESCE(AVG(a.time_taken_seconds),0) avg_time
    FROM attempts a JOIN questions q ON q.id=a.question_id
    WHERE a.user_id=?
    GROUP BY q.domain, q.topic, q.difficulty, q.skill
    ORDER BY (CAST(SUM(a.is_correct) AS REAL)/COUNT(*)) ASC, attempts DESC
  `).all(userId);

  const sessions = db.prepare(`
    SELECT s.id, s.domain, s.topic, s.difficulty, s.status, s.created_at, s.completed_at, s.score,
           (SELECT COUNT(*) FROM session_questions sq WHERE sq.session_id=s.id) total,
           (SELECT COUNT(*) FROM attempts a WHERE a.session_id=s.id) answered
    FROM sessions s WHERE s.user_id=? ORDER BY s.created_at DESC
  `).all(userId);

  const attemptRows = db.prepare(`
    SELECT a.id, a.session_id, a.answered_at, q.domain, q.topic, q.difficulty,
           COALESCE(q.skill,'(unspecified)') skill, q.test, COALESCE(s.round,1) round,
           substr(q.prompt,1,90) prompt, a.selected, q.correct, a.is_correct,
           a.time_taken_seconds, a.over_limit, a.peeked
    FROM attempts a
    JOIN questions q ON q.id=a.question_id
    LEFT JOIN sessions s ON s.id=a.session_id
    WHERE a.user_id=?
    ORDER BY a.answered_at DESC
  `).all(userId);

  // Weekly trends (week = ISO %Y-%W) for accuracy + timing, by domain and skill.
  const weeklyByDomain = db.prepare(`
    SELECT strftime('%Y-%W', a.answered_at) week, MIN(date(a.answered_at)) week_start,
           q.domain, COUNT(*) attempts, SUM(a.is_correct) correct,
           COALESCE(AVG(a.time_taken_seconds),0) avg_time
    FROM attempts a JOIN questions q ON q.id=a.question_id
    WHERE a.user_id=?
    GROUP BY week, q.domain ORDER BY week, q.domain
  `).all(userId);

  const weeklyBySkill = db.prepare(`
    SELECT strftime('%Y-%W', a.answered_at) week, MIN(date(a.answered_at)) week_start,
           q.domain, q.topic, q.difficulty, COALESCE(q.skill,'(unspecified)') skill,
           COUNT(*) attempts, SUM(a.is_correct) correct,
           SUM(a.over_limit) over_limit, SUM(a.peeked) peeked,
           COALESCE(AVG(a.time_taken_seconds),0) avg_time
    FROM attempts a JOIN questions q ON q.id=a.question_id
    WHERE a.user_id=?
    GROUP BY week, q.domain, q.topic, q.difficulty, q.skill
    ORDER BY week, q.domain, q.skill
  `).all(userId);

  const dailyActivity = getDailyActivity(userId);

  return {
    today: getTodayProgress(userId),
    catalogue,
    overall: {
      attempts: overall.attempts || 0,
      correct: overall.correct || 0,
      wrong: overall.wrong || 0,
      accuracy: overall.attempts ? Math.round((overall.correct / overall.attempts) * 100) : 0,
      avgTime: Math.round(overall.avg_time || 0),
    },
    byDay, byTopic, bySkill, sessions, attempts: attemptRows,
    weeklyByDomain, weeklyBySkill,
    weeklyReports: buildWeeklyReports(weeklyByDomain, weeklyBySkill),
    // Round/practice restructure: activity-log views (all statuses, all history).
    dailyActivity,
    dailySummaries: buildDailySummaries(dailyActivity),
    skillFocus: getSkillFocus(userId),
    activity: getActivityFeed(userId),
  };
}

// ---------------------------------------------------------------------------
// Weekly plain-English report (per week): strengths, focus areas, timing.
// ---------------------------------------------------------------------------
function buildWeeklyReports(weeklyByDomain, weeklyBySkill) {
  const weeks = {};
  for (const r of weeklyByDomain) {
    weeks[r.week] = weeks[r.week] || { week: r.week, weekStart: r.week_start, domains: [], skills: [] };
    weeks[r.week].domains.push(r);
  }
  for (const r of weeklyBySkill) {
    weeks[r.week] = weeks[r.week] || { week: r.week, weekStart: r.week_start, domains: [], skills: [] };
    weeks[r.week].skills.push(r);
  }
  const fmtPct = (c, n) => (n ? Math.round((c / n) * 100) : 0);
  const out = [];
  for (const w of Object.values(weeks).sort((a, b) => b.week.localeCompare(a.week))) {
    const skills = w.skills.map((s) => ({
      ...s, acc: fmtPct(s.correct, s.attempts), avg: Math.round(s.avg_time),
      label: `${topicLabel(s.topic)} · ${s.skill} (${s.difficulty})`,
    }));
    const enough = skills.filter((s) => s.attempts >= 3);
    const pool = enough.length ? enough : skills;
    const strengths = [...pool].sort((a, b) => b.acc - a.acc).slice(0, 3).filter((s) => s.acc >= 70);
    const focus = [...pool].sort((a, b) => a.acc - b.acc).slice(0, 3).filter((s) => s.acc < 70);
    const slow = [...skills].sort((a, b) => b.avg - a.avg).slice(0, 2).filter((s) => s.avg > 0);
    const totalA = w.domains.reduce((x, d) => x + d.attempts, 0);
    const totalC = w.domains.reduce((x, d) => x + d.correct, 0);

    const lines = [];
    lines.push(`You answered ${totalA} questions this week at ${fmtPct(totalC, totalA)}% overall accuracy.`);
    if (strengths.length) lines.push(`💪 Strong: ${strengths.map((s) => `${s.label} ${s.acc}%`).join('; ')}.`);
    if (focus.length) lines.push(`🎯 Work on: ${focus.map((s) => `${s.label} ${s.acc}%`).join('; ')}. Try a focused set of ~10 of these.`);
    if (slow.length) lines.push(`⏱️ Slowest: ${slow.map((s) => `${s.label} (~${Math.round(s.avg)}s/q)`).join('; ')} — practice for speed.`);
    if (!strengths.length && !focus.length) lines.push('Keep going — a bit more practice will reveal your trends!');

    out.push({ week: w.week, weekStart: w.weekStart, text: lines.join(' '), strengths, focus, slow, domains: w.domains });
  }
  return out;
}

// ---------------------------------------------------------------------------
// tasks + improvement plan (Wed/Sat focus work)
// ---------------------------------------------------------------------------
function listTasks(userId) {
  return db.prepare(`
    SELECT * FROM tasks WHERE user_id=?
    ORDER BY (status='done'), COALESCE(due_date,'9999'), id
  `).all(userId);
}

function addTask(userId, t) {
  const info = db.prepare(`
    INSERT INTO tasks (user_id, due_date, domain, topic, difficulty, skill, title, detail)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(userId, t.due_date || null, t.domain || null, t.topic || null,
         t.difficulty || null, t.skill || null, String(t.title || 'Practice task'), t.detail || null);
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(info.lastInsertRowid));
}

function setTaskStatus(userId, taskId, status) {
  const st = status === 'done' ? 'done' : 'open';
  db.prepare(`UPDATE tasks SET status=?, completed_at=CASE WHEN ?='done' THEN datetime('now') ELSE NULL END
              WHERE id=? AND user_id=?`).run(st, st, taskId, userId);
  return db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId, userId);
}

function deleteTask(userId, taskId) {
  db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(taskId, userId);
  return { ok: true };
}

function nextWeekday(from, weekday) { // weekday: 0=Sun..6=Sat
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Build Wed/Sat focus tasks from the weakest skills (idempotent on open tasks).
function generatePlan(userId) {
  const weak = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty, COALESCE(q.skill,'(unspecified)') skill,
           COUNT(*) attempts, SUM(a.is_correct) correct
    FROM attempts a JOIN questions q ON q.id=a.question_id
    WHERE a.user_id=?
    GROUP BY q.domain, q.topic, q.difficulty, q.skill
    HAVING attempts >= 3
    ORDER BY (CAST(SUM(a.is_correct) AS REAL)/COUNT(*)) ASC, attempts DESC
    LIMIT 6
  `).all(userId);

  const existing = new Set(
    db.prepare("SELECT skill||'|'||difficulty k FROM tasks WHERE user_id=? AND status='open'").all(userId).map((r) => r.k)
  );
  const created = [];
  weak.forEach((s) => {
    const key = `${s.skill}|${s.difficulty}`;
    if (existing.has(key)) return;
    const acc = s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0;
    created.push(addTask(userId, {
      domain: s.domain, topic: s.topic, difficulty: s.difficulty, skill: s.skill,
      title: `Practice: ${topicLabel(s.topic)} — ${s.skill} (${s.difficulty})`,
      detail: `Currently ${acc}%. Review explanations and redo ~10 questions to push above 70%.`,
    }));
  });
  return { created, weak };
}

module.exports = {
  SESSION_SIZE, DAILY_GOAL, TIME_LIMIT, TIME_LIMITS, SESSION_MINUTES, timeLimitFor,
  getCatalogue, getSkillCatalogue, getTodayProgress, listActiveSessions, sectionRounds,
  createOrResumeSession, getSessionState,
  getQuestionAt, setCurrentPosition, saveProgress,
  submitAnswer, peekQuestion, timeoutQuestion, skipQuestion, completeSession,
  getDashboard, getAttemptReview, getQuestionReview,
  getDailyActivity, getDailySummaries, getSkillFocus, getActivityFeed,
  listTasks, addTask, setTaskStatus, deleteTask, generatePlan,
};
