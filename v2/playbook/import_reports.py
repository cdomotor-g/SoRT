#!/usr/bin/env python3
"""Import FWIN site assessment reports (Word) into the SoRT playbook.

    python3 -I tools/import_reports.py --defs ../SoRT/v2/definitions.json report1.docx report2.docx ...

For each report it reads:
  * the station heading ("Bengalla TM – 41506");
  * the "SORT Forum Agreed remediation" cell: every forum sitting (date,
    attendees, what was said) and the SoRT scope table + Property Services
    table pasted into it from the scope builder;
and writes stations/<number>.json in the playbook's format (one session per
forum sitting, the last carrying the table's answers as question codes), then
asks Flood-Net's public API for the station's position and particulars.

It keeps no landholder details: the "Landowner Feedback" sections are never
read, quoted correspondence inside the forum notes is replaced by a marker,
and anything that looks like a phone number, email address or gate / padlock /
key code is removed. Review every file before committing it anyway.
"""
import argparse, json, re, sys, uuid, unicodedata, urllib.request, urllib.parse, ssl, os, datetime
import docx
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

API = 'https://floodwarning.net/api/v1'

def norm(s):
    s = unicodedata.normalize('NFKC', str(s or '')).replace('–', '-').replace('—', '-').replace(' ', ' ')
    return re.sub(r'\s+', ' ', s).strip().lower().rstrip(':').strip()

