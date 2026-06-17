'use strict';

/*
 * Generates the STARTER question bank used until you import your own PDFs.
 *  - Math questions are generated procedurally so every correct answer is
 *    computed (guaranteed correct) with a clear explanation.
 *  - Reading questions are an authored medium-difficulty bank.
 *
 * Output: data/questions.math.json and data/questions.reading.json
 * These use the exact same format that scripts/import-pdf.js produces, so
 * importing your real PDFs simply adds/replaces questions in the database.
 */

const fs = require('fs');
const path = require('path');

// ---- Deterministic RNG so the bank is reproducible -------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260617);
const rand = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const LABELS = ['A', 'B', 'C', 'D'];

// Build a 4-choice question from a correct value + distractors.
function makeChoices(correctVal, distractorVals, fmt = (v) => String(v)) {
  const seen = new Set([String(correctVal)]);
  const pool = [];
  for (const d of distractorVals) {
    const key = String(d);
    if (!seen.has(key)) { seen.add(key); pool.push(d); }
    if (pool.length === 3) break;
  }
  // Safety: pad if a template produced colliding distractors.
  let pad = 1;
  while (pool.length < 3 && pad <= 100) {
    const base = Number(correctVal);
    const cand = Number.isFinite(base) ? base + pad : `${correctVal} (${pad})`;
    if (!seen.has(String(cand))) { seen.add(String(cand)); pool.push(cand); }
    pad++;
  }
  const values = [correctVal, ...pool];
  // Shuffle deterministically.
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  const choices = values.map((v, i) => ({ label: LABELS[i], text: fmt(v) }));
  const correctText = fmt(correctVal);
  const correctLabel = choices.find((c) => c.text === correctText).label;
  return { choices, correctLabel };
}

const mathBank = [];
let mid = 0;
function addMath(q) {
  mathBank.push({
    ext_id: `starter-math-${String(++mid).padStart(3, '0')}`,
    section: 'math',
    passage: null,
    difficulty: 'medium',
    source: 'starter',
    ...q,
  });
}

// ---- Math templates --------------------------------------------------------

// 1. Linear equation ax + b = c
for (let i = 0; i < 8; i++) {
  const a = rand(2, 9), x = rand(2, 12), b = rand(1, 20);
  const c = a * x + b;
  const { choices, correctLabel } = makeChoices(x, [x + 1, x - 1, c - b]);
  addMath({
    prompt: `If ${a}x + ${b} = ${c}, what is the value of x?`,
    choices, correct: correctLabel,
    explanation: `Subtract ${b} from both sides: ${a}x = ${c - b}. Divide by ${a}: x = ${x}.`,
  });
}

// 2. Percent of a number
for (let i = 0; i < 6; i++) {
  const p = pick([10, 15, 20, 25, 30, 40, 60, 75]);
  const n = pick([40, 60, 80, 120, 160, 200, 240]);
  const ans = (p / 100) * n;
  const { choices, correctLabel } = makeChoices(ans, [ans + 5, ans - 5, n * (p / 100) + 10]);
  addMath({
    prompt: `What is ${p}% of ${n}?`,
    choices, correct: correctLabel,
    explanation: `${p}% = ${p}/100 = ${p / 100}. ${p / 100} × ${n} = ${ans}.`,
  });
}

// 3. Percent increase
for (let i = 0; i < 5; i++) {
  const base = pick([40, 50, 80, 120, 200]);
  const p = pick([10, 15, 20, 25]);
  const ans = base + base * (p / 100);
  const { choices, correctLabel } = makeChoices(ans, [base * (p / 100), base - base * (p / 100), ans + p]);
  addMath({
    prompt: `A jacket costs $${base}. Its price increases by ${p}%. What is the new price, in dollars?`,
    choices, correct: correctLabel,
    explanation: `The increase is ${p}% of ${base} = ${base * (p / 100)}. New price = ${base} + ${base * (p / 100)} = ${ans}.`,
  });
}

// 4. Proportion
for (let i = 0; i < 5; i++) {
  const unit = pick([2, 3, 4, 5]);
  const cost = unit * pick([2, 3, 4]);
  const want = unit * rand(2, 5);
  const ans = (cost / unit) * want;
  const { choices, correctLabel } = makeChoices(ans, [ans + cost, ans - cost, cost * want]);
  addMath({
    prompt: `If ${unit} notebooks cost $${cost}, how much do ${want} notebooks cost at the same rate?`,
    choices, correct: correctLabel,
    explanation: `Each notebook costs ${cost}/${unit} = $${cost / unit}. For ${want} notebooks: ${cost / unit} × ${want} = $${ans}.`,
  });
}

