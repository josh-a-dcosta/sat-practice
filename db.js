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
CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id      TEXT UNIQUE NOT NULL,
  domain      TEXT NOT NULL CHECK (domain IN ('math','reading')),
  topic       TEXT NOT NULL,
  difficulty  TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('medium','hard')),
  passage     TEXT,
  prompt      TEXT NOT NULL,
  choices     TEXT NOT NULL,
  correct     TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'starter'
);

CREATE TABLE IF NOT EXISTS sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  domain           TEXT NOT NULL CHECK (domain IN ('math','reading')),
  topic            TEXT NOT NULL,
  difficulty       TEXT NOT NULL DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  current_position INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT,
  score            INTEGER
);

CREATE TABLE IF NOT EXISTS session_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  position    INTEGER NOT NULL,
  UNIQUE (session_id, position),
  UNIQUE (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id        INTEGER NOT NULL REFERENCES questions(id),
  selected           TEXT NOT NULL,
  is_correct         INTEGER NOT NULL,
  time_taken_seconds INTEGER NOT NULL DEFAULT 0,
  answered_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_question   ON attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_answered   ON attempts(answered_at);
CREATE INDEX IF NOT EXISTS idx_sq_session          ON session_questions(session_id);
CREATE INDEX IF NOT EXISTS idx_q_domain_topic_diff ON questions(domain, topic, difficulty);
`);

module.exports = { db, DB_PATH };
