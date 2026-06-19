'use strict';

const fs = require('fs');
const path = require('path');

// ---- Deterministic RNG -----------------------------------------------------
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

function makeChoices(correctVal, distractorVals, fmt = (v) => String(v)) {
  const seen = new Set([String(correctVal)]);
  const pool = [];
  for (const d of distractorVals) {
    const key = fmt(d);
    if (!seen.has(key)) { seen.add(key); pool.push(d); }
    if (pool.length === 3) break;
  }
  let pad = 1;
  while (pool.length < 3 && pad <= 100) {
    const base = Number(correctVal);
    const cand = Number.isFinite(base) ? base + pad : `${correctVal}_${pad}`;
    const key = fmt(cand);
    if (!seen.has(key)) { seen.add(key); pool.push(cand); }
    pad++;
  }
  const values = [correctVal, ...pool];
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
function addMath(topic, q) {
  mathBank.push({
    ext_id: `starter-math-${String(++mid).padStart(3, '0')}`,
    domain: 'math',
    topic,
    difficulty: 'medium',
    source: 'starter',
    passage: null,
    ...q,
  });
}

// ---- ALGEBRA ---------------------------------------------------------------
for (let i = 0; i < 8; i++) {
  const a = rand(2, 9), x = rand(2, 12), b = rand(1, 20);
  const c = a * x + b;
  const { choices, correctLabel } = makeChoices(x, [x + 1, x - 1, c - b]);
  addMath('algebra', {
    prompt: `If ${a}x + ${b} = ${c}, what is the value of x?`,
    choices, correct: correctLabel,
    explanation: `Subtract ${b} from both sides: ${a}x = ${c - b}. Divide by ${a}: x = ${x}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const x = rand(3, 12), y = rand(1, x - 1);
  const s = x + y, d = x - y;
  const { choices, correctLabel } = makeChoices(x, [y, s, x + 1]);
  addMath('algebra', {
    prompt: `If x + y = ${s} and x − y = ${d}, what is the value of x?`,
    choices, correct: correctLabel,
    explanation: `Add the equations: 2x = ${s + d}, so x = ${x}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const m = pick([2, 3, -2, 4, -1, 1]);
  const b = rand(-5, 8), x = rand(1, 6);
  const y = m * x + b;
  const { choices, correctLabel } = makeChoices(y, [y + 1, y - 1, m * x - b]);
  addMath('algebra', {
    prompt: `What is the value of y when x = ${x}, given that y = ${m}x ${b >= 0 ? '+' : '−'} ${Math.abs(b)}?`,
    choices, correct: correctLabel,
    explanation: `y = ${m}(${x}) ${b >= 0 ? '+' : '−'} ${Math.abs(b)} = ${m * x} ${b >= 0 ? '+' : '−'} ${Math.abs(b)} = ${y}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const m = pick([2, 3, -1, 4]);
  const x1 = rand(0, 4), y1 = rand(0, 6), dx = pick([2, 3, 4]);
  const x2 = x1 + dx, y2 = y1 + m * dx;
  const { choices, correctLabel } = makeChoices(m, [m + 1, m - 1, -m]);
  addMath('algebra', {
    prompt: `A line passes through (${x1}, ${y1}) and (${x2}, ${y2}). What is the slope?`,
    choices, correct: correctLabel,
    explanation: `Slope = (${y2}−${y1})/(${x2}−${x1}) = ${y2 - y1}/${x2 - x1} = ${m}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const a = rand(2, 5), b = rand(1, 10);
  const ans = `x > ${b}` ;
  const { choices, correctLabel } = makeChoices(0, [1, 2, 3], () => '');
  // hand-craft choices for inequalities
  const ineqChoices = [
    { label: 'A', text: `x > ${b}` },
    { label: 'B', text: `x < ${b}` },
    { label: 'C', text: `x > ${b + 1}` },
    { label: 'D', text: `x ≥ ${b}` },
  ];
  addMath('algebra', {
    prompt: `Which of the following represents the solution to ${a}x − ${a * b} > 0?`,
    choices: ineqChoices,
    correct: 'A',
    explanation: `Add ${a * b}: ${a}x > ${a * b}. Divide by ${a}: x > ${b}.`,
  });
}

// ---- ADVANCED MATH ---------------------------------------------------------
for (let i = 0; i < 6; i++) {
  const a = rand(1, 3), b = rand(1, 6), x = rand(2, 5);
  const ans = a * x * x - b;
  const { choices, correctLabel } = makeChoices(ans, [a * x * x + b, a * x - b, ans + a]);
  addMath('advanced-math', {
    prompt: `If f(x) = ${a}x² − ${b}, what is f(${x})?`,
    choices, correct: correctLabel,
    explanation: `f(${x}) = ${a}(${x})² − ${b} = ${a * x * x} − ${b} = ${ans}.`,
  });
}
for (let i = 0; i < 6; i++) {
  const a = rand(2, 4), e1 = rand(2, 4), e2 = rand(1, 3);
  const ans = Math.pow(a, e1 + e2);
  const { choices, correctLabel } = makeChoices(ans, [Math.pow(a, e1 * e2), Math.pow(a, e1) + Math.pow(a, e2), ans + a]);
  addMath('advanced-math', {
    prompt: `What is the value of ${a}^${e1} × ${a}^${e2}?`,
    choices, correct: correctLabel,
    explanation: `Add exponents: ${a}^(${e1}+${e2}) = ${a}^${e1 + e2} = ${ans}.`,
  });
}
for (let i = 0; i < 6; i++) {
  const r = rand(2, 9);
  const piFmt = (v) => `${v}π`;
  const { choices, correctLabel } = makeChoices(r * r, [2 * r, r * r * r, r * r + r], piFmt);
  addMath('advanced-math', {
    prompt: `A circle has a radius of ${r}. What is its area, in terms of π?`,
    choices, correct: correctLabel,
    explanation: `Area = πr² = π(${r})² = ${r * r}π.`,
  });
}
for (let i = 0; i < 6; i++) {
  const a = rand(1, 4), b = rand(-6, 6);
  // quadratic a(x+p)(x+q) where roots are integers
  const p = rand(1, 5), q = rand(1, 5);
  const A = a, B = a * (p + q), C = a * p * q;
  const { choices, correctLabel } = makeChoices(-p, [-q, p, q]);
  addMath('advanced-math', {
    prompt: `What is one solution to ${A}x² + ${B}x + ${C} = 0?`,
    choices, correct: correctLabel,
    explanation: `Factor: ${A}(x + ${p})(x + ${q}) = 0. Solutions: x = −${p} or x = −${q}.`,
  });
}

// ---- PROBLEM-SOLVING & DATA ANALYSIS ---------------------------------------
for (let i = 0; i < 6; i++) {
  const p = pick([10, 15, 20, 25, 30, 40]);
  const n = pick([40, 60, 80, 120, 200]);
  const ans = (p / 100) * n;
  const { choices, correctLabel } = makeChoices(ans, [ans + 5, ans - 5, n - ans]);
  addMath('psda', {
    prompt: `What is ${p}% of ${n}?`,
    choices, correct: correctLabel,
    explanation: `${p}/100 × ${n} = ${ans}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const red = rand(2, 5), blue = rand(3, 6);
  const total = red + blue;
  const ans = `${red}/${total}`;
  const { choices, correctLabel } = makeChoices(ans, [`${blue}/${total}`, `${red}/${blue}`, `${total - red}/${total}`]);
  addMath('psda', {
    prompt: `A bag has ${red} red and ${blue} blue marbles. What is the probability of drawing a red marble?`,
    choices, correct: correctLabel,
    explanation: `P(red) = ${red}/${total}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const n = 4;
  const base = rand(2, 8);
  const nums = [base, base + rand(1, 4), base + rand(3, 6), base + rand(5, 9)];
  const sum = nums.reduce((s, v) => s + v, 0);
  const ans = sum / n;
  const { choices, correctLabel } = makeChoices(ans, [ans + 1, ans - 1, sum]);
  addMath('psda', {
    prompt: `What is the mean of: ${nums.join(', ')}?`,
    choices, correct: correctLabel,
    explanation: `Sum = ${sum}. Mean = ${sum} ÷ ${n} = ${ans}.`,
  });
}
for (let i = 0; i < 4; i++) {
  const speed = pick([40, 45, 50, 55, 60]);
  const t = rand(2, 5);
  const dist = speed * t;
  const { choices, correctLabel } = makeChoices(speed, [speed + 5, speed - 5, dist]);
  addMath('psda', {
    prompt: `A car travels ${dist} miles in ${t} hours. What is its average speed in mph?`,
    choices, correct: correctLabel,
    explanation: `Speed = ${dist} ÷ ${t} = ${speed} mph.`,
  });
}
for (let i = 0; i < 4; i++) {
  const base = pick([40, 50, 80, 100]);
  const p = pick([10, 20, 25]);
  const ans = base + base * (p / 100);
  const { choices, correctLabel } = makeChoices(ans, [base * (p / 100), base - base * (p / 100), ans + p]);
  addMath('psda', {
    prompt: `A price of $${base} increases by ${p}%. What is the new price?`,
    choices, correct: correctLabel,
    explanation: `Increase = ${p}% of ${base} = ${base * p / 100}. New price = ${ans}.`,
  });
}

// ---- GEOMETRY --------------------------------------------------------------
for (const [a, b, c] of [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15]]) {
  const { choices, correctLabel } = makeChoices(c, [a + b, c - 1, c + 1]);
  addMath('geometry', {
    prompt: `A right triangle has legs of length ${a} and ${b}. What is the hypotenuse?`,
    choices, correct: correctLabel,
    explanation: `c² = ${a}² + ${b}² = ${a * a + b * b}, so c = ${c}.`,
  });
}
for (let i = 0; i < 5; i++) {
  const w = rand(3, 12), h = rand(3, 12);
  const area = w * h, peri = 2 * (w + h);
  const askArea = rng() < 0.5;
  const ans = askArea ? area : peri;
  const { choices, correctLabel } = makeChoices(ans, [askArea ? peri : area, ans + w, ans - h]);
  addMath('geometry', {
    prompt: `A rectangle has width ${w} and height ${h}. What is its ${askArea ? 'area' : 'perimeter'}?`,
    choices, correct: correctLabel,
    explanation: askArea ? `Area = ${w} × ${h} = ${area}.` : `Perimeter = 2(${w}+${h}) = ${peri}.`,
  });
}
for (let i = 0; i < 4; i++) {
  const r = rand(2, 8);
  const piFmt = (v) => `${v}π`;
  const { choices, correctLabel } = makeChoices(2 * r, [r, r * r, r * 3], piFmt);
  addMath('geometry', {
    prompt: `A circle has radius ${r}. What is its circumference, in terms of π?`,
    choices, correct: correctLabel,
    explanation: `Circumference = 2πr = 2π(${r}) = ${2 * r}π.`,
  });
}

// ---- READING BANK ----------------------------------------------------------
const readingBank = [];
let rid = 0;
function addReading(topic, q) {
  readingBank.push({
    ext_id: `starter-reading-${String(++rid).padStart(3, '0')}`,
    domain: 'reading',
    topic,
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
for (const item of readingItems) {
  addReading(item.topic || 'standard-conventions', item);
}

// ---- Write files -----------------------------------------------------------
// Topics that have a real College Board PDF import (data/questions.<slug>.json)
// are left out of the generated starter bank so their pools stay 100% real.
const REAL_TOPICS = new Set(['algebra']);
const mathOut = mathBank.filter((q) => !REAL_TOPICS.has(q.topic));

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'questions.math.json'), JSON.stringify(mathOut, null, 2));
fs.writeFileSync(path.join(dataDir, 'questions.reading.json'), JSON.stringify(readingBank, null, 2));

const mathByTopic = {};
for (const q of mathOut) { mathByTopic[q.topic] = (mathByTopic[q.topic] || 0) + 1; }
const readByTopic = {};
for (const q of readingBank) { readByTopic[q.topic] = (readByTopic[q.topic] || 0) + 1; }

console.log('Math:', JSON.stringify(mathByTopic));
console.log('Reading:', JSON.stringify(readByTopic));
console.log(`Total: ${mathBank.length} math, ${readingBank.length} reading`);
