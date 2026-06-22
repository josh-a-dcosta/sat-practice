# CLAUDE.md

Guidance for working in this repository. Read this first.

## What this is

A friendly **SAT practice web app** for a student (and family) to practice real
College Board questions daily, track progress, and prepare for the SAT on
2026-08-22. Questions are shown as **rendered PDF page images** (so equations and
figures are pixel-perfect); the correct answer is masked until answered/peeked.

It is deployed on **Railway** from the `main` branch (auto-deploys on push).

## Tech stack & hard constraints

- **Node.js ≥ 22.5** with the **built-in `node:sqlite`** (`DatabaseSync`). No ORM.
- **Zero runtime npm dependencies.** The server uses only Node core (`http`,
  `fs`, `path`, `crypto`, `node:sqlite`). Do **not** add Express/Fastify/better-sqlite3
  or any runtime dependency without a very good reason.
- **Frontend is vanilla JS** (no framework, no build step). One external CDN
  script: Chart.js on the dashboard only.
- **Python** is used **only offline** for the PDF import pipeline
  (`pypdfium2` to render pages, `pdfplumber` to read text). It never runs in
  production.
- Everything must keep running with `node --experimental-sqlite`.

## Commands

```bash
# Run the server locally against an ephemeral DB (recommended for testing)
SAT_DB_PATH=/tmp/dev.db PORT=4000 node --experimental-sqlite server.js

# Seed the DB from data/questions.*.json (idempotent, keyed by ext_id)
SAT_DB_PATH=/tmp/dev.db node --experimental-sqlite scripts/seed.js

# Production start (also what railway.toml uses)
npm start            # = node --experimental-sqlite server.js

# Import one College Board PDF -> data/questions.<slug>.json + page PNGs
python3 scripts/import-pdf-pages.py COLLEGEBOARD/<file>.pdf [slug]
```

There is **no test runner**. We verify changes with:

- `node -c <file>.js` — syntax check every JS file you touch (and extract +
  `node -c` the inline `<script>` in HTML pages).
- A throwaway server on a temp DB + `curl` smoke tests (login, hit endpoints,
  assert JSON with small `python3 -c` snippets). Always use
  `SAT_DB_PATH=/tmp/<name>.db` so you never touch real data; clean up after.
- For CSS, sanity-check brace balance:
  `python3 -c "s=open('public/css/styles.css').read(); print(s.count('{')==s.count('}'))"`.
- For PDF imports, the importer self-reconciles (see below).

## Project structure

```
server.js          HTTP server: static files + JSON API router + auth gate + auto-seed
repo.js            Data/business layer — ALL SQL lives here (sessions, rounds, scoring, dashboard)
db.js              Opens the SQLite DB, CREATE TABLE + idempotent ALTER migrations
auth.js            Loads COLLEGEBOARD/users.txt, login tokens, per-user theme
topics.js          The SAT taxonomy (domains -> topics) + validation helpers
railway.toml       Railway build/deploy; mounts the /data volume

public/
  index.html       Home: pick Math/Reading -> Difficulty -> Domain; per-skill mastery; start dialog
  session.html     The practice/test-taking screen (split PDF + answer panel)
  dashboard.html   Dashboard shell: top menu + view sections + review modal
  login.html       Login (gray theme, aspirational splash)
  css/styles.css   ALL styling (themeable CSS variables, dark mode)
  js/common.js     Shared: api() fetch wrapper, theme/dark-mode, top-bar user menu
  js/practice.js   Practice flow: timer, peek/timeout, feedback, map, review mode
  js/dashboard.js  Dashboard views, charts, tables, filters, calendar, tasks
  pdf/<slug>/      Rendered question/answer page PNGs (q_<qid>.png, a_<qid>.png)

data/
  questions.<slug>.json   One bank per section (e.g. algebra-medium). Seeded by ext_id.
  expected-counts.json    Source of truth: expected question count per of the 16 sections

scripts/
  import-pdf-pages.py  ACTIVE PDF import (render pages + parse answers + reconcile)
  seed.js              ACTIVE seeder: loads every data/questions.*.json (upsert)
  generate-seed.js, import-pdf.js, reading-bank.js  LEGACY/unused — do not wire into boot

COLLEGEBOARD/
  users.txt            username,password[,theme]  (managed by the owner, not an admin UI)
  *.pdf                Source College Board PDFs (one per section)
```

