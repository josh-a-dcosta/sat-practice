'use strict';

const { db } = require('./db');
const { TAXONOMY, isValidTopic, isValidDifficulty, domainOfTopic, topicLabel } = require('./topics');

const SESSION_SIZE = 40;
const DAILY_GOAL   = 40;
const TIME_LIMIT   = 120; // legacy default (medium)
const TIME_LIMITS  = { medium: 120, hard: 150 }; // 2:00 medium, 2:30 hard
const SESSION_MINUTES = 90;

// Per-question time limits by round: round 1 is generous, round 2+ is faster.
const ROUND_LIMITS = {
  1: { medium: 120, hard: 150 }, // 2:00 / 2:30
  2: { medium: 60,  hard: 120 }, // 1:00 / 2:00
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
function maxRound(userId, domain, topic, difficulty) {
  const r = db.prepare('SELECT MAX(round) m FROM sessions WHERE user_id=? AND domain=? AND topic=? AND difficulty=?')
    .get(userId, domain, topic, difficulty);
  return (r && r.m) ? r.m : 0;
}
function attemptedInRound(userId, domain, topic, difficulty, round) {
  return db.prepare(`
    SELECT COUNT(DISTINCT a.question_id) n
    FROM attempts a JOIN sessions s ON s.id = a.session_id
    WHERE s.user_id=? AND s.domain=? AND s.topic=? AND s.difficulty=? AND s.round=?
  `).get(userId, domain, topic, difficulty, round).n;
}
// The round the NEXT practice will use, plus its progress. When the current
// round has covered every question, the next practice starts a fresh round.
function roundInfo(userId, domain, topic, difficulty) {
  const total = totalQuestions(domain, topic, difficulty);
  const mr = maxRound(userId, domain, topic, difficulty);
  if (mr === 0) return { round: 1, attempted: 0, total, prevComplete: false };
  const att = attemptedInRound(userId, domain, topic, difficulty, mr);
  if (total > 0 && att >= total) return { round: mr + 1, attempted: 0, total, prevComplete: true };
  return { round: mr, attempted: att, total, prevComplete: false };
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

  const activeSessions = db.prepare(`
    SELECT domain, topic, difficulty, id FROM sessions
    WHERE status = 'in_progress' AND user_id = ?
  `).all(userId);

  const masteredMap = {};
  for (const r of mastered) masteredMap[`${r.domain}|${r.topic}|${r.difficulty}`] = r.n;

  const activeMap = {};
  for (const s of activeSessions) activeMap[`${s.domain}|${s.topic}|${s.difficulty}`] = s.id;

  const result = {};
  for (const { domain, topics } of Object.values(TAXONOMY)) {
    // iterate by domain name
  }

  const catalogue = [];
  for (const [domain, domainDef] of Object.entries(TAXONOMY)) {
    for (const [topic, topicName] of Object.entries(domainDef.topics)) {
      for (const difficulty of ['medium', 'hard']) {
        const key = `${domain}|${topic}|${difficulty}`;
        const countRow = counts.find((r) => r.domain === domain && r.topic === topic && r.difficulty === difficulty);
        const total = countRow ? countRow.total : 0;
        const masteredN = masteredMap[key] || 0;
        const activeId = activeMap[key] || null;
        const ri = total > 0 ? roundInfo(userId, domain, topic, difficulty)
                             : { round: 1, attempted: 0, total: 0, prevComplete: false };
        catalogue.push({
          domain, topic, topicName, difficulty,
          total, mastered: masteredN,
          available: total > 0,
          activeSessionId: activeId,
          round: ri.round,
          roundAttempted: ri.attempted,
          roundTotal: ri.total,
          prevComplete: ri.prevComplete,
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
  const rows = db.prepare(`
    SELECT q.domain, COUNT(*) n
    FROM attempts a JOIN questions q ON q.id = a.question_id
    WHERE a.user_id = ? AND date(a.answered_at) = date('now','localtime')
    GROUP BY q.domain
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
// Pick questions for a given round: any question not yet shown in THIS round
// (and not currently in another in-progress practice). Shuffled per call so no
// two users get the same order.
function selectQuestions(userId, domain, topic, difficulty, round, limit) {
  const all = db.prepare(
    'SELECT id FROM questions WHERE domain=? AND topic=? AND difficulty=?'
  ).all(domain, topic, difficulty).map((r) => r.id);

  if (!all.length) return [];

  const seenInRound = new Set(
    db.prepare(`
      SELECT DISTINCT a.question_id id FROM attempts a
      JOIN sessions s ON s.id = a.session_id
      WHERE s.user_id=? AND s.domain=? AND s.topic=? AND s.difficulty=? AND s.round=?
    `).all(userId, domain, topic, difficulty, round).map((r) => r.id)
  );
  const inProgress = new Set(
    db.prepare(`
      SELECT sq.question_id id FROM session_questions sq
      JOIN sessions s ON s.id = sq.session_id
      WHERE s.status='in_progress' AND s.user_id=?
    `).all(userId).map((r) => r.id)
  );

  const avail = all.filter((id) => !seenInRound.has(id) && !inProgress.has(id));
  return shuffle(avail).slice(0, limit);
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
// A user may have only ONE in-progress attempt at a time across all domains.
// If several somehow exist, keep one (math first, then most recent) and delete
// the rest so we converge to a single active attempt.
function getActiveAny(userId) {
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE user_id=? AND status='in_progress'
    ORDER BY (domain='math') DESC, created_at DESC
  `).all(userId);
  if (rows.length > 1) {
    const del = db.prepare('DELETE FROM sessions WHERE id=?');
    for (let i = 1; i < rows.length; i++) del.run(rows[i].id); // cascades sq + attempts
  }
  return rows[0] || null;
}

function activeSessionInfo(userId) {
  const a = getActiveAny(userId);
  if (!a) return null;
  const st = getSessionState(userId, a.id);
  return {
    id: a.id, domain: a.domain, topic: a.topic, difficulty: a.difficulty,
    topicName: topicLabel(a.topic),
    answeredCount: st ? st.answeredCount : 0, total: st ? st.total : 0,
  };
}

function createOrResumeSession(userId, domain, topic, difficulty, opts = {}) {
  const active = getActiveAny(userId);
  if (active) {
    if (active.domain === domain && active.topic === topic && active.difficulty === difficulty) {
      return { id: active.id, resumed: true, size: countSQ(active.id), round: active.round };
    }
    const e = new Error(`Finish your active ${topicLabel(active.topic)} (${active.difficulty}) practice before starting a new one.`);
    e.status = 409; e.activeSessionId = active.id; throw e;
  }

  const ri = roundInfo(userId, domain, topic, difficulty);
  const round = ri.round;
  const ids = selectQuestions(userId, domain, topic, difficulty, round, SESSION_SIZE);
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

function getSessionState(userId, sid) {
  const s = getSessionRow(userId, sid);
  if (!s) return null;
  const items = db.prepare(`
    SELECT sq.position, sq.question_id,
           CASE WHEN a.id IS NULL THEN 0 ELSE 1 END answered,
           a.is_correct, a.peeked, a.over_limit
    FROM session_questions sq
    LEFT JOIN attempts a ON a.session_id=sq.session_id AND a.question_id=sq.question_id
    WHERE sq.session_id=? ORDER BY sq.position
  `).all(sid);
  const answeredCount = items.filter((r) => r.answered).length;
  return {
    id: s.id, domain: s.domain, topic: s.topic, difficulty: s.difficulty,
    status: s.status, currentPosition: s.current_position,
    total: items.length, answeredCount,
    allAnswered: answeredCount === items.length && items.length > 0,
    items: items.map((r) => ({
      position: r.position,
      answered: !!r.answered,
      correct: r.answered ? !!r.is_correct : null,
      peeked: !!r.peeked,
      overLimit: !!r.over_limit,
    })),
  };
}

function runningScore(sid) {
  const r = db.prepare('SELECT COUNT(*) answered, COALESCE(SUM(is_correct),0) score FROM attempts WHERE session_id=?').get(sid);
  const total = countSQ(sid);
  return { answered: r.answered, score: r.score, total, accuracy: r.answered ? Math.round((r.score / r.answered) * 100) : 0 };
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
    question: publicQuestion(q),
    timeLimit: limit,
    elapsedSeconds: attempt ? attempt.time_taken_seconds : (sq.elapsed_seconds || 0),
    peeked: !!sq.peeked || (attempt ? !!attempt.peeked : false),
    answered: !!attempt,
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

// Resolve a question exactly once — by answering, peeking, or timing out.
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
    db.prepare(`
      INSERT INTO attempts (user_id, session_id, question_id, selected, is_correct, time_taken_seconds, over_limit, peeked)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(userId, sid, questionId, selected, isCorrect, elapsed, overLimit, peeked);
    if (peeked) db.prepare('UPDATE session_questions SET peeked=1 WHERE id=?').run(sq.id);
    attempt = db.prepare('SELECT * FROM attempts WHERE session_id=? AND question_id=?').get(sid, questionId);
  }
  const state = getSessionState(userId, sid);
  return {
    resolved: true,
    ...attemptFeedback(q, attempt),
    timeLimit: limit,
    running: runningScore(sid),
    answeredCount: state.answeredCount, total: state.total, allAnswered: state.allAnswered,
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
  if (!state.allAnswered) {
    const e = new Error('Answer all questions before finishing.'); e.status = 409; throw e;
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
  const today = new Date();
  const wed = nextWeekday(today, 3);
  const sat = nextWeekday(today, 6);
  const created = [];
  weak.forEach((s, i) => {
    const key = `${s.skill}|${s.difficulty}`;
    if (existing.has(key)) return;
    const acc = s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0;
    created.push(addTask(userId, {
      due_date: i % 2 === 0 ? wed : sat,
      domain: s.domain, topic: s.topic, difficulty: s.difficulty, skill: s.skill,
      title: `Practice: ${topicLabel(s.topic)} — ${s.skill} (${s.difficulty})`,
      detail: `Currently ${acc}%. Review explanations and redo ~10 questions to push above 70%.`,
    }));
  });
  return { created, weak };
}

module.exports = {
  SESSION_SIZE, DAILY_GOAL, TIME_LIMIT, TIME_LIMITS, SESSION_MINUTES, timeLimitFor,
  getCatalogue, getSkillCatalogue, getTodayProgress, activeSessionInfo,
  createOrResumeSession, getSessionState,
  getQuestionAt, setCurrentPosition, saveProgress,
  submitAnswer, peekQuestion, timeoutQuestion, completeSession,
  getDashboard, getAttemptReview,
  listTasks, addTask, setTaskStatus, deleteTask, generatePlan,
};
