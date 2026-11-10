/* SoRT v2 — schema.js
   The definitions file (v2/definitions.json): checking it, and turning a
   template into the list of questions it asks.

   Shape (see v2/README.md for the long version):
     schema:"sort-definitions/2", version, meta, links, sections[], session,
     questions: { <code>: QUESTION },          // the question bank, each once
     templates: [ { id, label, title, suggest?, waterLevel?,
                    questions: [ <code> | { q:<code>, ...overrides } ] } ],
     propertyServices: { title, note ("**…**" marks bold), rows[] },
     followUps: [ { id, owner, table, when, text, link?, doneWhen?, team?, floodnet? } ]
   QUESTION = { label, section, type:"single"|"multi"|"none", hint?, icon?,
     options?: [ {code,label,tags?,other?,offText?} | {group, options:[...]} ],
     fields?: [ {code,label,type,unit?,placeholder?,default?,emptyText?,showIf?,
                 options? (type "choice": [{code,label,ticks?,custom?}])} ],
     notes?: [ {text, when?, level?} ], showIf?, defaultWhen?: [{when,value}],
     derive?, prefill?, pin?, mapDraw?, hintFrom?, word?:false,
     presets?: <a choice field's code>  — a multi question whose tick boxes
               follow that field: each choice's `ticks`, and `custom` for the rest,
     guide?: <a key of guides>, suggest?: "coast" (js/coast.js) }
   guides: { <key>: { title, summary, shores[], bands[], otherwise, … } } — the
   pop-up behind a card's brief summary; a "coast" one also holds the distances.
   Codes are permanent: answers are stored under them. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};

  const QTYPES = ['single', 'multi', 'none'];
  const FTYPES = ['text', 'textarea', 'number', 'coord', 'licence', 'date', 'choice'];
  const SUGGESTS = ['coast', 'soil'];   // js/coast.js, js/soil.js
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

  // A preset question (q.presets): its choice field, and the choice its ticks match.
  // What a question has drawn on the map: one thing (mapDraw: {…}) or several
  // (mapDraw: [{…}, {…}] — the current and the new orifice run), always as a list.
  function mapDraws(q) { return q && q.mapDraw ? [].concat(q.mapDraw) : []; }
  function presetField(q) { return q && q.presets ? (q.fields || []).find(f => f.code === q.presets && f.type === 'choice') || null : null; }
  function presetFor(q, ticks) {
    const f = presetField(q); if (!f) return null;
    const set = [...new Set([].concat(ticks || []))].sort().join();
    const hit = (f.options || []).find(o => Array.isArray(o.ticks) && [...o.ticks].sort().join() === set);
    const custom = (f.options || []).find(o => o.custom);
    return hit ? hit.code : custom ? custom.code : null;
  }

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
        if (f.type === 'choice') {
          if (!flatOptions(f.options).length) E(`${where}: choice field "${f.code}" needs options`);
          checkOptions(`${where} field ${f.code}`, f.options);
        }
        checkCond(`${where} field ${f.code}`, f.showIf);
      });
      return seen;
    };
    const guides = defs.guides || {};
    if (defs.guides != null && (typeof defs.guides !== 'object' || Array.isArray(defs.guides))) E('guides must be an object');
    // A preset question's tick boxes follow its choice field; a coast suggestion needs a guide with distances.
    const checkPresets = (where, q) => {
      if (q.presets == null) return;
      const f = presetField(q);
      if (!f) { E(`${where}: presets "${q.presets}" is not one of its choice fields`); return; }
      if (q.type !== 'multi') E(`${where}: presets needs a multi (tick box) question`);
      const codes = new Set(flatOptions(q.options).map(o => o.code));
      (f.options || []).forEach(o => {
        if (o.custom) { if (o.ticks) E(`${where}: the custom choice "${o.code}" can't have ticks`); return; }
        if (!Array.isArray(o.ticks)) E(`${where}: choice "${o.code}" needs "ticks" (a list of its options, or [] for none) or "custom": true`);
        else o.ticks.forEach(t => { if (!codes.has(t)) E(`${where}: choice "${o.code}" ticks unknown option "${t}"`); });
      });
      if (!(f.options || []).some(o => o.custom)) E(`${where}: presets needs a choice with "custom": true`);
      const sets = (f.options || []).filter(o => Array.isArray(o.ticks)).map(o => [...o.ticks].sort().join());
      if (new Set(sets).size !== sets.length) E(`${where}: two choices tick the same boxes`);
    };
    const checkGuide = (where, q) => {
      if (q.guide != null && !guides[q.guide]) E(`${where}: guide "${q.guide}" is not in guides`);
      if (q.suggest == null) return;
      if (!SUGGESTS.includes(q.suggest)) { E(`${where}: unknown suggest "${q.suggest}"`); return; }
      const g = guides[q.guide], f = presetField(q);
      if (!g || !f) { E(`${where}: suggest "${q.suggest}" needs a guide and presets`); return; }
      const cats = new Set((f.options || []).map(o => o.code)), shores = new Set((g.shores || []).map(s => s.code));
      if (q.suggest === 'soil') {
        // What each reading of the soil maps suggests, as one of the choices.
        const want = ['likely', 'possible', 'unlikely'];
        want.forEach(k => { if (!cats.has((g.suggests || {})[k])) E(`${where}: guide "${q.guide}" suggests.${k} must be one of the ${f.code} choices`); });
        if (!(q.fields || []).some(x => x.code === 'mapped' && x.type === 'text')) E(`${where}: suggest "soil" needs a text field "mapped" for what the maps say`);
        return;
      }
      if (!shores.size) E(`${where}: guide "${q.guide}" has no shores`);
      if (!Array.isArray(g.bands) || !g.bands.length) E(`${where}: guide "${q.guide}" has no bands`);
      (g.bands || []).forEach(b => {
        if (!cats.has(b.category)) E(`${where}: guide band "${b.category}" is not one of the ${f.code} choices`);
        Object.entries(b.within || {}).forEach(([s, m]) => {
          if (!shores.has(s)) E(`${where}: guide band "${b.category}" names unknown shore "${s}"`);
          if (!(typeof m === 'number' && m > 0)) E(`${where}: guide band "${b.category}" needs a distance in metres for "${s}"`);
        });
      });
      if (!g.otherwise || !cats.has(g.otherwise.category)) E(`${where}: guide "${q.guide}" needs "otherwise" with one of the ${f.code} choices`);
      // The standard's own table, shown beside the guide's distances.
      const st = g.standard;
      if (st) {
        const nb = (st.bands || []).length, groups = st.groups || {};
        if (!nb) E(`${where}: guide standard has no bands`);
        (st.bands || []).forEach(b => { if (!(typeof b.from === 'number' && typeof b.to === 'number' && b.to > b.from)) E(`${where}: guide standard band "${b.label}" needs from < to, in metres`); });
        Object.entries(groups).forEach(([gr, c]) => { if (!cats.has(c)) E(`${where}: guide standard groups ${gr} into unknown choice "${c}"`); });
        (st.rows || []).forEach(r => {
          if (!shores.has(r.shore)) E(`${where}: guide standard row names unknown shore "${r.shore}"`);
          if (!Array.isArray(r.grades) || r.grades.length !== nb) E(`${where}: guide standard row "${r.shore}" needs ${nb} grades`);
          (r.grades || []).forEach(x => String(x).split('/').forEach(t => { const k = t.replace(/[^A-Za-z0-9]/g, ''); if (!groups[k]) E(`${where}: guide standard grade "${x}" is not in its groups`); }));
        });
      }
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
      mapDraws(q).forEach(d => {
        if (!['circle', 'line'].includes(d.kind)) E(`${where}: mapDraw kind "${d.kind}" is not circle or line`);
        if (d.field && !fields.has(d.field)) E(`${where}: mapDraw.field "${d.field}" is not one of its fields`);
      });
      if (q.prefill && q.prefill.field && !fields.has(q.prefill.field)) E(`${where}: prefill.field "${q.prefill.field}" is not one of its fields`);
      checkPresets(where, q); checkGuide(where, q);
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
      if (f.team && !(f.team.hub === true || (typeof f.team.name === 'string' && f.team.name.trim()))) E(`${where}: team must be {"hub": true} or {"name": "<team>"}`);
      if (f.floodnet != null && typeof f.floodnet !== 'boolean') E(`${where}: floodnet must be true or false`);
      if (f.floodnet === false && f.team) W(`${where}: a desktop task (floodnet: false) is never sent, so its team is unused`);
      if (f.wordNote != null && (typeof f.wordNote !== 'string' || f.floodnet !== false)) E(`${where}: wordNote is the words for a follow-up that stays in Word (floodnet: false)`);
    });
    return { errors, warnings };
  }

  S.schema = { flatOptions, option, optionLabel, templateQuestions, template, check, condRefs, presetField, presetFor, mapDraws };
})(typeof window !== 'undefined' ? window : globalThis);
