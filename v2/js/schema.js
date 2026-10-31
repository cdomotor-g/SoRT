/* SoRT v2 — schema.js
   The definitions file (v2/definitions.json): checking it, and turning a
   template into the list of questions it asks.

   Shape (see v2/README.md for the long version):
     schema:"sort-definitions/2", version, meta, links, sections[], session,
     questions: { <code>: QUESTION },          // the question bank, each once
     templates: [ { id, label, title, suggest?, waterLevel?,
                    questions: [ <code> | { q:<code>, ...overrides } ] } ],
     propertyServices: { title, note, rows[] },
     followUps: [ { id, owner, table, when, text, link?, doneWhen? } ]
   QUESTION = { label, section, type:"single"|"multi"|"none", hint?, icon?,
     options?: [ {code,label,tags?,other?} | {group, options:[...]} ],
     fields?: [ {code,label,type,unit?,placeholder?,default?,emptyText?,showIf?} ],
     notes?: [ {text, when?, level?} ], showIf?, defaultWhen?: [{when,value}],
     derive?, prefill?, pin?, mapDraw?, hintFrom?, word?:false }
   Codes are permanent: answers are stored under them. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};

  const QTYPES = ['single', 'multi', 'none'];
  const FTYPES = ['text', 'textarea', 'number', 'coord', 'licence', 'date'];
  const PSKINDS = ['coordGroup', 'question', 'text', 'sectionHeader', 'date'];
  const CODE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
  const OPT_RE = /^[a-z0-9][a-z0-9_]*$/;

  // Options with their groups flattened away.
  function flatOptions(list) {
    const out = [];
    (list || []).forEach(o => { if (o && Array.isArray(o.options)) out.push(...o.options); else if (o) out.push(o); });
    return out;
  }
  function option(q, code) { return flatOptions(q && q.options).find(o => o.code === code) || null; }
  function optionLabel(q, code) { const o = option(q, code); return o ? o.label : (code == null ? '' : String(code)); }

  // A template's question list, overrides applied. Override keys replace the
  // bank's (a template's own option list, wording or fields).
  function templateQuestions(defs, templateId) {
    const t = (defs.templates || []).find(x => x.id === templateId);
    if (!t) return [];
    return t.questions.map(e => {
      const code = typeof e === 'string' ? e : e.q;
      const base = defs.questions[code];
      if (!base) return null;
      const q = Object.assign({}, base, typeof e === 'object' ? e : {}, { code });
      delete q.q;
      return q;
    }).filter(Boolean);
  }
  function template(defs, id) { return (defs.templates || []).find(t => t.id === id) || null; }

  // Every question code a condition mentions (for the check), and every ps id.
  function condRefs(c, acc) {
    acc = acc || { q: [], ps: [] };
    if (!c || typeof c !== 'object') return acc;
    if (Array.isArray(c.all)) c.all.forEach(x => condRefs(x, acc));
    if (Array.isArray(c.any)) c.any.forEach(x => condRefs(x, acc));
    if (c.not) condRefs(c.not, acc);
    if (c.q) acc.q.push(c.q);
    if (c.ps) acc.ps.push(c.ps);
    return acc;
  }

  /* check(defs) → { errors:[], warnings:[] }. The app refuses definitions with
     errors (and keeps the last good copy); the Node check fails on them. */
  function check(defs) {
    const errors = [], warnings = [];
    const E = m => errors.push(m), W = m => warnings.push(m);
    if (!defs || typeof defs !== 'object') { E('not a JSON object'); return { errors, warnings }; }
    if (defs.schema !== 'sort-definitions/2') E(`schema must be "sort-definitions/2" (got ${JSON.stringify(defs.schema)})`);
    if (!Number.isInteger(defs.version) || defs.version < 1) E('version must be a whole number ≥ 1');
    const sections = new Set((defs.sections || []).map(s => s.id));
    if (!sections.size) E('sections is empty');
    const Q = defs.questions || {};
    if (!Object.keys(Q).length) E('questions is empty');
    const links = defs.links || {};

    const checkCond = (where, c) => {
      if (c == null) return;
      const r = condRefs(c);
      r.q.forEach(code => { if (!Q[code]) E(`${where}: condition names unknown question "${code}"`); });
      const psIds = new Set(((defs.propertyServices || {}).rows || []).map(x => x.id));
      r.ps.forEach(id => { if (!psIds.has(id)) E(`${where}: condition names unknown Property Services row "${id}"`); });
    };
    const checkOptions = (where, list) => {
      const seen = new Set();
      (list || []).forEach(o => {
        if (o && Array.isArray(o.options)) {
          if (!o.group) E(`${where}: an option group has no "group" name`);
          o.options.forEach(x => chk1(x));
        } else chk1(o);
      });
      function chk1(o) {
        if (!o || typeof o !== 'object') { E(`${where}: an option is not an object`); return; }
        if (!OPT_RE.test(o.code || '')) E(`${where}: option code "${o.code}" must be lower-case letters, digits and _`);
        if (!o.label) E(`${where}: option "${o.code}" has no label`);
        if (seen.has(o.code)) E(`${where}: option code "${o.code}" is used twice`);
        seen.add(o.code);
      }
    };
    const checkFields = (where, fields) => {
      const seen = new Set();
      (fields || []).forEach(f => {
        if (!CODE_RE.test(f.code || '')) E(`${where}: field code "${f.code}" is not a valid code`);
        if (seen.has(f.code)) E(`${where}: field code "${f.code}" is used twice`);
        seen.add(f.code);
        if (!FTYPES.includes(f.type)) E(`${where}: field "${f.code}" has unknown type "${f.type}"`);
        if (f.type === 'text' && /\n/.test(f.default || '')) W(`${where}: field "${f.code}" has a multi-line default but is a one-line text field`);
        checkCond(`${where} field ${f.code}`, f.showIf);
      });
      return seen;
    };
    const checkQuestion = (where, q) => {
      if (!q.label) E(`${where}: no label`);
      if (!QTYPES.includes(q.type)) E(`${where}: unknown type "${q.type}"`);
      if (q.section && !sections.has(q.section)) E(`${where}: unknown section "${q.section}"`);
      if (q.type !== 'none') {
        if (!flatOptions(q.options).length) E(`${where}: a ${q.type} question needs options`);
        checkOptions(where, q.options);
      }
      const fields = checkFields(where, q.fields);
      if (q.pin && !fields.has(q.pin.field)) E(`${where}: pin.field "${q.pin.field}" is not one of its fields`);
      if (q.mapDraw && q.mapDraw.field && !fields.has(q.mapDraw.field)) E(`${where}: mapDraw.field "${q.mapDraw.field}" is not one of its fields`);
      if (q.prefill && q.prefill.field && !fields.has(q.prefill.field)) E(`${where}: prefill.field "${q.prefill.field}" is not one of its fields`);
      checkCond(`${where} showIf`, q.showIf);
      (q.notes || []).forEach((n, i) => { if (!n.text) E(`${where}: note ${i + 1} has no text`); checkCond(`${where} note`, n.when); });
      (q.defaultWhen || []).forEach(d => {
        checkCond(`${where} defaultWhen`, d.when);
        if (q.type !== 'none' && !flatOptions(q.options).some(o => o.code === d.value)) E(`${where}: defaultWhen value "${d.value}" is not one of its options`);
      });
      if (q.derive) {
        if (q.derive.kind !== 'commsChange') E(`${where}: unknown derive kind "${q.derive.kind}"`);
        [q.derive.from, q.derive.to].forEach(c => { if (!Q[c]) E(`${where}: derive names unknown question "${c}"`); });
      }
    };

    Object.entries(Q).forEach(([code, q]) => {
      if (!CODE_RE.test(code)) E(`question code "${code}" is not a valid code`);
      if (!q.section) E(`question ${code}: no section`);
      checkQuestion(`question ${code}`, q);
    });

    const tids = new Set();
    (defs.templates || []).forEach((t, ti) => {
      const where = `template ${t.id || '#' + (ti + 1)}`;
      if (!CODE_RE.test(t.id || '')) E(`${where}: id must be a code`);
      if (tids.has(t.id)) E(`${where}: id used twice`);
      tids.add(t.id);
      if (!t.label) E(`${where}: no label`);
      if (!Array.isArray(t.questions) || !t.questions.length) E(`${where}: no questions`);
      const seen = new Set();
      (t.questions || []).forEach(e => {
        const code = typeof e === 'string' ? e : e && e.q;
        if (!Q[code]) { E(`${where}: unknown question "${code}"`); return; }
        if (seen.has(code)) E(`${where}: question "${code}" listed twice`);
        seen.add(code);
        if (typeof e === 'object') checkQuestion(`${where} → ${code}`, Object.assign({}, Q[code], e));
      });
    });
    if (!tids.size) E('templates is empty');

    const ps = defs.propertyServices;
    if (!ps || !Array.isArray(ps.rows)) E('propertyServices.rows is missing');
    else {
      const ids = new Set();
      ps.rows.forEach(r => {
        const where = `Property Services row ${r.id}`;
        if (!r.id) E('a Property Services row has no id');
        if (ids.has(r.id)) E(`${where}: id used twice`);
        ids.add(r.id);
        if (!PSKINDS.includes(r.kind)) E(`${where}: unknown kind "${r.kind}"`);
        const src = s => { if (!s) return; if (!Q[s.q]) E(`${where}: source names unknown question "${s.q}"`); };
        src(r.source); (r.coords || []).forEach(c => src(c.source));
        if (r.kind === 'question') checkOptions(where, r.options);
        checkCond(where, r.showIf);
      });
    }
    const fids = new Set();
    (defs.followUps || []).forEach(f => {
      const where = `follow-up ${f.id}`;
      if (!f.id) E('a follow-up has no id');
      if (fids.has(f.id)) E(`${where}: id used twice`);
      fids.add(f.id);
      if (!f.text) E(`${where}: no text`);
      if (!f.when) E(`${where}: no "when"`);
      checkCond(where, f.when); checkCond(`${where} doneWhen`, f.doneWhen);
      if (f.link && !links[f.link]) E(`${where}: link "${f.link}" is not in links`);
      if (f.table && !['scope', 'ps', 'none'].includes(f.table)) E(`${where}: table must be scope, ps or none`);
    });
    return { errors, warnings };
  }

  S.schema = { flatOptions, option, optionLabel, templateQuestions, template, check, condRefs };
})(typeof window !== 'undefined' ? window : globalThis);
