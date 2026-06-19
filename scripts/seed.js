'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const files = [
  path.join(__dirname, '..', 'data', 'questions.math.json'),
  path.join(__dirname, '..', 'data', 'questions.reading.json'),
];

const upsert = db.prepare(`
  INSERT INTO questions (ext_id, domain, topic, difficulty, passage, prompt, choices, correct, explanation, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ext_id) DO UPDATE SET
    domain      = excluded.domain,
    topic       = excluded.topic,
    difficulty  = excluded.difficulty,
    passage     = excluded.passage,
    prompt      = excluded.prompt,
    choices     = excluded.choices,
    correct     = excluded.correct,
    explanation = excluded.explanation,
    source      = excluded.source
`);

let total = 0;
for (const file of files) {
  if (!fs.existsSync(file)) { console.warn(`Skipping missing: ${file}`); continue; }
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const q of items) {
    upsert.run(
      q.ext_id, q.domain, q.topic, q.difficulty ?? 'medium',
      q.passage ?? null, q.prompt,
      JSON.stringify(q.choices), q.correct,
      q.explanation ?? '', q.source ?? 'starter',
    );
    total++;
  }
  console.log(`Loaded ${items.length} from ${path.basename(file)}`);
}

const rows = db.prepare(`
  SELECT domain, topic, difficulty, COUNT(*) n
  FROM questions GROUP BY domain, topic, difficulty ORDER BY domain, topic, difficulty
`).all();
console.log('\nDatabase:');
for (const r of rows) console.log(`  ${r.domain} / ${r.topic} / ${r.difficulty}: ${r.n} questions`);
console.log(`\n${total} questions processed.`);