## Data model (SQLite)

- **users** — `id, username UNIQUE, password (plaintext, family use), theme`.
- **auth_tokens** — `token PRIMARY KEY, user_id`. Cookie `sat_auth` holds the token.
- **questions** — `ext_id UNIQUE`, `domain` (math|reading), `topic`, `difficulty`
  (medium|hard), `skill`, `qtype` (mcq|spr), `image`, `mask_fraction`,
  `answer_image`, `choices` (JSON), `correct` (letter for mcq; JSON array of
  acceptable strings for spr), `explanation`, `test`.
- **sessions** — one practice. `user_id, domain, topic, difficulty, round,
  time_limit_seconds, status (in_progress|completed), current_position, score`.
- **session_questions** — `session_id, question_id, position, elapsed_seconds, peeked`.
- **attempts** — one resolved question. `user_id, session_id, question_id,
  selected, is_correct, time_taken_seconds, over_limit, peeked`.
  UNIQUE(session_id, question_id) — a question is resolved exactly once per practice.
- **tasks** — Suggested Practice items. `user_id, due_date, domain/topic/difficulty/skill,
  title, detail, status (open|done)`.

Migrations are **additive only**: `CREATE TABLE IF NOT EXISTS` plus
`try { ALTER TABLE ... ADD COLUMN ... } catch {}`. Never drop/rename columns —
production has live data on the `/data` volume.

## Core domain concepts (don't break these)

- **Taxonomy** (`topics.js`): `domain` = math | reading; each has 4 `topic`s;
  each topic has `medium` and `hard`. 16 sections total. The student-facing
  hierarchy is **Round → Math/Reading → Difficulty → Domain(topic) → Skill → Question**.
- **Single active practice:** a user may have only ONE `in_progress` session at a
  time across all domains. `getActiveAny()` enforces this (keeps one, math-priority,
  deletes extras). Starting another returns HTTP 409 with `activeSessionId`.
- **Practice Rounds:** a *round* = one full pass through every question in a
  (domain, topic, difficulty). Within a round each question is shown once (any
  result). When all are covered, the next practice auto-starts the next round
  and **reopens all questions**. History is preserved (round stored per session).
  Selection is round-scoped and **shuffled per practice** (so no two users get
  the same order — anti-cheating requirement).
- **Per-question timer:** stored per session (`time_limit_seconds`). Defaults by
  round: R1 = 120s medium / 150s hard; R2+ = 60s / 120s. Adjustable in the Home
  start dialog. Full-length tests (future) will use overall-only timing.
- **Resolution model:** a question is resolved exactly once via **answer**, **peek**,
  or **timeout**. Peek and timeout never count as correct and are flagged
  (`peeked`, `over_limit`). Locked once resolved.
- **Answer security:** the correct answer/rationale is **never** sent to the client
  for an unanswered question. `publicQuestion()` strips it; `attemptFeedback()` is
  only attached after the question is resolved. Keep it that way.
- **Mastery:** a question is "mastered" if answered correctly at least once (ever).
- **Daily goal:** 40 Math + 40 Reading per practice day (Mon/Tue/Thu/Fri).

## PDF import pipeline

`scripts/import-pdf-pages.py <pdf> [slug]`:

1. Resolves the section (domain/topic/difficulty/slug + expected count) from
   `data/expected-counts.json` — by explicit slug or derived from the file name.
