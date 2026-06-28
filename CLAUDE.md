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
auth.js            DB-backed users/roles/assignments + login tokens + active role/student context (Admin-managed; no users.txt)
topics.js          The SAT taxonomy (domains -> topics) + validation helpers
railway.toml       Railway build/deploy; mounts the /data volume

public/
  index.html       Home: pick Math/Reading -> Difficulty -> Domain; per-skill mastery; start dialog
  session.html     The practice/test-taking screen (split PDF + answer panel)
  dashboard.html   Dashboard shell: top menu + view sections + review modal
  login.html       Login (gray theme, aspirational splash)
  select.html      Role / student picker (multi-role users choose after login)
  settings.html    A student's own per-question timer grid
  admin.html       Admin console: users, roles, assignments, global + per-user timers
  css/styles.css   ALL styling (themeable CSS variables, dark mode)
  js/common.js     Shared: api(), theme/dark-mode, per-role nav + page guards
  js/practice.js   Practice flow: timer, peek/timeout, feedback, map, review mode
  js/dashboard.js  Dashboard views, charts, tables, filters, calendar, tasks
  js/admin.js      Admin console logic
  pdf/<slug>/      Rendered question/answer page PNGs (q_<qid>.png, a_<qid>.png)

data/
  questions.<slug>.json   One bank per section (e.g. algebra-medium). Seeded by ext_id.
  expected-counts.json    Source of truth: expected question count per of the 16 sections

scripts/
  import-pdf-pages.py  ACTIVE PDF import (render pages + parse answers + reconcile)
  seed.js              ACTIVE seeder: loads every data/questions.*.json (upsert)
  generate-seed.js, import-pdf.js, reading-bank.js  LEGACY/unused — do not wire into boot

COLLEGEBOARD/
  *.pdf                Source College Board PDFs (one per section)