SCRUB = [
    (re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+'), '[email removed]'),
    (re.compile(r'(?:\+?61[\s-]?|\b0)[2-478](?:[\s-]?\d){8}\b'), '[phone removed]'),
    (re.compile(r'\b(?:gate|padlock|lock|key|combo|combination|access)\s*(?:code|no\.?|number|#)?\s*(?:is|=|:)?\s*\d{3,8}\b', re.I), '[code removed]'),
]
def scrub(t):
    for rx, rep in SCRUB: t = rx.sub(rep, t)
    return t

def blocks(el, parent):
    for child in el.iterchildren():
        if child.tag == qn('w:p'): yield Paragraph(child, parent)
        elif child.tag == qn('w:tbl'): yield Table(child, parent)

def cell_paras(cell):
    # A paragraph can hold line breaks (Word's Shift+Enter): each line is its own entry.
    out = []
    for p in cell.paragraphs:
        out.extend(x.strip() for x in p.text.split('\n') if x.strip())
    return out

def table_rows(tbl):
    """Rows as lists of (deduplicated) cells, each a list of paragraph texts."""
    out = []
    for r in tbl.rows:
        seen, cells = [], []
        for c in r.cells:
            if c._tc in seen: continue
            seen.append(c._tc); cells.append(c)
        out.append(cells)
    return out

def load_defs(path):
    d = json.load(open(path, encoding='utf-8'))
    return d

def template_questions(defs, tid):
    t = next(t for t in defs['templates'] if t['id'] == tid)
    out = []
    for e in t['questions']:
        code = e if isinstance(e, str) else e['q']
        q = dict(defs['questions'][code]); 
        if isinstance(e, dict): q.update({k: v for k, v in e.items() if k != 'q'})
        q['code'] = code
        out.append(q)
    return out

def flat_options(q):
    out = []
    for o in q.get('options') or []:
        out.extend(o['options'] if 'options' in o else [o])
    return out

# Labels the v1 tables used that v2 words differently.
ALIASES = {'reason for changing comms type': 'commsChange'}

def match_option(q, text):
    t = norm(text)
    for o in flat_options(q):
        if norm(o['label']) == t: return o
    # "Low Complexity Remediation – Raintree Retrofit" vs labels with spare spaces
    for o in flat_options(q):
        if norm(o['label']).replace(' ', '') == t.replace(' ', ''): return o
    return None

def parse_scope_table(defs, rows):
    """The scope builder's pasted table → (template, header facts, answers)."""
    head = {}; tpl = None; answers = {}; started = False
    titles = {norm(t['title']): t['id'] for t in defs['templates'] if t['id'] != 'colocated'}
    for cells in rows:
        texts = [cell_paras(c) for c in cells]
        first = ' '.join(texts[0]) if texts else ''
        if len(cells) == 1 or (len(texts) == 2 and ' '.join(texts[0]) == ' '.join(texts[1])):
            m = re.match(r'sort forum date:?\s*(.*)', first, re.I)
            if m: head['date'] = m.group(1).strip(); continue
            m = re.match(r'sort forum attendees:?\s*(.*)', first, re.I)
            if m: head['attendees'] = m.group(1).strip(); continue
            if norm(first) in titles: tpl = titles[norm(first)]
            continue
        if norm(first) == 'item': started = True; continue
        if not started or not tpl: continue
        label, lines = first, (texts[1] if len(texts) > 1 else [])
        qs = template_questions(defs, tpl)
        code = ALIASES.get(norm(label)) or next((q['code'] for q in qs if norm(q['label']) == norm(label)), None)
        if not code or not lines: continue
        q = next(q for q in qs if q['code'] == code)
        a = {'value': [] if q['type'] == 'multi' else None, 'labels': [], 'other': '', 'fields': {}, 'note': '', 'src': 'report'}
        notes = []
        for line in lines:
            line = scrub(line)
            o = match_option(q, line) if q['type'] != 'none' else None
            if code == 'commsChange':
                if norm(line) in ('na', 'no'): a['value'] = 'none'; a['labels'] = ['No change']; continue
                if norm(line) == 'yes': continue
                m = re.match(r'reason(?: \(if yes\))?:\s*(.*)', line, re.I)
                if m:
                    r = m.group(1).strip(); a['fields']['reason'] = r
                    fam = lambda s: 'cellular' if re.search(r'cell|3g|4g', s, re.I) else 'satellite' if re.search(r'sat', s, re.I) else 'errts' if re.search(r'errts|alert|vhf', s, re.I) else None
                    parts = re.split(r'\bto\b', r, flags=re.I)
                    if len(parts) == 2 and fam(parts[0]) and fam(parts[1]) and fam(parts[0]) != fam(parts[1]):
                        code2 = f'{fam(parts[0])}_to_{fam(parts[1])}'
                        oo = next((x for x in flat_options(q) if x['code'] == code2), None)
                        if oo: a['value'] = oo['code']; a['labels'] = [oo['label']]
                    continue
                notes.append(line); continue
            if o:
                if q['type'] == 'multi': a['value'].append(o['code']); a['labels'].append(o['label'])
                else: a['value'] = o['code']; a['labels'] = [o['label']]
                continue
            m = re.match(r'([^:]{2,120}):\s*(.*)$', line)
            if m and q.get('fields'):
                f = next((f for f in q['fields'] if norm(f['label']) == norm(m.group(1))), None)
                if f: a['fields'][f['code']] = m.group(2).strip(); continue
            if q['type'] == 'none' and q.get('fields') and len(q['fields']) == 1 and not a['fields']:
                a['fields'][q['fields'][0]['code']] = line; continue
            notes.append(line)
        a['note'] = '\n'.join(notes)
        if a['value'] in (None, []) and not a['fields'] and not a['note']: continue
        answers[code] = a
    return tpl, head, answers

PS_MAP = {
    'is the equipment being relocated?': 'relocating', 'does the work require the turning of soil?': 'turnSoil',
    'will the orifice line be replaced?': 'orificeReplace', 'what direction does the orifice line run from the primary equipment?': 'orificeDirection',
}
def parse_ps_table(rows):
    ps, group, comments = {}, None, []
    for cells in rows:
        texts = [' / '.join(cell_paras(c)) for c in cells]
        if not texts or not texts[0]: continue
        same = len(texts) == 1 or texts[0] == texts[-1]
        label = texts[0]; val = scrub(texts[-1]) if not same else ''
        n = norm(label)
        if same:
            if n.startswith('current co-ordinates'): group = 'currentCoords'
            elif n.startswith('relocation co-ordinates'): group = 'relocationCoords'
            elif n.startswith('note') and len(n) > 6 and not n.startswith('note to ps') and 'property services conducts' not in n:
                comments.append(scrub(re.sub(r'^note:?\s*', '', label, flags=re.I)))
            continue
        if group and n.startswith('primary'): ps[f'{group}.primary'] = val; continue
        if group == 'currentCoords' and n.startswith('subsidiary'): ps['currentCoords.subsidiary'] = val; continue
        if group == 'relocationCoords' and n.startswith('orifice'): ps['relocationCoords.orifice'] = val; continue
        if group == 'relocationCoords' and n.startswith('rain gauge'): ps['relocationCoords.raingauge'] = val; group = None; continue
        if n in PS_MAP:
            key = PS_MAP[n]
            ps[key] = norm(val) if key != 'orificeDirection' else val
            continue
        if n.startswith('date'): ps['date'] = val
    return ps, comments

# Only what the notes say outright: a visit or data *required*, a set-back, or "SoRT Complete".
OUTCOME_RULES = [
    (re.compile(r'sort complete', re.I), 'complete'),
    (re.compile(r'set back to sort|sort revisit', re.I), 'revisit'),
    (re.compile(r'additional site visit|site (?:visit|investigation|selection)[^.]{0,40}required|required[^.]{0,20}site visit', re.I), 'site_visit'),
    (re.compile(r'(?:more|additional) data required', re.I), 'more_data'),
]
def iso_date(s):
    m = re.search(r'(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})', s or '')
    if not m: return ''
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100: y += 2000
    return f'{y:04d}-{mo:02d}-{d:02d}'

def initials(s):
    s = re.sub(r'\(.*?\)', '', s or '')
    return [x for x in re.split(r'[,\s]+', s) if x and re.fullmatch(r'[A-Za-z]{1,6}', x) and x.lower() not in ('and', 'the', 'only')]

def parse_forum_cell(defs, cell):
    """Every forum sitting in the 'SORT Forum Agreed remediation' cell."""
    sittings, cur, in_quote = [], None, False
    for b in blocks(cell._tc, cell):
        if isinstance(b, Table):
            rows = table_rows(b)
            first = ' '.join(cell_paras(rows[0][0])) if rows and rows[0] else ''
            if cur is None: cur = {'date': '', 'attendees': [], 'notes': [], 'tables': []}; sittings.append(cur)
            cur['tables'].append((norm(first), rows))
            continue
        t = b.text.strip()
        if not t: continue
        if re.match(r'^(sort forum )?date\b', t, re.I):
            cur = {'date': iso_date(t), 'attendees': [], 'notes': [], 'tables': []}; sittings.append(cur)
            continue
        if cur is None: cur = {'date': '', 'attendees': [], 'notes': [], 'tables': []}; sittings.append(cur)
        m = re.match(r'^(?:sort forum )?attendees:?\s*(.*)', t, re.I)
        if m: cur['attendees'] = initials(m.group(1)); continue
        if norm(t) in ('sort forum agreed remediation',): continue
        # Quoted correspondence (e.g. a landowner's email) is not kept.
        opens, closes = t.count('“') + t.count('"'), t.count('”') + t.count('"')
        if in_quote or t.startswith('“') or (t.startswith('"') and len(t) > 1):
            if not in_quote: cur['notes'].append('[Quoted correspondence removed — see the assessment report.]')
            in_quote = not (t.rstrip().endswith('”') or (t.rstrip().endswith('"') and len(t) > 1) or t.rstrip().endswith('"."') or t.rstrip().endswith('”.'))
            continue
        if '“' in t and '”' not in t:
            cur['notes'].append(scrub(t.split('“')[0]).strip() + ' [quoted correspondence removed — see the assessment report]')
            in_quote = True; continue
        cur['notes'].append(scrub(t))
    return sittings

def floodnet(number):
    ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or None)
    url = f'{API}/stations?' + urllib.parse.urlencode({'q': number, 'limit': 3, 'client': 'sort-playbook-import'})
    req = urllib.request.Request(url, headers={'User-Agent': 'sort-playbook-import/1 (+https://github.com/cdomotor-g/SoRT)', 'X-FloodNet-Client': 'sort-playbook-import', 'Accept': 'application/json'})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=20, context=ctx))
        for s in d.get('stations', []):
            if str(s.get('station_number') or '').lstrip('0') == str(number).lstrip('0'): return s
    except Exception as e:
        print(f'  (Flood-Net lookup failed: {e})', file=sys.stderr)
    return None