2. Renders each question page to `public/pdf/<slug>/q_<qid>.png` (pypdfium2,
   scale 2.0); answer-continuation pages to `a_<qid>.png`.
3. Parses the correct answer (MCQ letter or SPR acceptable values) and the
   `mask_fraction` (y-position of "Correct Answer"/"Rationale", buffered 16pt up).
4. **Reconciles before writing:** distinct `Question ID`s in the PDF vs extracted,
   vs the expected count. **Tolerance: import only if short by ≤ 5 questions;**
   short by more → write nothing (and delete any stale bank) so that section stays
   empty rather than wrong. Exits non-zero on rejection.

After importing: commit the JSON + PNGs, push, then on Railway run `npm run seed`
(or wipe the volume + restart). Re-running the importer is deterministic.

## Frontend conventions

- `api(method, path, body)` in `common.js` is the only fetch path. On 401 it
  redirects to `/login.html`; it throws an `Error` with `.status` and `.data`.
- **Theming:** all colors are CSS variables named `--pink-*` (historical name;
  they're really "accent" tokens). Per-user theme via `[data-theme=...]`
  (pink/blue/gray/green/yellow; **gray is default**). Dark mode via
  `[data-mode="dark"]` (default dark). A tiny inline `<head>` script sets both
  before paint to avoid flash. Brand icon follows the theme.
- **Charts** (Chart.js) must be rendered **when their view becomes visible**
  (dashboard view-switching) — a hidden `<canvas>` sizes to 0.
- Static assets are served with `Cache-Control: no-cache` (HTML/CSS/JS) so updates
  aren't stale; PNGs cache for a day. Safari still needs a one-time
  Develop → Empty Caches after the first deploy of this policy.
- Keep the **encouraging, kid-friendly tone** in user-facing copy.

## Coding standards

- **Match the surrounding code**: its naming, comment density, and idioms. This
  codebase favors compact, readable functions with a short comment explaining the
  *why* above non-obvious logic.
- CommonJS (`require`/`module.exports`), `'use strict'` at top of node modules.
- All SQL lives in `repo.js` (and `db.js` schema). Use prepared statements with
  `?` params — never string-concatenate user input into SQL.
- Every repo function that reads/writes user data takes `userId` and scopes by it.
- Prefer small, surgical edits over rewrites. Don't add dependencies.
- 2-space indentation; semicolons; single quotes in JS.

## users.txt

`COLLEGEBOARD/users.txt`, one user per line: `username,password[,theme]`
(`:` also works as a separator; `#` comments). Theme is pink|blue|gray|green|yellow
(default gray). Loaded into the `users` table at boot (upsert; removing a line
does not delete the user). There is intentionally **no admin UI**.

## Git & deployment workflow

- Work on `main` (that's what Railway deploys). Commit when a unit of work is
  done and verified; push to `origin main`.
- Commit messages: concise imperative subject + a short body explaining the
  change, ending with the `Co-Authored-By:` trailer.
- Push with retry/rebase: `git fetch origin main && git pull --rebase origin main`
  then `git push -u origin main` (the owner sometimes edits `users.txt`/files on
  GitHub, causing rebases — resolve keeping their intent).
- **Railway:** auto-deploys `main`. The `/data` volume persists the SQLite DB.
  Schema changes auto-migrate. To load new questions on an existing volume run
  `npm run seed` in the Railway shell; for a clean slate use **Wipe Volume +
  Restart** (auto-seed runs only when the DB is empty). The DB file is
  `/data/sat-practice.db`.

## Known gotchas

- The auto-seed in `server.js` only runs when `questions` is empty; it loads
  **only** `data/questions.*.json` (no generated starter banks).
- `node --experimental-sqlite` prints an ExperimentalWarning — filter it in test
  output (`grep -v Experimental`).
- Practice opens in full-screen layout by default; Home/Dashboard links live in
  the in-page toolbar too, because the top bar is hidden in full-screen.