```

## Data model (SQLite)

- **users** — `id, username UNIQUE, password (plaintext, family use), theme, full_name`.
- **user_roles** — `(user_id, role)` UNIQUE; role ∈ student|tutor|admin (many per user).
- **tutor_students** — `(tutor_id, student_id)` UNIQUE; many-to-many tutor↔student.
- **settings_global / settings_user** — per-question timers keyed by
  `(topic, difficulty, round_tier)` (+ `user_id` for the user table). `auth_tokens`
  also carries `active_role` / `active_student_id` (the signed-in context).
- **auth_tokens** — `token PRIMARY KEY, user_id`. Cookie `sat_auth` holds the token.
- **questions** — `ext_id UNIQUE`, `domain` (math|reading), `topic`, `difficulty`
  (medium|hard), `skill`, `qtype` (mcq|spr), `image`, `mask_fraction`,
  `answer_image`, `choices` (JSON), `correct` (letter for mcq; JSON array of
  acceptable strings for spr), `explanation`, `test`.
- **sessions** — one **round** (a round *is* the practice now). `user_id, domain,
  topic, difficulty, round, time_limit_seconds, status (in_progress|completed),
  current_position, score`. Holds **all** the section's questions (no size cap).
- **session_questions** — `session_id, question_id, position, elapsed_seconds,
  peeked, status (pending|correct|wrong|peeked|timedout|skipped), resolved_at`.
  `status` is the question's current state within the round; drives % complete.
- **attempts** — the latest **terminal** resolution (correct/wrong/peeked/timedout)
  of a question. `user_id, session_id, question_id, selected, is_correct,
  time_taken_seconds, over_limit, peeked`. UNIQUE(session_id, question_id). Skips
  do **not** write here.
- **activity_events** — append-only **daily log**: one row per action, including
  **skips** and re-resolutions. `user_id, session_id, question_id,
  domain/topic/difficulty/skill, round, status, selected, time_taken_seconds,
  over_limit, occurred_at`. This is the **source of truth** for the calendar,
  daily summaries, and weekly reports (grouped by `date(occurred_at,'localtime')`).
- **tasks** — Suggested Practice items. `user_id, due_date, domain/topic/difficulty/skill,
  title, detail, status (open|done)`.

Migrations are **additive only**: `CREATE TABLE IF NOT EXISTS` plus
`try { ALTER TABLE ... ADD COLUMN ... } catch {}`. Never drop/rename columns —
production has live data on the `/data` volume.

## Core domain concepts (don't break these)

- **Taxonomy** (`topics.js`): `domain` = math | reading; each has 4 `topic`s;
  each topic has `medium` and `hard`. 16 sections total. The student-facing
  hierarchy is **Round → Math/Reading → Difficulty → Domain(topic) → Skill → Question**.
- **Round = practice:** a *round* = one full pass through **every** question in a
  (domain, topic, difficulty) section. A round *is* the practice — there's no
  40-question cap; it holds all the section's questions, seeded as `pending` and
  shuffled per round (anti-cheating). A round spans days/weeks. It **completes**
  only when nothing is left `pending` or `skipped` (auto-completes on the last
  resolution). Starting again then opens the **next round** (reopens all). Rounds
  advance **independently per section** (Algebra·Medium can be on Round 3 while
  PADS·Hard is on Round 1). Medium and Hard are separate rounds, reported separately.
- **Multiple active rounds:** a user may have **one `in_progress` round per
  section**, and **many across sections** at once. `createOrResumeSession` resumes
  this section's open round or starts the next one; `listActiveSessions` powers the
  Home quick-resume strip. (The old single-active rule is gone.)
- **Per-question timer:** stored per session (`time_limit_seconds`). Defaults by
  round: R1 = 120s medium / 150s hard; R2+ = 60s / 120s. Adjustable in the Home
  start dialog. Full-length tests (future) will use overall-only timing.
- **Resolution model:** a question is resolved once via **answer**, **peek**, or
  **timeout** (writes `attempts` + an `activity_events` row, sets `status`). It can
  also be **skipped** (deferred): `status='skipped'`, a skip event is logged each
  time, no `attempts` row — it resurfaces later in the round. **Accuracy = correct ÷
  resolved**; peeked/timedout/skipped count as **not correct** but are tracked and
  shown separately.
- **Answer security:** the correct answer/rationale is **never** sent to the client
  for an unanswered question. `publicQuestion()` strips it; `attemptFeedback()` is
  only attached after the question is resolved. Keep it that way.
- **Mastery:** a question is "mastered" if answered correctly at least once (ever).
  **Skills-to-focus** instead uses the **grand current state** — each question's
  *latest* result across all rounds (`getSkillFocus`).

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

## Users, roles & settings

- **No more `users.txt`** — users live in the DB. `auth.bootstrap()` seeds the
  initial accounts (idempotent, with passwords/themes/full names) and is the
  fallback for a fresh volume; **the Admin UI is the source of truth** from there.
- **Roles** (`user_roles`, many-to-many): `student | tutor | admin`. A user may
  hold several. At login a single-role user is auto-selected; multi-role users
  pick on `select.html` (tutors then pick a student). The active role/student is
  stored on the **auth token** (`active_role`, `active_student_id`) and read via
  `/api/me`, so navigation is seamless (no URL/back-button juggling). A "Switch"
  control re-opens the picker.
- **Per-role access** (enforced server-side, not just hidden in nav):
  **student** → Home, Dashboard, Settings (own data); **tutor** → read-only
  Dashboard of an assigned student only (`tutor_students`, many-to-many; all
  writes 403); **admin** → `/api/admin/*` only (manage users, roles,
  assignments, global + per-user timers).
- **Timer settings** (`settings_global`, `settings_user`) keyed by
  **(topic, difficulty, round_tier)** where tier 1 = Round 1, 2 = Round 2+.
  `repo.resolveTimer` = user override → global default → **10 min**; it drives the
  start-round default (the start dialog still tweaks one round). Users edit their
  own grid on `settings.html`; admins edit global + any user's grid.

## Git & deployment workflow

- Work on `main` (that's what Railway deploys). Commit when a unit of work is
  done and verified; push to `origin main`.
- Commit messages: concise imperative subject + a short body explaining the
  change, ending with the `Co-Authored-By:` trailer.
- Push with retry/rebase: `git fetch origin main && git pull --rebase origin main`
  then `git push -u origin main` (the owner sometimes edits files on GitHub,
  causing rebases — resolve keeping their intent).
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
