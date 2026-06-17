'use strict';

/*
 * Import questions from your own PDF files.
 *
 * USAGE:
 *   1) Put your PDFs in a ./pdfs folder, e.g.
 *        pdfs/math.pdf
 *        pdfs/reading.pdf
 *   2) Install the PDF text extractor once:
 *        npm install pdfjs-dist
 *   3) Run:
 *        node scripts/import-pdf.js pdfs/math.pdf math
 *        node scripts/import-pdf.js pdfs/reading.pdf reading
 *   4) Load them into the app:
 *        npm run seed       (or: node --experimental-sqlite scripts/seed.js)
 *
 * This writes data/questions.<section>.json in the SAME format the app uses,
 * so seeding picks them up automatically. Importing is idempotent per ext_id.
 *
 * PARSING: PDFs vary a lot in layout. This script uses a flexible heuristic
 * that expects, for each question, something like:
 *
 *     1. The full question text may span multiple lines.
 *     A) first choice
 *     B) second choice
 *     C) third choice
 *     D) fourth choice
 *     Answer: B
 *     Explanation: why B is correct ...
 *
 * It tolerates "A.", "A)", "(A)" choice markers and "Correct Answer", "Ans:",
 * "Key:" labels. If your PDF differs, adjust the regexes in parseQuestions()
 * below — the structure is intentionally simple to edit.
 */

const fs = require('fs');
const path = require('path');

async function extractText(pdfPath) {
  let pdfjs;
  try {
    pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  } catch (e) {
    console.error('\nMissing dependency "pdfjs-dist". Install it first:\n  npm install pdfjs-dist\n');
    process.exit(1);
  }
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Reconstruct lines using the y-position of each text item.
    const lines = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(item.str);
    }
    const ys = [...lines.keys()].sort((a, b) => b - a); // top to bottom
    for (const y of ys) text += lines.get(y).join(' ').replace(/\s+/g, ' ').trim() + '\n';
    text += '\n';
  }
  return text;
}

const CHOICE_RE = /^\(?([A-D])[).\.]\s+(.*)$/;       // "A) text", "A. text", "(A) text"
const QNUM_RE = /^\(?(\d{1,3})[).\.]\s+(.*)$/;        // "12. question..."
const ANSWER_RE = /^(?:correct\s*answer|answer|ans|key)\s*[:\-]?\s*\(?([A-D])\)?/i;
const EXPL_RE = /^(?:explanation|why|rationale|reason)\s*[:\-]?\s*(.*)$/i;

function parseQuestions(text, section) {
  const lines = text.split('\n').map((l) => l.trim());
  const questions = [];
  let cur = null;
  let mode = 'prompt'; // prompt | explanation

  function flush() {
    if (cur && cur.choices.length >= 2 && cur.correct) {
      cur.prompt = cur.prompt.trim();
      cur.explanation = (cur.explanation || '').trim();
      questions.push(cur);
    }
    cur = null;
  }

  for (const line of lines) {
    if (!line) continue;
    const qnum = line.match(QNUM_RE);
    const choice = line.match(CHOICE_RE);
    const answer = line.match(ANSWER_RE);
    const expl = line.match(EXPL_RE);

    if (qnum && !choice) {
      // start of a new question
      flush();
      cur = { num: qnum[1], prompt: qnum[2], choices: [], correct: null, explanation: '' };
      mode = 'prompt';
      continue;
    }
    if (!cur) continue;

    if (choice) {
      cur.choices.push({ label: choice[1], text: choice[2].trim() });
      mode = 'choices';
      continue;
    }
    if (answer) {
      cur.correct = answer[1].toUpperCase();
      mode = 'answer';
      continue;
    }
    if (expl) {
      cur.explanation = expl[1] || '';
      mode = 'explanation';
      continue;
    }
    // continuation line
    if (mode === 'prompt') cur.prompt += ' ' + line;
    else if (mode === 'choices' && cur.choices.length) cur.choices[cur.choices.length - 1].text += ' ' + line;
    else if (mode === 'explanation') cur.explanation += ' ' + line;
  }
  flush();

  // normalize into the app's question format
  return questions.map((q, i) => ({
    ext_id: `pdf-${section}-${String(q.num || i + 1).padStart(3, '0')}`,
    section,
    passage: null,
    prompt: q.prompt,
    choices: q.choices.map((c) => ({ label: c.label, text: c.text })),
    correct: q.correct,
    explanation: q.explanation,
    difficulty: 'medium',
    source: 'pdf',
  })).filter((q) => q.choices.some((c) => c.label === q.correct)); // keep only valid items
}

async function main() {
  const [pdfPath, section] = process.argv.slice(2);
  if (!pdfPath || !['math', 'reading'].includes(section)) {
    console.log('Usage: node scripts/import-pdf.js <path-to-pdf> <math|reading>');
    process.exit(1);
  }
  if (!fs.existsSync(pdfPath)) {
    console.error(`File not found: ${pdfPath}`);
    process.exit(1);
  }

  console.log(`Extracting text from ${pdfPath} ...`);
  const text = await extractText(pdfPath);

  const parsed = parseQuestions(text, section);
  console.log(`Parsed ${parsed.length} valid question(s) from the PDF.`);

  if (!parsed.length) {
    console.error('\nNo questions were parsed. Your PDF layout likely differs from the expected pattern.');
    console.error('A raw text dump was written to data/_pdf-dump.' + section + '.txt so you can inspect it');
    console.error('and tune the regexes in scripts/import-pdf.js (see CHOICE_RE / ANSWER_RE / etc.).');
    fs.writeFileSync(path.join(__dirname, '..', 'data', `_pdf-dump.${section}.txt`), text);
    process.exit(2);
  }

  const outFile = path.join(__dirname, '..', 'data', `questions.${section}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2));
  console.log(`Wrote ${parsed.length} questions -> ${path.relative(process.cwd(), outFile)}`);
  console.log('\nNext step: load them into the app with:\n  npm run seed\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
