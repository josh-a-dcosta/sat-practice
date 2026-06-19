# 🌸 SAT Practice

A friendly, pink-and-white SAT practice website built for daily Math and
Reading & Writing practice. It hides answers while practicing, tracks every
attempt in a database, supports pausable sessions, times each question, and
shows a colorful progress dashboard.

> **Note on the question bank:** This ships with a **starter question bank**
> (81 Math + 45 Reading questions) so it works immediately. When you upload
> your own PDFs, run the importer (see [Import your PDFs](#import-your-own-pdfs))
> to load the real questions — no code changes needed.

---

## ✨ Features

- **Choose a section** to begin: 🔢 Math or 📖 Reading & Writing.
- **40-question sessions.** Each session picks 40 fresh questions.
- **No repeats across sessions.** Once a question is answered **correctly**,
  it's "mastered" and never appears again.
- **Retake what she missed.** Questions answered incorrectly come back in a
  later session so she can try again after reviewing.
- **Answers stay hidden.** While practicing she only sees the choices. She is
  **not** told right/wrong during the session (so she's never discouraged).
- **One answer per question per session** — choices lock once submitted.
- **Go forward & backward** freely; jump to any question with the map.
- **She must answer all 40** before a session can be finished.
- **2-minute timer** per question (counts down, turns amber then pink), and
  the exact time taken on every question is recorded.
- **Pause & resume.** Leave any time; the section card shows "Resume in
  progress" and continues right where she left off.
- **End-of-session review.** After finishing, the questions she missed are
  shown with the **correct answer and explanation** — the only time answers
  are revealed.
- **Encouragement** throughout, plus a celebratory results screen.
- **Daily goal of 40 questions**, tracked with a progress bar.
- **Dashboard** with charts (daily activity, accuracy, time) and a
  **filterable, exportable** table of every attempt.

---

## 🚀 Getting started

Requires **Node.js 22.5 or newer** (uses the built-in SQLite module — no
external database to install).

```bash
# 1. Build the starter question bank and load it into the database
npm run seed

# 2. Start the website
npm start

# 3. Open your browser to:
#    http://localhost:3000
```

That's it — no `npm install` needed for the app itself (it has zero runtime
dependencies). To use a different port: `PORT=8080 npm start`.

---

## 📄 Import your own PDFs

Your two PDFs (one Math, one Reading) replace the starter questions.

```bash
# 1. Install the one-time PDF text extractor
npm install pdfjs-dist

# 2. Put your PDFs anywhere, then import each with its section:
node scripts/import-pdf.js path/to/math.pdf math
node scripts/import-pdf.js path/to/reading.pdf reading

# 3. Load the imported questions into the app:
npm run seed     # this re-loads data/*.json into the database
```

The importer expects each question to look roughly like:

```
12. A train travels 180 miles in 3 hours. What is its average speed?
A) 50
B) 60
C) 70
D) 90
Answer: B
Explanation: Speed = distance ÷ time = 180 ÷ 3 = 60 mph.
```

It tolerates `A.` / `A)` / `(A)` choice markers and `Answer:` / `Correct
Answer:` / `Key:` labels. PDFs vary a lot — if nothing parses, the script
writes a raw text dump to `data/_pdf-dump.<section>.txt` so the patterns in
`scripts/import-pdf.js` (`CHOICE_RE`, `ANSWER_RE`, …) can be tuned to match
your file's layout.

> Importing is safe to re-run: questions are keyed by a stable id, so the
> database is updated in place rather than duplicated. Your daughter's
> progress (attempts, sessions, scores) is **never** touched by re-seeding.

---

## 🧠 How question selection works

When a new session starts for a section, the app builds the 40 questions as:

1. **Retakes first** — questions she previously got wrong (and hasn't yet
   mastered) so she can try them again.
2. **Then new questions** she has never seen, to fill up to 40.

Questions she answered **correctly** are excluded forever (mastered), and
questions locked inside an in-progress session aren't reused. If a section has
fewer than 40 questions left, the session uses what's available (import more
from your PDFs to expand the pool).

---

## 🗂️ Project structure

```
server.js                 Zero-dependency HTTP server + JSON API
repo.js                   Database queries + session/selection/scoring logic
db.js                     SQLite schema (built-in node:sqlite)
data/
  questions.math.json     Generated/imported Math questions
  questions.reading.json  Generated/imported Reading questions
scripts/
  generate-seed.js        Builds the starter bank
  reading-bank.js         Authored starter reading questions
  seed.js                 Loads data/*.json into the database
  import-pdf.js           Imports your PDFs into the question format
public/                   Front-end (HTML/CSS/JS, pink & white theme)
  index.html              Section choice + daily goal
  session.html            Practice + timer + review
  dashboard.html          Charts + filterable table
sat-practice.db           SQLite database (created on first run; not committed)
```

---

## 📊 Reporting

Open **Dashboard** from any page. You'll find:

- Today's progress toward the 40-question goal.
- Totals: attempts, correct, accuracy, average time per question, and how
  many questions are mastered in each section.
- Charts: daily activity, overall accuracy, accuracy by section, average
  time by section.
- A **Sessions** table (including paused ones, with resume links).
- An **All attempts** table you can filter by section, result, and text, then
  **Export to CSV** for your own reporting.

---

Made with 💖 for daily practice.
