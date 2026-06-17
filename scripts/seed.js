'use strict';

/*
 * Loads data/questions.*.json into the SQLite database.
 * Idempotent: uses ext_id, so re-running updates existing questions in place
 * and never creates duplicates. Safe to run after importing new PDFs.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const files = [
  path.join(__dirname, '..', 'data', 'questions.math.json'),
  path.join(__dirname, '..', 'data', 'questions.reading.json'),
];

const upsert = db.prepare(`
  INSERT INTO questions (ext_id, section, passage, prompt, choices, correct, explanation, difficulty, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ext_id) DO UPDATE SET
    section = excluded.section,
    passage = excluded.passage,
    prompt = excluded.prompt,
    choices = excluded.choices,
    correct = excluded.correct,
    explanation = excluded.explanation,
    difficulty = excluded.difficulty,
    source = excluded.source
`);

let total = 0;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.warn(`Skipping missing file: ${file}`);
    continue;
  }
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const q of items) {
    upsert.run(
      q.ext_id,
      q.section,
      q.passage ?? null,
      q.prompt,
      JSON.stringify(q.choices),
      q.correct,
      q.explanation ?? '',
      q.difficulty ?? 'medium',
      q.source ?? 'starter',
    );
    total++;
  }
  console.log(`Loaded ${items.length} questions from ${path.basename(file)}`);
}

const counts = db.prepare('SELECT section, COUNT(*) n FROM questions GROUP BY section').all();
console.log('Database now contains:');
for (const c of counts) console.log(`  ${c.section}: ${c.n} questions`);
console.log(`Done (${total} questions processed).`);
