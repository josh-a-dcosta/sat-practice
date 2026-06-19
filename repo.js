'use strict';

const { db } = require('./db');
const { TAXONOMY, isValidTopic, isValidDifficulty, domainOfTopic, topicLabel } = require('./topics');

const SESSION_SIZE = 40;
const DAILY_GOAL   = 40;
const TIME_LIMIT   = 120; // seconds per question

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
    choices: q.choices.map((c) => ({ label: c.label, text: c.text })),
  };
}

// ---------------------------------------------------------------------------
// catalogue: what's available per topic+difficulty
// ---------------------------------------------------------------------------
function getCatalogue() {
  const counts = db.prepare(`
    SELECT domain, topic, difficulty, COUNT(*) total FROM questions
    GROUP BY domain, topic, difficulty
  `).all();

  const mastered = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty, COUNT(DISTINCT a.question_id) n
    FROM attempts a JOIN questions q ON q.id = a.question_id
    WHERE a.is_correct = 1
    GROUP BY q.domain, q.topic, q.difficulty
  `).all();

  const activeSessions = db.prepare(`
    SELECT domain, topic, difficulty, id FROM sessions WHERE status = 'in_progress'
  `).all();

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
        catalogue.push({
          domain, topic, topicName, difficulty,
          total, mastered: masteredN,
          available: total > 0,
          activeSessionId: activeId,
        });
      }
    }
  }
  return catalogue;
}

function getTodayProgress() {
  const row = db.prepare(`
    SELECT COUNT(*) n FROM attempts WHERE date(answered_at) = date('now','localtime')
  `).get();
  return { answeredToday: row.n, goal: DAILY_GOAL, met: row.n >= DAILY_GOAL };
}

// ---------------------------------------------------------------------------
// question selection for a session
// ---------------------------------------------------------------------------
function selectQuestions(domain, topic, difficulty, limit) {
  const all = db.prepare(
    'SELECT id FROM questions WHERE domain=? AND topic=? AND difficulty=?'
  ).all(domain, topic, difficulty).map((r) => r.id);

  if (!all.length) return [];

  const mastered = new Set(
    db.prepare('SELECT DISTINCT question_id id FROM attempts WHERE is_correct=1').all().map((r) => r.id)
  );
  const attempted = new Set(
    db.prepare('SELECT DISTINCT question_id id FROM attempts').all().map((r) => r.id)
  );
  const inProgress = new Set(
    db.prepare(`
      SELECT sq.question_id id FROM session_questions sq
      JOIN sessions s ON s.id = sq.session_id WHERE s.status='in_progress'
    `).all().map((r) => r.id)
  );

  const retake = [], fresh = [];
  for (const id of all) {
    if (mastered.has(id) || inProgress.has(id)) continue;
    (attempted.has(id) ? retake : fresh).push(id);
  }
  return [...shuffle(retake), ...shuffle(fresh)].slice(0, limit);
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
function getActiveSession(domain, topic, difficulty) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE domain=? AND topic=? AND difficulty=? AND status='in_progress'
    ORDER BY created_at DESC LIMIT 1
  `).get(domain, topic, difficulty);
}

