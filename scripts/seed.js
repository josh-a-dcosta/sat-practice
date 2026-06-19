'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

// Load every data/questions.*.json file (starter banks + imported PDF banks).
const dataDir = path.join(__dirname, '..', 'data');
const files = fs.readdirSync(dataDir)
  .filter((f) => /^questions\..+\.json$/.test(f))
  .map((f) => path.join(dataDir, f));

const upsert = db.prepare(`
  INSERT INTO questions
    (ext_id, domain, topic, difficulty, passage, prompt, choices, correct, explanation, source, qtype, image, mask_fraction, answer_image, skill, test)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(ext_id) DO UPDATE SET
    domain        = excluded.domain,
    topic         = excluded.topic,
    difficulty    = excluded.difficulty,
    passage       = excluded.passage,
    prompt        = excluded.prompt,
    choices       = excluded.choices,
    correct       = excluded.correct,
    explanation   = excluded.explanation,
    source        = excluded.source,
    qtype         = excluded.qtype,
    image         = excluded.image,
    mask_fraction = excluded.mask_fraction,
    answer_image  = excluded.answer_image,
    skill         = excluded.skill,
    test          = excluded.test
`);

let total = 0;
for (const file of files) {
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const q of items) {
    upsert.run(
      q.ext_id, q.domain, q.topic, q.difficulty ?? 'medium',
      q.passage ?? null, q.prompt,
      JSON.stringify(q.choices), q.correct,
      q.explanation ?? '', q.source ?? 'starter',
      q.qtype ?? 'mcq', q.image ?? null,
      q.mask_fraction ?? null, q.answer_image ?? null,
      q.skill ?? null, q.test ?? 'SAT',
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