// 5. Slope from two points
for (let i = 0; i < 6; i++) {
  const x1 = rand(0, 4), y1 = rand(0, 6);
  const m = pick([2, 3, -2, 4, -1, 1]);
  const dx = pick([2, 3, 4]);
  const x2 = x1 + dx, y2 = y1 + m * dx;
  const { choices, correctLabel } = makeChoices(m, [m + 1, m - 1, -m]);
  addMath({
    prompt: `A line passes through the points (${x1}, ${y1}) and (${x2}, ${y2}). What is the slope of the line?`,
    choices, correct: correctLabel,
    explanation: `Slope = (y₂ − y₁)/(x₂ − x₁) = (${y2} − ${y1})/(${x2} − ${x1}) = ${y2 - y1}/${x2 - x1} = ${m}.`,
  });
}

// 6. Function evaluation
for (let i = 0; i < 6; i++) {
  const a = rand(1, 3), b = rand(1, 6), x = rand(2, 5);
  const ans = a * x * x - b;
  const { choices, correctLabel } = makeChoices(ans, [a * x * x + b, a * x - b, ans + a]);
  addMath({
    prompt: `If f(x) = ${a}x² − ${b}, what is f(${x})?`,
    choices, correct: correctLabel,
    explanation: `f(${x}) = ${a}(${x})² − ${b} = ${a}×${x * x} − ${b} = ${a * x * x} − ${b} = ${ans}.`,
  });
}

// 7. Mean of a list
for (let i = 0; i < 5; i++) {
  const n = 4;
  const base = rand(2, 8);
  const nums = [base, base + rand(1, 4), base + rand(3, 6), base + rand(5, 9)];
  const sum = nums.reduce((s, v) => s + v, 0);
  const ans = sum / n;
  const { choices, correctLabel } = makeChoices(ans, [ans + 1, ans - 1, sum]);
  addMath({
    prompt: `What is the average (arithmetic mean) of the numbers ${nums.join(', ')}?`,
    choices, correct: correctLabel,
    explanation: `Sum = ${nums.join(' + ')} = ${sum}. Mean = ${sum} ÷ ${n} = ${ans}.`,
  });
}

// 8. Median (odd set)
for (let i = 0; i < 4; i++) {
  const nums = [];
  let v = rand(2, 6);
  for (let k = 0; k < 5; k++) { nums.push(v); v += rand(1, 4); }
  const shuffled = [...nums];
  for (let k = shuffled.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]]; }
  const ans = nums[2];
  const { choices, correctLabel } = makeChoices(ans, [nums[1], nums[3], ans + 1]);
  addMath({
    prompt: `What is the median of the data set: ${shuffled.join(', ')}?`,
    choices, correct: correctLabel,
    explanation: `Ordered, the values are ${nums.join(', ')}. The median is the middle value: ${ans}.`,
  });
}

// 9. Exponents (numeric value of product)
for (let i = 0; i < 4; i++) {
  const a = rand(2, 4), e1 = rand(2, 4), e2 = rand(1, 3);
  const ans = Math.pow(a, e1 + e2);
  const { choices, correctLabel } = makeChoices(ans, [Math.pow(a, e1 * e2), Math.pow(a, e1) + Math.pow(a, e2), ans + a]);
  addMath({
    prompt: `What is the value of ${a}^${e1} × ${a}^${e2}?`,
    choices, correct: correctLabel,
    explanation: `When multiplying powers with the same base, add the exponents: ${a}^(${e1}+${e2}) = ${a}^${e1 + e2} = ${ans}.`,
  });
}

// 10. Rectangle perimeter / area
for (let i = 0; i < 5; i++) {
  const w = rand(3, 12), h = rand(3, 12);
  const askArea = rng() < 0.5;
  const ans = askArea ? w * h : 2 * (w + h);
  const { choices, correctLabel } = makeChoices(ans, [askArea ? 2 * (w + h) : w * h, ans + w, ans - h]);
  addMath({
    prompt: `A rectangle has a width of ${w} and a height of ${h}. What is its ${askArea ? 'area' : 'perimeter'}?`,
    choices, correct: correctLabel,
    explanation: askArea
      ? `Area = width × height = ${w} × ${h} = ${ans}.`
      : `Perimeter = 2 × (width + height) = 2 × (${w} + ${h}) = ${ans}.`,
  });
}