def import_report(defs, path):
    doc = docx.Document(path)
    heading = next((p.text.strip() for p in doc.paragraphs if p.style is not None and p.style.name.lower().startswith('heading') and re.search(r'\d{5,6}', p.text)), '')
    m = re.match(r'(.*?)\s*[-–]\s*(\d{5,6})\s*$', heading) or re.match(r'(\d{5,6})\s*[-–]\s*(.*)$', heading)
    if not m: raise SystemExit(f'{path}: no "Name – number" heading found')
    name, number = (m.group(1).strip(), m.group(2)) if not m.group(1).isdigit() else (m.group(2).strip(), m.group(1))
    forum_cell = None
    for t in doc.tables:
        rows = table_rows(t)
        if rows and rows[0] and norm(' '.join(cell_paras(rows[0][0]))).startswith('sort forum agreed remediation') and len(rows) > 1:
            forum_cell = rows[1][0]
    if forum_cell is None: raise SystemExit(f'{path}: no "SORT Forum Agreed remediation" table found')
    sittings = parse_forum_cell(defs, forum_cell)
    # A pasted scope table carries its own forum date. When that is not the date
    # of the sitting it sits under (an out-of-session scope added later, with no
    # "SORT Forum Date" line of its own), it is a sitting of its own.
    split = []
    for s in sittings:
        heads = [parse_scope_table(defs, rows)[1] for title, rows in s['tables'] if title.startswith('sort forum agreed remediation')]
        hd = iso_date(heads[0].get('date', '')) if heads else ''
        if s['tables'] and s['date'] and hd and hd != s['date']:
            split.append(dict(s, tables=[]))
            split.append({'date': hd, 'attendees': initials(heads[0].get('attendees', '')), 'notes': [], 'tables': s['tables']})
        else: split.append(s)
    sittings = split
    fn = floodnet(number) or {}
    sessions = []
    for i, s in enumerate(sittings):
        tpl, head, answers, ps, ps_comments = None, {}, {}, {}, []
        for title, rows in s['tables']:
            if title.startswith('sort forum agreed remediation'): tpl, head, answers = parse_scope_table(defs, rows)
            elif title.startswith('property services'): ps, ps_comments = parse_ps_table(rows)
        date = s['date'] or iso_date(head.get('date', ''))
        att = s['attendees'] or initials(head.get('attendees', ''))
        oos = bool(re.search(r'out of session', head.get('attendees', ''), re.I))
        text = ' '.join(s['notes'])
        outcome = next((code for rx, code in OUTCOME_RULES if rx.search(text)), None)
        if answers and not outcome: outcome = 'complete' if i == len(sittings) - 1 else None
        sessions.append({
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'sort-playbook:{number}:{i}:{date}')),
            'source': f"report:{re.sub(r'^[0-9a-f]{8}-', '', os.path.basename(path))}", 'savedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'savedBy': 'import', 'forum': {'date': date, 'attendees': att, 'outOfSession': oos},
            'outcome': outcome, 'outcomeNote': '\n'.join(s['notes']), 'template': tpl or ('waterlevel' if 'river' in (fn.get('kinds') or []) else 'rainfall'),
            'definitionsVersion': defs['version'],
            'summary': {'answers': answers, 'ps': ps, 'psComments': {}, 'psGeneral': '\n'.join(ps_comments), 'followUps': [],
                        'map': {'checked': None, 'features': [], 'marks': [], 'bridges': []}},
        })
    key = number.lstrip('0') if fn.get('station_number') is None else str(fn['station_number'])
    station = {'number': str(fn.get('station_number') or number), 'name': fn.get('name') or name, 'reportName': name, 'floodnetId': fn.get('id', ''),
               'lat': fn.get('lat'), 'lon': fn.get('lon'), 'kinds': fn.get('kinds') or [], 'lga': fn.get('lga') or '', 'hub': (fn.get('hub_id') or '').title() + (' Hub' if fn.get('hub_id') else ''),
               'owner': ((fn.get('sls') or {}).get('owner')) or ''}
    sessions.sort(key=lambda x: x['forum']['date'] or '0000')
    return {'schema': 'sort-playbook-station/1', 'key': key, 'station': station, 'sessions': sessions, 'tags': [], 'notes': ''}

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--defs', required=True, help='SoRT v2 definitions.json')
    ap.add_argument('--out', default='stations', help='folder for the station files')
    ap.add_argument('reports', nargs='+')
    a = ap.parse_args()
    defs = load_defs(a.defs)
    os.makedirs(a.out, exist_ok=True)
    for r in a.reports:
        f = import_report(defs, r)
        dest = os.path.join(a.out, f"{f['key']}.json")
        if os.path.exists(dest):   # merge: keep sessions saved from the app, replace earlier imports of the same report
            old = json.load(open(dest, encoding='utf-8'))
            keep = [s for s in old.get('sessions', []) if s.get('source') != f['sessions'][0]['source']]
            f['sessions'] = sorted(keep + f['sessions'], key=lambda x: x['forum']['date'] or '0000')
            f['tags'] = old.get('tags', []); f['notes'] = old.get('notes', '')
        json.dump(f, open(dest, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
        last = f['sessions'][-1]
        print(f"{dest}: {f['station']['name']} — {len(f['sessions'])} sitting(s); last {last['forum']['date']} {last['outcome']}, {len(last['summary']['answers'])} answers")
