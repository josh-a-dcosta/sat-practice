#!/usr/bin/env python3
"""
Import a College Board PDF question bank as page IMAGES (so equations/figures
render perfectly) plus per-question metadata for the app to track answers.

For each question we record:
  - ext_id            stable Question ID from the PDF
  - domain/topic/diff College Board taxonomy
  - skill             the "Skill" cell (sub-topic)
  - qtype             'mcq' (A-D choices) or 'spr' (student-produced response)
  - choices           ['A','B','C','D'] for mcq, [] for spr
  - correct           letter for mcq; list of acceptable strings for spr
  - image             rendered page image (question + choices visible)
  - mask_fraction     vertical fraction where "Correct Answer" begins; the app
                      masks everything from here down until she reveals it
  - answer_image      extra image for multi-page questions (answer on later page)

USAGE: python3 scripts/import-pdf-pages.py <pdf> [slug]

  <pdf>   path to the College Board PDF
  [slug]  one of the 16 section slugs in data/expected-counts.json
          (e.g. advmath-medium). If omitted, it is derived from the file name.

The section's domain/topic/difficulty/expected-count are all looked up from
data/expected-counts.json, so the file is the single source of truth.
"""
import sys, os, re, json
import pdfplumber
import pypdfium2 as pdfium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED_FILE = os.path.join(ROOT, 'data', 'expected-counts.json')
SCALE = 2.0
VALUE_RE = re.compile(r'^-?\$?\d*\.?\d+(?:/\d*\.?\d+)?%?$')


def load_manifest():
    with open(EXPECTED_FILE) as f:
        return json.load(f).get('sections', [])


def resolve_section(pdf_path, slug_arg):
    """Find the manifest section for this import, by explicit slug or by
    matching the PDF file name against the known section slugs."""
    sections = load_manifest()
    by_slug = {s['slug']: s for s in sections}

    if slug_arg:
        if slug_arg not in by_slug:
            sys.exit(f'ERROR: slug "{slug_arg}" is not in {EXPECTED_FILE}. '
                     f'Valid slugs: {", ".join(sorted(by_slug))}')
        return by_slug[slug_arg]

    name = os.path.basename(pdf_path).lower()
    diff = 'hard' if 'hard' in name else ('medium' if 'medium' in name else None)
    if not diff:
        sys.exit(f'ERROR: could not find "medium" or "hard" in file name "{name}". '
                 f'Pass the slug explicitly, e.g. advmath-hard.')
    # topic stem = slug without its trailing -medium/-hard; match longest in name
    stems = sorted({s['slug'].rsplit('-', 1)[0] for s in sections}, key=len, reverse=True)
    stem = next((st for st in stems if st in name), None)
    if not stem:
        sys.exit(f'ERROR: could not recognize the domain in file name "{name}". '
                 f'Pass the slug explicitly. Known stems: {", ".join(sorted(stems))}')
    slug = f'{stem}-{diff}'
    if slug not in by_slug:
        sys.exit(f'ERROR: derived slug "{slug}" is not in the manifest.')
    return by_slug[slug]


PDF = sys.argv[1] if len(sys.argv) > 1 else 'COLLEGEBOARD/math-algebra-medium-2026-6-17.pdf'
SECTION = resolve_section(PDF, sys.argv[2] if len(sys.argv) > 2 else None)
TOPIC = SECTION['topic']
DIFF = SECTION['difficulty']
SLUG = SECTION['slug']
DOMAIN = SECTION['domain']
EXPECTED = SECTION.get('expected')

IMG_DIR = os.path.join(ROOT, 'public', 'pdf', SLUG)
DATA_PATH = os.path.join(ROOT, 'data', f'questions.{SLUG}.json')
os.makedirs(IMG_DIR, exist_ok=True)

def clean_vals(tokens):
    out = []
    for t in tokens:
        t = t.strip().strip('.').replace('$', '')
        if t and VALUE_RE.match(t) and t not in out:
            out.append(t)
    return out

def group_lines(words):
    lines = {}
    for w in words:
        lines.setdefault(round(w['top']), []).append(w)
    return [sorted(lines[k], key=lambda w: w['x0']) for k in sorted(lines)]