// 11. Circle area in terms of pi
for (let i = 0; i < 4; i++) {
  const r = rand(2, 9);
  const ans = r * r;
  const piFmt = (v) => `${v}π`;
  const { choices, correctLabel } = makeChoices(ans, [2 * r, r * r * r, r * r + r], piFmt);
  addMath({
    prompt: `A circle has a radius of ${r}. What is its area, in terms of π?`,
    choices, correct: correctLabel,
    explanation: `Area = πr² = π(${r})² = ${r * r}π.`,
  });
}

// 12. Pythagorean hypotenuse
const triples = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25]];
for (const [a, b, c] of triples) {
  const { choices, correctLabel } = makeChoices(c, [a + b, c - 1, c + 1]);
  addMath({
    prompt: `A right triangle has legs of length ${a} and ${b}. What is the length of the hypotenuse?`,
    choices, correct: correctLabel,
    explanation: `By the Pythagorean theorem, c² = ${a}² + ${b}² = ${a * a} + ${b * b} = ${a * a + b * b}, so c = ${c}.`,
  });
}

// 13. System of equations (sum / difference)
for (let i = 0; i < 5; i++) {
  const x = rand(3, 12), y = rand(1, x - 1);
  const s = x + y, d = x - y;
  const { choices, correctLabel } = makeChoices(x, [y, s, x + 1]);
  addMath({
    prompt: `If x + y = ${s} and x − y = ${d}, what is the value of x?`,
    choices, correct: correctLabel,
    explanation: `Add the two equations: 2x = ${s} + ${d} = ${s + d}, so x = ${x}.`,
  });
}

// 14. Distance / rate / time
for (let i = 0; i < 4; i++) {
  const speed = pick([40, 45, 50, 55, 60]);
  const t = rand(2, 5);
  const dist = speed * t;
  const { choices, correctLabel } = makeChoices(speed, [speed + 5, speed - 5, dist]);
  addMath({
    prompt: `A car travels ${dist} miles in ${t} hours. What is its average speed, in miles per hour?`,
    choices, correct: correctLabel,
    explanation: `Average speed = distance ÷ time = ${dist} ÷ ${t} = ${speed} mph.`,
  });
}

// 15. Probability as a fraction
for (let i = 0; i < 4; i++) {
  const red = rand(2, 5), blue = rand(3, 6);
  const total = red + blue;
  const ans = `${red}/${total}`;
  const { choices, correctLabel } = makeChoices(ans, [`${blue}/${total}`, `${red}/${blue}`, `${red}/${total + 1}`]);
  addMath({
    prompt: `A bag contains ${red} red marbles and ${blue} blue marbles. If one marble is drawn at random, what is the probability it is red?`,
    choices, correct: correctLabel,
    explanation: `P(red) = (red marbles)/(total marbles) = ${red}/${total}.`,
  });
}

// 16. Ratio split
for (let i = 0; i < 4; i++) {
  const r1 = pick([2, 3, 4]), r2 = pick([3, 5, 7]);
  const unit = rand(2, 6);
  const total = (r1 + r2) * unit;
  const larger = Math.max(r1, r2) * unit;
  const { choices, correctLabel } = makeChoices(larger, [Math.min(r1, r2) * unit, total, larger + unit]);
  addMath({
    prompt: `An amount of ${total} is divided in the ratio ${r1}:${r2}. What is the value of the larger part?`,
    choices, correct: correctLabel,
    explanation: `The ratio has ${r1 + r2} parts, so each part = ${total} ÷ ${r1 + r2} = ${unit}. The larger share is ${Math.max(r1, r2)} parts = ${larger}.`,
  });
}

// ---- Reading & Writing authored bank --------------------------------------
const readingBank = [];
let rid = 0;
function addReading(q) {
  readingBank.push({
    ext_id: `starter-reading-${String(++rid).padStart(3, '0')}`,
    section: 'reading',
    difficulty: 'medium',
    source: 'starter',
    passage: q.passage || null,
    prompt: q.prompt,
    choices: q.choices.map((text, i) => ({ label: LABELS[i], text })),
    correct: q.correct,
    explanation: q.explanation,
  });
}

const readingItems = require('./reading-bank.js');
for (const item of readingItems) addReading(item);

// ---- Write files -----------------------------------------------------------
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'questions.math.json'), JSON.stringify(mathBank, null, 2));
fs.writeFileSync(path.join(dataDir, 'questions.reading.json'), JSON.stringify(readingBank, null, 2));

console.log(`Generated ${mathBank.length} math questions -> data/questions.math.json`);
console.log(`Generated ${readingBank.length} reading questions -> data/questions.reading.json`);
