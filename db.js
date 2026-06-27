'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// On Railway the /data volume persists across deploys; fall back to local for dev.
const DB_PATH = process.env.SAT_DB_PATH ||
  (fs.existsSync('/data') ? '/data/sat-practice.db' : path.join(__dirname, 'sat-practice.db'));

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  theme      TEXT NOT NULL DEFAULT 'gray',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id        TEXT UNIQUE NOT NULL,
  domain        TEXT NOT NULL CHECK (domain IN ('math','reading')),
  topic         TEXT NOT NULL,
  difficulty    TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('medium','hard')),
  passage       TEXT,
  prompt        TEXT NOT NULL,
  choices       TEXT NOT NULL,
  correct       TEXT NOT NULL,
  explanation   TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'starter',
  qtype         TEXT NOT NULL DEFAULT 'mcq',
  image         TEXT,
  mask_fraction REAL,
  answer_image  TEXT,
  skill         TEXT,
  test          TEXT NOT NULL DEFAULT 'SAT'
);

CREATE TABLE IF NOT EXISTS sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
  domain             TEXT NOT NULL CHECK (domain IN ('math','reading')),
  topic              TEXT NOT NULL,
  difficulty         TEXT NOT NULL DEFAULT 'medium',
  round              INTEGER NOT NULL DEFAULT 1,
  time_limit_seconds INTEGER,
  status             TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  current_position   INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT,
  score              INTEGER
);

CREATE TABLE IF NOT EXISTS session_questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES questions(id),
  position        INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  peeked          INTEGER NOT NULL DEFAULT 0,
  -- Current state of this question within the round: pending until the student
  -- resolves it (correct/wrong/peeked/timedout) or defers it (skipped).
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','correct','wrong','peeked','timedout','skipped')),
  resolved_at     TEXT,
  UNIQUE (session_id, position),
  UNIQUE (session_id, question_id)
);

-- Daily activity log: one row per action (including skips and re-resolutions),
-- so the calendar / daily summary / weekly report can count by status per day.
-- This is the source of truth for "what happened on day X"; session_questions
-- holds only the latest state, attempts holds the latest terminal resolution.
CREATE TABLE IF NOT EXISTS activity_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id         INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  question_id        INTEGER REFERENCES questions(id),
  domain             TEXT,
  topic              TEXT,
  difficulty         TEXT,
  skill              TEXT,
  round              INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL CHECK (status IN ('correct','wrong','peeked','timedout','skipped')),
  selected           TEXT,
  time_taken_seconds INTEGER NOT NULL DEFAULT 0,
  over_limit         INTEGER NOT NULL DEFAULT 0,
  occurred_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id         INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id        INTEGER NOT NULL REFERENCES questions(id),
  selected           TEXT NOT NULL,
  is_correct         INTEGER NOT NULL,
  time_taken_seconds INTEGER NOT NULL DEFAULT 0,
  over_limit         INTEGER NOT NULL DEFAULT 0,
  peeked             INTEGER NOT NULL DEFAULT 0,
  answered_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date     TEXT,
  domain       TEXT,
  topic        TEXT,
  difficulty   TEXT,
  skill        TEXT,
  title        TEXT NOT NULL,
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Roles & assignments (a user may hold several roles).
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('student','tutor','admin')),
  UNIQUE (user_id, role)
);

-- Many-to-many tutor ↔ student links.
CREATE TABLE IF NOT EXISTS tutor_students (
  tutor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (tutor_id, student_id)
);

-- Per-question timer settings, keyed by section (topic) × difficulty × round
-- tier (1 = Round 1, 2 = Round 2+). Global rows are admin-set defaults; user
-- rows override them for one user. An unset value falls back to 10 minutes.
CREATE TABLE IF NOT EXISTS settings_global (
  topic              TEXT NOT NULL,
  difficulty         TEXT NOT NULL,
  round_tier         INTEGER NOT NULL,
  time_limit_seconds INTEGER NOT NULL,
  UNIQUE (topic, difficulty, round_tier)
);
CREATE TABLE IF NOT EXISTS settings_user (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic              TEXT NOT NULL,
  difficulty         TEXT NOT NULL,
  round_tier         INTEGER NOT NULL,
  time_limit_seconds INTEGER NOT NULL,
  UNIQUE (user_id, topic, difficulty, round_tier)
);