def extract_skill(page):
    """Read the 'Skill' cell from the College Board metadata table using the
    header column x-positions. The skill text can wrap across several lines."""
    words = page.extract_words()
    lines = group_lines(words)
    skill_x = diff_x = hidx = None
    for i, ln in enumerate(lines):
        texts = [w['text'] for w in ln]
        if 'Skill' in texts and 'Difficulty' in texts and 'Domain' in texts:
            hidx = i
            skill_x = next(w['x0'] for w in ln if w['text'] == 'Skill')
            diff_x = next(w['x0'] for w in ln if w['text'] == 'Difficulty')
            break
    if hidx is None:
        return None
    out = []
    for ln in lines[hidx + 1:]:
        txt = ' '.join(w['text'] for w in ln).strip()
        if txt.startswith(('Question', 'Answer', 'Rationale')):
            break
        for w in ln:
            if skill_x - 3 <= w['x0'] < diff_x - 3:
                out.append(w['text'])
    return ' '.join(out).strip() or None

def parse_correct(text):
    # 1) Explicit "Correct Answer:" label (multiple choice or some grid-ins)
    m = re.search(r'Correct Answer:\s*(.+)', text)
    if m:
        raw = m.group(1).split('\n')[0].strip()
        if re.fullmatch(r'[A-D]', raw):
            return 'mcq', raw
        vals = clean_vals(re.split(r'[,;]', raw))
        if vals:
            return 'spr', vals

    # 2) Multiple-choice where the answer is only stated in the rationale.
    if re.search(r'^A\.', text, re.M):
        cm = re.search(r'Choice\s+([A-D])\s+is correct', text)
        if cm:
            return 'mcq', cm.group(1)

    # 3) Grid-in questions state the answer in the rationale prose.
    acceptable = []
    pm = re.search(r'The correct answer is\s+([^\.\n]+)', text)
    if pm:
        acceptable += clean_vals(re.split(r'[,;]|\band\b', pm.group(1)))
    ex = re.search(r'Note that\s+(.+?)\s+are examples of ways to enter a correct answer', text, re.S)
    if ex:
        acceptable += clean_vals(re.split(r'[,;]|\band\b', ex.group(1)))
    # de-dup preserving order
    seen = []
    for v in acceptable:
        if v not in seen:
            seen.append(v)
    if seen:
        return 'spr', seen
    return None, None

