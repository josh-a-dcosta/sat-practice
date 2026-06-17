'use strict';

const { db } = require('./db');

const SESSION_SIZE = 40;     // questions chosen per session
const DAILY_GOAL = 40;       // questions to complete each day
const TIME_LIMIT_SECONDS = 120; // 2 minutes per question (used by the UI timer)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseQuestionRow(row) {
  if (!row) return null;
  return { ...row, choices: JSON.parse(row.choices) };
}

// Public (safe) view of a question — never includes correct answer/explanation.
function publicQuestion(q) {
  return {
    id: q.id,
    section: q.section,
    passage: q.passage,
    prompt: q.prompt,
    choices: q.choices.map((c) => ({ label: c.label, text: c.text })),
  };
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------
function getSectionStats(section) {
  const total = db.prepare('SELECT COUNT(*) n FROM questions WHERE section = ?').get(section).n;
  const mastered = db.prepare(`
    SELECT COUNT(DISTINCT a.question_id) n
    FROM attempts a JOIN questions q ON q.id = a.question_id
    WHERE q.section = ? AND a.is_correct = 1
  `).get(section).n;

  // questions available to put into a *new* session (not mastered, not locked in an active session)
  const available = selectQuestionsForSection(section, Number.MAX_SAFE_INTEGER).length;
  const active = getActiveSession(section);

  return { section, total, mastered, available, hasActiveSession: !!active, activeSessionId: active ? active.id : null };
}

function getTodayProgress() {
  const row = db.prepare(`
    SELECT COUNT(*) n FROM attempts WHERE date(answered_at) = date('now','localtime')
  `).get();
  return { answeredToday: row.n, goal: DAILY_GOAL, met: row.n >= DAILY_GOAL };
}

// ---------------------------------------------------------------------------
// question selection for a new session
// ---------------------------------------------------------------------------
function selectQuestionsForSection(section, limit) {
  const all = db.prepare('SELECT id FROM questions WHERE section = ?').all(section).map((r) => r.id);
  const mastered = new Set(db.prepare('SELECT DISTINCT question_id id FROM attempts WHERE is_correct = 1').all().map((r) => r.id));
  const attempted = new Set(db.prepare('SELECT DISTINCT question_id id FROM attempts').all().map((r) => r.id));
  const inProgress = new Set(db.prepare(`
    SELECT sq.question_id id FROM session_questions sq
    JOIN sessions s ON s.id = sq.session_id
    WHERE s.status = 'in_progress'
  `).all().map((r) => r.id));

  const retake = []; // previously answered wrong (not yet mastered) -> she retakes these
  const fresh = [];  // never attempted -> brand new questions
  for (const id of all) {
    if (mastered.has(id) || inProgress.has(id)) continue;
    if (attempted.has(id)) retake.push(id);
    else fresh.push(id);
  }
  shuffle(retake);
  shuffle(fresh);
  // Retake wrong ones first so she revisits them, then fill with new questions.
  return [...retake, ...fresh].slice(0, limit);
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
function getActiveSession(section) {
  return db.prepare(`
    SELECT * FROM sessions WHERE section = ? AND status = 'in_progress'
    ORDER BY created_at DESC LIMIT 1
  `).get(section);
}

function createOrResumeSession(section) {
  const active = getActiveSession(section);
  if (active) return { id: active.id, resumed: true, size: countSessionQuestions(active.id) };

  const ids = selectQuestionsForSection(section, SESSION_SIZE);
  if (ids.length === 0) {
    const err = new Error('No questions are available for a new session in this section. Try the other section, or import more questions.');
    err.status = 409;
    throw err;
  }

  db.exec('BEGIN');
  try {
    const info = db.prepare('INSERT INTO sessions (section) VALUES (?)').run(section);
    const sessionId = Number(info.lastInsertRowid);
    const insSq = db.prepare('INSERT INTO session_questions (session_id, question_id, position) VALUES (?, ?, ?)');
    ids.forEach((qid, i) => insSq.run(sessionId, qid, i + 1));
    db.exec('COMMIT');
    return { id: sessionId, resumed: false, size: ids.length };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function countSessionQuestions(sessionId) {
  return db.prepare('SELECT COUNT(*) n FROM session_questions WHERE session_id = ?').get(sessionId).n;
}

function getSessionRow(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

// Map of positions -> answered status (no correctness leaked) for navigation UI.
function getSessionState(sessionId) {
  const session = getSessionRow(sessionId);
  if (!session) return null;
  const scoped = db.prepare(`
    SELECT sq.position, sq.question_id,
           CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS answered
    FROM session_questions sq
    LEFT JOIN attempts a ON a.session_id = sq.session_id AND a.question_id = sq.question_id
    WHERE sq.session_id = ?
    ORDER BY sq.position
  `).all(sessionId);
  const answeredCount = scoped.filter((r) => r.answered).length;
  return {
    id: session.id,
    section: session.section,
    status: session.status,
    currentPosition: session.current_position,
    total: scoped.length,
    answeredCount,
    allAnswered: answeredCount === scoped.length && scoped.length > 0,
    items: scoped.map((r) => ({ position: r.position, answered: !!r.answered })),
  };
}

// Question payload for a position: choices only, plus the user's locked selection if answered.
function getQuestionAt(sessionId, position) {
  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id = ? AND position = ?').get(sessionId, position);
  if (!sq) return null;
  const q = parseQuestionRow(db.prepare('SELECT * FROM questions WHERE id = ?').get(sq.question_id));
  const attempt = db.prepare('SELECT selected, time_taken_seconds FROM attempts WHERE session_id = ? AND question_id = ?').get(sessionId, sq.question_id);
  const state = getSessionState(sessionId);
  return {
    position,
    total: state.total,
    answeredCount: state.answeredCount,
    question: publicQuestion(q),
    answered: !!attempt,
    selected: attempt ? attempt.selected : null,
    timeLimit: TIME_LIMIT_SECONDS,
  };
}

function setCurrentPosition(sessionId, position) {
  db.prepare('UPDATE sessions SET current_position = ? WHERE id = ? AND status = \'in_progress\'').run(position, sessionId);
}

// Record an answer. Does NOT reveal correctness (kept hidden until session end).
function submitAnswer(sessionId, questionId, selected, timeTaken) {
  const session = getSessionRow(sessionId);
  if (!session) { const e = new Error('Session not found'); e.status = 404; throw e; }
  if (session.status !== 'in_progress') { const e = new Error('This session is already completed.'); e.status = 409; throw e; }

  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id = ? AND question_id = ?').get(sessionId, questionId);
  if (!sq) { const e = new Error('Question is not part of this session.'); e.status = 400; throw e; }

  const existing = db.prepare('SELECT id FROM attempts WHERE session_id = ? AND question_id = ?').get(sessionId, questionId);
  if (existing) { const e = new Error('You have already answered this question in this session.'); e.status = 409; throw e; }

  const q = db.prepare('SELECT correct FROM questions WHERE id = ?').get(questionId);
  const isCorrect = q.correct === selected ? 1 : 0;
  const t = Math.max(0, Math.min(Number(timeTaken) || 0, 36000));

  db.prepare(`
    INSERT INTO attempts (session_id, question_id, selected, is_correct, time_taken_seconds)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, questionId, selected, isCorrect, t);

  const state = getSessionState(sessionId);
  // No correctness in the response — only progress.
  return { recorded: true, answeredCount: state.answeredCount, total: state.total, allAnswered: state.allAnswered };
}

// Finalize a session: requires every question answered. Returns score + review of wrong ones.
function completeSession(sessionId) {
  const session = getSessionRow(sessionId);
  if (!session) { const e = new Error('Session not found'); e.status = 404; throw e; }

  const state = getSessionState(sessionId);
  if (!state.allAnswered) {
    const e = new Error('All questions must be answered before finishing the session.');
    e.status = 409;
    throw e;
  }

  const attempts = db.prepare(`
    SELECT a.question_id, a.selected, a.is_correct, a.time_taken_seconds, sq.position
    FROM attempts a JOIN session_questions sq ON sq.session_id = a.session_id AND sq.question_id = a.question_id
    WHERE a.session_id = ? ORDER BY sq.position
  `).all(sessionId);

  const score = attempts.filter((a) => a.is_correct).length;
  const totalTime = attempts.reduce((s, a) => s + a.time_taken_seconds, 0);

  if (session.status !== 'completed') {
    db.prepare("UPDATE sessions SET status = 'completed', completed_at = datetime('now'), score = ? WHERE id = ?").run(score, sessionId);
  }

  // Build the end-of-session review for the questions she missed (with correct answer + explanation).
  const review = attempts
    .filter((a) => !a.is_correct)
    .map((a) => {
      const q = parseQuestionRow(db.prepare('SELECT * FROM questions WHERE id = ?').get(a.question_id));
      return {
        position: a.position,
        passage: q.passage,
        prompt: q.prompt,
        choices: q.choices,
        selected: a.selected,
        correct: q.correct,
        explanation: q.explanation,
      };
    });

  return {
    sessionId,
    section: session.section,
    score,
    total: attempts.length,
    accuracy: attempts.length ? Math.round((score / attempts.length) * 100) : 0,
    totalTimeSeconds: totalTime,
    avgTimeSeconds: attempts.length ? Math.round(totalTime / attempts.length) : 0,
    review,
  };
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------
function getDashboard() {
  const sections = ['math', 'reading'].map(getSectionStats);

  const overall = db.prepare(`
    SELECT COUNT(*) attempts,
           SUM(is_correct) correct,
           SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) wrong,
           COALESCE(AVG(time_taken_seconds), 0) avg_time
    FROM attempts
  `).get();

  const byDay = db.prepare(`
    SELECT date(answered_at) day,
           COUNT(*) total,
           SUM(is_correct) correct,
           SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) wrong
    FROM attempts
    GROUP BY date(answered_at)
    ORDER BY day
  `).all();

  const bySection = db.prepare(`
    SELECT q.section,
           COUNT(*) attempts,
           SUM(a.is_correct) correct,
           COALESCE(AVG(a.time_taken_seconds), 0) avg_time
    FROM attempts a JOIN questions q ON q.id = a.question_id
    GROUP BY q.section
  `).all();

  const sessions = db.prepare(`
    SELECT s.id, s.section, s.status, s.created_at, s.completed_at, s.score,
           (SELECT COUNT(*) FROM session_questions sq WHERE sq.session_id = s.id) total,
           (SELECT COUNT(*) FROM attempts a WHERE a.session_id = s.id) answered
    FROM sessions s
    ORDER BY s.created_at DESC
  `).all();

  // Full attempts table for filtering/reporting.
  const attemptRows = db.prepare(`
    SELECT a.id, a.session_id, a.answered_at, q.section, q.difficulty,
           substr(q.prompt, 1, 90) AS prompt, a.selected, q.correct,
           a.is_correct, a.time_taken_seconds
    FROM attempts a JOIN questions q ON q.id = a.question_id
    ORDER BY a.answered_at DESC
  `).all();

  return {
    today: getTodayProgress(),
    sections,
    overall: {
      attempts: overall.attempts || 0,
      correct: overall.correct || 0,
      wrong: overall.wrong || 0,
      accuracy: overall.attempts ? Math.round((overall.correct / overall.attempts) * 100) : 0,
      avgTime: Math.round(overall.avg_time || 0),
    },
    byDay,
    bySection,
    sessions,
    attempts: attemptRows,
  };
}

module.exports = {
  SESSION_SIZE,
  DAILY_GOAL,
  TIME_LIMIT_SECONDS,
  getSectionStats,
  getTodayProgress,
  createOrResumeSession,
  getSessionState,
  getQuestionAt,
  setCurrentPosition,
  submitAnswer,
  completeSession,
  getDashboard,
  getActiveSession,
};
