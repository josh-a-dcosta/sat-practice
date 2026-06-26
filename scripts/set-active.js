'use strict';

// Mark which questions are ACTIVE (appear on the real adaptive SAT) vs
// NONACTIVE (practice-only). Re-runnable every year as College Board changes
// the pool. It only flips the `active` flag on questions already in the bank;
// new questions must be imported (PDF -> data/questions.*.json -> npm run seed)
// first, and this script reports any ext_ids it could not find.
//
// Input: data/question-status.json
//   {
//     "nonactiveExtIds": ["...", "..."],   // Question IDs from the NONACTIVE PDFs
//     "allExtIds":       ["...", "..."]     // optional: Question IDs from the ALL-questions PDFs
//   }
//
// Rules:
//   - A question is ACTIVE iff it is in the current pool (allExtIds, when given)
//     and NOT in nonactiveExtIds.
//   - Everything else (nonactive, or removed from the pool) is NONACTIVE so it
//     still shows up as practice. Student data is never deleted.
//
// Usage:  node --experimental-sqlite scripts/set-active.js [path/to/status.json]

const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'question-status.json');
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Could not read ${file}: ${e.message}`);
  console.error('Create it with { "nonactiveExtIds": [...], "allExtIds": [...] }.');
  process.exit(1);
}

const nonactive = new Set((cfg.nonactiveExtIds || []).map(String));
const all = cfg.allExtIds ? new Set(cfg.allExtIds.map(String)) : null;

const dbExtIds = new Set(db.prepare('SELECT ext_id FROM questions').all().map((r) => String(r.ext_id)));

db.exec('BEGIN');
try {
  // Default everyone to nonactive (practice-only)…
  db.prepare('UPDATE questions SET active = 0').run();
  // …then flip to active the ones in the current pool that are not nonactive.
  const setActive = db.prepare('UPDATE questions SET active = 1 WHERE ext_id = ?');
  const pool = all ? all : dbExtIds; // if no all-set given, treat the whole bank as the pool
  let activated = 0;
  for (const ext of pool) {
    if (nonactive.has(ext)) continue;
    if (dbExtIds.has(ext)) { setActive.run(ext); activated += 1; }
  }
  db.exec('COMMIT');

  // Report.
  const missingNonactive = [...nonactive].filter((e) => !dbExtIds.has(e));
  const missingAll = all ? [...all].filter((e) => !dbExtIds.has(e)) : [];
  const removed = all ? [...dbExtIds].filter((e) => !all.has(e)) : [];
  const counts = db.prepare("SELECT active, COUNT(*) n FROM questions GROUP BY active").all();
  const c = { active: 0, nonactive: 0 };
  for (const r of counts) c[r.active ? 'active' : 'nonactive'] = r.n;

  console.log(`Marked ${activated} active · ${c.active} active / ${c.nonactive} nonactive in the bank.`);
  if (missingNonactive.length) console.log(`⚠️  ${missingNonactive.length} nonactive ext_id(s) not in the bank (import them first): ${missingNonactive.slice(0, 10).join(', ')}${missingNonactive.length > 10 ? '…' : ''}`);
  if (missingAll.length) console.log(`⚠️  ${missingAll.length} pool ext_id(s) not in the bank (new — import them): ${missingAll.slice(0, 10).join(', ')}${missingAll.length > 10 ? '…' : ''}`);
  if (removed.length) console.log(`ℹ️  ${removed.length} question(s) in the bank are no longer in the pool — kept as practice-only.`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Failed:', e.message);
  process.exit(1);
}