def main():
    plumb = pdfplumber.open(PDF)
    pdf   = pdfium.PdfDocument(PDF)
    pages = plumb.pages
    n = len(pages)

    # text + qid per page
    info = []
    for i, pg in enumerate(pages):
        t = pg.extract_text() or ''
        m = re.search(r'Question ID:\s*([0-9a-fA-F]+)', t)
        info.append({'page': i, 'text': t, 'qid': m.group(1) if m else None})

    # group pages into questions: a qid page + following non-qid pages
    questions = []
    i = 0
    while i < n:
        if not info[i]['qid']:
            i += 1
            continue
        start = i
        j = i + 1
        while j < n and not info[j]['qid']:
            j += 1
        questions.append(list(range(start, j)))  # page indexes for this question
        i = j

    out = []
    skipped = []   # (qid, reason) for any question we could not fully parse
    for pageset in questions:
        primary = pageset[0]
        text_all = '\n'.join(info[p]['text'] for p in pageset)
        qid = info[primary]['qid']

        # skill (sub-topic) from the metadata table row, read by column position
        skill = extract_skill(pages[primary])

        qtype, correct = parse_correct(text_all)
        if qtype is None:
            # no correct answer found anywhere; record so the tally flags it
            skipped.append((qid, 'no correct answer parsed'))
            continue
        choices = ['A','B','C','D'] if qtype == 'mcq' else []

        # locate "Correct Answer" y on whichever page it is
        mask_fraction = 1.0
        answer_page_idx = None
        # search for whichever answer marker appears: "Correct Answer",
        # "The correct answer is", or "Choice X is correct" in the rationale.
        for p in pageset:
            pg = pages[p]
            hits = (pg_search(pg, 'Correct Answer')
                    or pg_search(pg, 'Rationale'))
            if hits:
                # Buffer upward by ~16pt so the marker line is fully covered,
                # never leaving the answer letter peeking above the mask.
                top = max(0.0, hits[0]['top'] - 16)
                if p == primary:
                    mask_fraction = max(0.0, min(1.0, top / pg.height))
                else:
                    answer_page_idx = p
                break

        # render primary page -> question image
        qimg = f'q_{qid}.png'
        render_page(pdf, primary, os.path.join(IMG_DIR, qimg))

        # if the answer lives on a later page, render that as the answer image
        answer_image = None
        if answer_page_idx is not None:
            aimg = f'a_{qid}.png'
            render_page(pdf, answer_page_idx, os.path.join(IMG_DIR, aimg))
            answer_image = f'/pdf/{SLUG}/{aimg}'

        out.append({
            'ext_id': f'cb-{SLUG}-{qid}',
            'domain': DOMAIN, 'topic': TOPIC, 'difficulty': DIFF,
            'source': 'collegeboard',
            'test': 'SAT', 'skill': skill,
            'qtype': qtype,
            'choices': [{'label': c} for c in choices],
            'correct': correct if qtype == 'mcq' else json.dumps(correct),
            'image': f'/pdf/{SLUG}/{qimg}',
            'mask_fraction': round(mask_fraction, 4),
            'answer_image': answer_image,
            'prompt': f'Question {qid}',
        })

    mcq = sum(1 for q in out if q['qtype'] == 'mcq')
    spr = sum(1 for q in out if q['qtype'] == 'spr')
    print(f'Extracted {len(out)} questions ({mcq} multiple-choice, {spr} free-response)')
    print(f'Images -> {IMG_DIR}')

    # ---- Reconcile BEFORE writing any data, so a bad import loads nothing ----
    pdf_qids = [info[p]['qid'] for p in range(n) if info[p]['qid']]
    distinct_pdf = set(pdf_qids)
    extracted = {q['ext_id'].rsplit('-', 1)[-1] for q in out}
    missing = distinct_pdf - extracted
    dupes = len(pdf_qids) - len(distinct_pdf)
    print('\n--- Question tally (PDF vs extracted) ---')
    print(f'  Question IDs in PDF (distinct): {len(distinct_pdf)}')
    print(f'  Questions extracted           : {len(extracted)}')
    if dupes:
        print(f'  Note: {dupes} duplicate Question ID line(s) in the PDF (counted once).')

    failed = False
    if missing:
        print(f'  ❌ MISSING {len(missing)} question(s):')
        reasons = dict(skipped)
        for qid in sorted(missing):
            print(f'      {qid}  ({reasons.get(qid, "unknown reason")})')
        failed = True
    else:
        print('  ✅ Every Question ID in the PDF was extracted — none lost.')

    # ---- Must match the remembered expected count for this section ----
    print('\n--- Expected count check (data/expected-counts.json) ---')
    if EXPECTED is None:
        print(f'  ❌ No expected count recorded for slug "{SLUG}". '
              f'Add one to data/expected-counts.json before importing.')
        failed = True
    elif EXPECTED == len(out):
        print(f'  ✅ Extracted {len(out)} matches the expected {EXPECTED} for "{SLUG}".')
    else:
        print(f'  ❌ Count MISMATCH for "{SLUG}": expected {EXPECTED}, extracted {len(out)} '
              f'(difference {len(out) - EXPECTED:+d}).')
        failed = True

    if failed:
        # Hard fail: do NOT write the data file, and remove any stale one so this
        # domain+difficulty has ZERO questions rather than a wrong/partial set.
        if os.path.exists(DATA_PATH):
            os.remove(DATA_PATH)
            print(f'\n  Removed stale {os.path.basename(DATA_PATH)} so this section stays empty.')
        print('\n⚠️  Import REJECTED — counts do not match. No questions written for '
              f'{TOPIC}/{DIFF}. Fix the PDF or parser and re-run.')
        sys.exit(1)

    with open(DATA_PATH, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'\nData  -> {DATA_PATH}')
    print('✅ Import reconciled: PDF, extraction, and expected count all agree.')

def pg_search(pg, phrase):
    try:
        res = pg.search(phrase)
        if res:
            return [{'top': r['top']} for r in res]
    except Exception:
        pass
    # fallback: word scan for the first word of the phrase
    first = phrase.split()[0]
    words = pg.extract_words()
    for w in words:
        if w['text'] == first:
            return [{'top': w['top']}]
    return []

def render_page(pdf, idx, path):
    page = pdf[idx]
    bmp = page.render(scale=SCALE)
    img = bmp.to_pil()
    img.save(path, optimize=True)

if __name__ == '__main__':
    main()