CREATE INDEX IF NOT EXISTS idx_attempts_question   ON attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_answered   ON attempts(answered_at);
CREATE INDEX IF NOT EXISTS idx_sq_session          ON session_questions(session_id);
CREATE INDEX IF NOT EXISTS idx_q_domain_topic_diff ON questions(domain, topic, difficulty);
CREATE INDEX IF NOT EXISTS idx_ae_user_day         ON activity_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ae_session          ON activity_events(session_id);
`);

// Lightweight migration: add columns to questions tables created before the
// PDF-image fields existed (e.g. an existing Railway /data volume).
for (const [col, def] of [
  ['qtype', "TEXT NOT NULL DEFAULT 'mcq'"],
  ['image', 'TEXT'],
  ['mask_fraction', 'REAL'],
  ['answer_image', 'TEXT'],
  ['skill', 'TEXT'],
  ['test', "TEXT NOT NULL DEFAULT 'SAT'"],
]) {
  try { db.exec(`ALTER TABLE questions ADD COLUMN ${col} ${def}`); } catch (_) { /* already exists */ }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_q_skill ON questions(skill);');

// Multi-user columns for databases created before per-user tracking existed.
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'gray'"); } catch (_) { /* already exists */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN round INTEGER NOT NULL DEFAULT 1'); } catch (_) { /* already exists */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN time_limit_seconds INTEGER'); } catch (_) { /* already exists */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER'); } catch (_) { /* already exists */ }
// Anti-cheat: a signature of this round's question order, so no two rounds for
// the same section ever share a sequence (see repo.createOrResumeSession).
try { db.exec('ALTER TABLE sessions ADD COLUMN seq_sig TEXT'); } catch (_) { /* exists */ }
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_seq ON sessions(domain, topic, difficulty, seq_sig);');
try { db.exec('ALTER TABLE attempts ADD COLUMN user_id INTEGER'); } catch (_) { /* already exists */ }
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);');

// Phase 2 columns: per-question timing/peek state + attempt flags.
try { db.exec('ALTER TABLE session_questions ADD COLUMN elapsed_seconds INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE session_questions ADD COLUMN peeked INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE attempts ADD COLUMN over_limit INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE attempts ADD COLUMN peeked INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);');

// Roles/settings feature: full name on users + active context on tokens.
try { db.exec('ALTER TABLE users ADD COLUMN full_name TEXT'); } catch (_) { /* exists */ }
// When the student last opened their Notes & feedback — drives the "you have a
// new note" reminder (a tutor note newer than this is considered unseen).
try { db.exec('ALTER TABLE users ADD COLUMN notes_seen_at TEXT'); } catch (_) { /* exists */ }
// Engagement tracking: how many times the user has logged in, and when last.
try { db.exec('ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE auth_tokens ADD COLUMN active_role TEXT'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE auth_tokens ADD COLUMN active_student_id INTEGER'); } catch (_) { /* exists */ }
db.exec('CREATE INDEX IF NOT EXISTS idx_user_roles ON user_roles(user_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_tutor_students_tutor ON tutor_students(tutor_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_tutor_students_student ON tutor_students(student_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_settings_user ON settings_user(user_id);');

// Collaborative plans: who added each suggested-practice task (student or tutor).
try { db.exec('ALTER TABLE tasks ADD COLUMN added_by INTEGER'); } catch (_) { /* exists */ }

// Active vs. nonactive questions (active ones appear on the real adaptive test).
// Default 0 (nonactive) so existing questions stay visible until the yearly
// import marks the active ones. mask_reviewed: admin has approved the answer
// panel (mask) position for this question's Question View.
try { db.exec('ALTER TABLE questions ADD COLUMN active INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE questions ADD COLUMN mask_reviewed INTEGER NOT NULL DEFAULT 0'); } catch (_) { /* exists */ }
db.exec('CREATE INDEX IF NOT EXISTS idx_q_active ON questions(domain, active);');

// Per-student question visibility for a subject: which pool they practice from.
// mode ∈ nonactive | active | all. No row = 'nonactive' (the default for every
// student). The legacy include_active column is kept (additive-only migrations):
// mode is the source of truth; include_active is mirrored for back-compat.
db.exec(`
CREATE TABLE IF NOT EXISTS student_active_access (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain         TEXT NOT NULL,
  include_active INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, domain)
);
`);
// Add the three-way mode and backfill it from the old boolean once.
let modeAdded = false;
try { db.exec("ALTER TABLE student_active_access ADD COLUMN mode TEXT NOT NULL DEFAULT 'nonactive'"); modeAdded = true; } catch (_) { /* exists */ }
if (modeAdded) db.exec("UPDATE student_active_access SET mode = CASE WHEN include_active = 1 THEN 'all' ELSE 'nonactive' END");

// Weekly-report comment thread between a student and their tutor(s), per week.
db.exec(`
CREATE TABLE IF NOT EXISTS weekly_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week        TEXT NOT NULL,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weekly_comments ON weekly_comments(student_id, week);
`);

// Round/practice restructure: per-question status + resolved time on an existing
// volume. Adding the column succeeds only once — on that first add we backfill
// status from the terminal attempt so old practices keep their state.
let sqStatusAdded = false;
try { db.exec("ALTER TABLE session_questions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); sqStatusAdded = true; } catch (_) { /* exists */ }
try { db.exec('ALTER TABLE session_questions ADD COLUMN resolved_at TEXT'); } catch (_) { /* exists */ }
if (sqStatusAdded) {
  db.exec(`
    UPDATE session_questions SET status = (
      SELECT CASE
        WHEN a.peeked = 1 THEN 'peeked'
        WHEN a.selected = '' AND a.over_limit = 1 THEN 'timedout'
        WHEN a.is_correct = 1 THEN 'correct'
        ELSE 'wrong' END
      FROM attempts a
      WHERE a.session_id = session_questions.session_id
        AND a.question_id = session_questions.question_id)
    WHERE EXISTS (
      SELECT 1 FROM attempts a
      WHERE a.session_id = session_questions.session_id
        AND a.question_id = session_questions.question_id);
  `);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_sq_status ON session_questions(session_id, status);');

// One-time backfill of the activity log from historical attempts so the calendar
// and weekly reports show past days. Runs only while activity_events is empty.
const aeEmpty = db.prepare('SELECT COUNT(*) n FROM activity_events').get().n === 0;
const haveAttempts = db.prepare('SELECT COUNT(*) n FROM attempts').get().n > 0;
if (aeEmpty && haveAttempts) {
  db.exec(`
    INSERT INTO activity_events
      (user_id, session_id, question_id, domain, topic, difficulty, skill, round,
       status, selected, time_taken_seconds, over_limit, occurred_at)
    SELECT a.user_id, a.session_id, a.question_id, q.domain, q.topic, q.difficulty, q.skill,
           COALESCE(s.round, 1),
           CASE
             WHEN a.peeked = 1 THEN 'peeked'
             WHEN a.selected = '' AND a.over_limit = 1 THEN 'timedout'
             WHEN a.is_correct = 1 THEN 'correct'
             ELSE 'wrong' END,
           a.selected, a.time_taken_seconds, a.over_limit, a.answered_at
    FROM attempts a
    JOIN questions q ON q.id = a.question_id
    LEFT JOIN sessions s ON s.id = a.session_id;
  `);
}

// Bug reports: any authenticated user can file one; only admins manage them.
db.exec(`
CREATE TABLE IF NOT EXISTS bug_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  page        TEXT NOT NULL DEFAULT '',
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at   TEXT,
  closed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_reports ON bug_reports(status, reported_at DESC);
`);

module.exports = { db, DB_PATH };
