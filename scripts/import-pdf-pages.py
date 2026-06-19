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

USAGE: python3 scripts/import-pdf-pages.py <pdf> <topic> <difficulty> <source-slug>
"""
import sys, os, re, json
import pdfplumber
import pypdfium2 as pdfium

PDF   = sys.argv[1] if len(sys.argv) > 1 else 'COLLEGEBOARD/math-algebra-medium-2026-6-17.pdf'
TOPIC = sys.argv[2] if len(sys.argv) > 2 else 'algebra'
DIFF  = sys.argv[3] if len(sys.argv) > 3 else 'medium'
SLUG  = sys.argv[4] if len(sys.argv) > 4 else 'algebra-medium'
DOMAIN = 'reading' if TOPIC in ('information-ideas','craft-structure','expression-ideas','standard-conventions') else 'math'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'public', 'pdf', SLUG)
os.makedirs(IMG_DIR, exist_ok=True)
SCALE = 2.0

VALUE_RE = re.compile(r'^-?\$?\d*\.?\d+(?:/\d*\.?\d+)?%?$')

def clean_vals(tokens):
    out = []
    for t in tokens:
        t = t.strip().strip('.').replace('$', '')
        if t and VALUE_RE.match(t) and t not in out:
            out.append(t)
    return out

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
    for pageset in questions:
        primary = pageset[0]
        text_all = '\n'.join(info[p]['text'] for p in pageset)
        qid = info[primary]['qid']

        # skill (sub-topic) from the metadata table row
        skill = ''
        sm = re.search(r'SAT\s+(?:Math|Reading and Writing|Reading & Writing)\s+\S.*?\n?(.*?)\n?(?:Medium|Hard|Easy)', info[primary]['text'])
        # simpler: capture text between Domain value and Difficulty word is unreliable; skip if messy

        qtype, correct = parse_correct(text_all)
        if qtype is None:
            # no correct answer found anywhere; skip
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
            'qtype': qtype,
            'choices': [{'label': c} for c in choices],
            'correct': correct if qtype == 'mcq' else json.dumps(correct),
            'image': f'/pdf/{SLUG}/{qimg}',
            'mask_fraction': round(mask_fraction, 4),
            'answer_image': answer_image,
            'prompt': f'Question {qid}',
        })

    data_path = os.path.join(ROOT, 'data', f'questions.{SLUG}.json')
    with open(data_path, 'w') as f:
        json.dump(out, f, indent=2)

    mcq = sum(1 for q in out if q['qtype'] == 'mcq')
    spr = sum(1 for q in out if q['qtype'] == 'spr')
    print(f'Imported {len(out)} questions ({mcq} multiple-choice, {spr} free-response)')
    print(f'Images -> {IMG_DIR}')
    print(f'Data   -> {data_path}')

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