function createOrResumeSession(domain, topic, difficulty) {
  const active = getActiveSession(domain, topic, difficulty);
  if (active) return { id: active.id, resumed: true, size: countSQ(active.id) };

  const ids = selectQuestions(domain, topic, difficulty, SESSION_SIZE);
  if (!ids.length) {
    const e = new Error(`No questions available for ${topicLabel(topic)} ${difficulty}. Upload questions for this section.`);
    e.status = 409; throw e;
  }

  db.exec('BEGIN');
  try {
    const info = db.prepare(
      'INSERT INTO sessions (domain, topic, difficulty) VALUES (?,?,?)'
    ).run(domain, topic, difficulty);
    const sid = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO session_questions (session_id,question_id,position) VALUES (?,?,?)');
    ids.forEach((qid, i) => ins.run(sid, qid, i + 1));
    db.exec('COMMIT');
    return { id: sid, resumed: false, size: ids.length };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function countSQ(sid) {
  return db.prepare('SELECT COUNT(*) n FROM session_questions WHERE session_id=?').get(sid).n;
}

function getSessionRow(sid) {
  return db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
}

function getSessionState(sid) {
  const s = getSessionRow(sid);
  if (!s) return null;
  const items = db.prepare(`
    SELECT sq.position, sq.question_id,
           CASE WHEN a.id IS NULL THEN 0 ELSE 1 END answered
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
    items: items.map((r) => ({ position: r.position, answered: !!r.answered })),
  };
}

function getQuestionAt(sid, position) {
  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id=? AND position=?').get(sid, position);
  if (!sq) return null;
  const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(sq.question_id));
  const attempt = db.prepare(
    'SELECT selected, time_taken_seconds FROM attempts WHERE session_id=? AND question_id=?'
  ).get(sid, sq.question_id);
  const state = getSessionState(sid);
  return {
    position, total: state.total, answeredCount: state.answeredCount,
    question: publicQuestion(q),
    answered: !!attempt, selected: attempt ? attempt.selected : null,
    timeLimit: TIME_LIMIT,
  };
}

function setCurrentPosition(sid, position) {
  db.prepare("UPDATE sessions SET current_position=? WHERE id=? AND status='in_progress'").run(position, sid);
}

function submitAnswer(sid, questionId, selected, timeTaken) {
  const s = getSessionRow(sid);
  if (!s) { const e = new Error('Session not found'); e.status = 404; throw e; }
  if (s.status !== 'in_progress') { const e = new Error('Session already completed.'); e.status = 409; throw e; }

  const sq = db.prepare('SELECT * FROM session_questions WHERE session_id=? AND question_id=?').get(sid, questionId);
  if (!sq) { const e = new Error('Question not in this session.'); e.status = 400; throw e; }

  if (db.prepare('SELECT id FROM attempts WHERE session_id=? AND question_id=?').get(sid, questionId)) {
    const e = new Error('Already answered this question in this session.'); e.status = 409; throw e;
  }

  const correct = db.prepare('SELECT correct FROM questions WHERE id=?').get(questionId).correct;
  const isCorrect = correct === selected ? 1 : 0;
  const t = Math.max(0, Math.min(Number(timeTaken) || 0, 36000));

  db.prepare(`
    INSERT INTO attempts (session_id, question_id, selected, is_correct, time_taken_seconds)
    VALUES (?,?,?,?,?)
  `).run(sid, questionId, selected, isCorrect, t);

  const state = getSessionState(sid);
  return { recorded: true, answeredCount: state.answeredCount, total: state.total, allAnswered: state.allAnswered };
}

function completeSession(sid) {
  const s = getSessionRow(sid);
  if (!s) { const e = new Error('Session not found'); e.status = 404; throw e; }

  const state = getSessionState(sid);
  if (!state.allAnswered) {
    const e = new Error('Answer all questions before finishing.'); e.status = 409; throw e;
  }

  const attempts = db.prepare(`
    SELECT a.question_id, a.selected, a.is_correct, a.time_taken_seconds, sq.position
    FROM attempts a JOIN session_questions sq
      ON sq.session_id=a.session_id AND sq.question_id=a.question_id
    WHERE a.session_id=? ORDER BY sq.position
  `).all(sid);

  const score = attempts.filter((a) => a.is_correct).length;
  const totalTime = attempts.reduce((acc, a) => acc + a.time_taken_seconds, 0);

  if (s.status !== 'completed') {
    db.prepare("UPDATE sessions SET status='completed', completed_at=datetime('now'), score=? WHERE id=?").run(score, sid);
  }

  const review = attempts.filter((a) => !a.is_correct).map((a) => {
    const q = parseQ(db.prepare('SELECT * FROM questions WHERE id=?').get(a.question_id));
    return {
      position: a.position, passage: q.passage, prompt: q.prompt,
      choices: q.choices, selected: a.selected, correct: q.correct, explanation: q.explanation,
    };
  });

  return {
    sessionId: sid, domain: s.domain, topic: s.topic, difficulty: s.difficulty,
    score, total: attempts.length,
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
  const catalogue = getCatalogue();
  const overall = db.prepare(`
    SELECT COUNT(*) attempts, SUM(is_correct) correct,
           SUM(CASE WHEN is_correct=0 THEN 1 ELSE 0 END) wrong,
           COALESCE(AVG(time_taken_seconds),0) avg_time
    FROM attempts
  `).get();

  const byDay = db.prepare(`
    SELECT date(answered_at) day, COUNT(*) total,
           SUM(is_correct) correct, SUM(CASE WHEN is_correct=0 THEN 1 ELSE 0 END) wrong
    FROM attempts GROUP BY date(answered_at) ORDER BY day
  `).all();

  const byTopic = db.prepare(`
    SELECT q.domain, q.topic, q.difficulty,
           COUNT(*) attempts, SUM(a.is_correct) correct,
           COALESCE(AVG(a.time_taken_seconds),0) avg_time
    FROM attempts a JOIN questions q ON q.id=a.question_id
    GROUP BY q.domain, q.topic, q.difficulty
    ORDER BY q.domain, q.topic, q.difficulty
  `).all();

  const sessions = db.prepare(`
    SELECT s.id, s.domain, s.topic, s.difficulty, s.status, s.created_at, s.completed_at, s.score,
           (SELECT COUNT(*) FROM session_questions sq WHERE sq.session_id=s.id) total,
           (SELECT COUNT(*) FROM attempts a WHERE a.session_id=s.id) answered
    FROM sessions s ORDER BY s.created_at DESC
  `).all();

  const attemptRows = db.prepare(`
    SELECT a.id, a.session_id, a.answered_at, q.domain, q.topic, q.difficulty,
           substr(q.prompt,1,90) prompt, a.selected, q.correct, a.is_correct, a.time_taken_seconds
    FROM attempts a JOIN questions q ON q.id=a.question_id
    ORDER BY a.answered_at DESC
  `).all();

  return {
    today: getTodayProgress(),
    catalogue,
    overall: {
      attempts: overall.attempts || 0,
      correct: overall.correct || 0,
      wrong: overall.wrong || 0,
      accuracy: overall.attempts ? Math.round((overall.correct / overall.attempts) * 100) : 0,
      avgTime: Math.round(overall.avg_time || 0),
    },
    byDay, byTopic, sessions, attempts: attemptRows,
  };
}

module.exports = {
  SESSION_SIZE, DAILY_GOAL, TIME_LIMIT,
  getCatalogue, getTodayProgress,
  createOrResumeSession, getSessionState,
  getQuestionAt, setCurrentPosition,
  submitAnswer, completeSession,
  getDashboard, getActiveSession,
};
