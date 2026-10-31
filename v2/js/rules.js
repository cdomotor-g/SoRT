/* SoRT v2 — rules.js
   What an answer *is* once everything that can fill it has had its say, which
   questions show, and which follow-ups the answers raise.

   A session keeps two kinds of answer apart (see store.js for the whole shape):
     answers[code] = { value, other, fields:{}, note }   what a person chose/typed
     prefill[code] = { value, fields:{}, src, from }     what Flood-Net, the map or
                                                         a precedent suggested
   and the effective answer is worked out here, part by part:
     value:  the person's → a rule's (derive / defaultWhen: "auto") → a prefill → none
     fields: the person's (even "", a deliberate clear) → a prefill → the default
   so a suggestion never overwrites anything somebody typed, and a rule that
   stops applying (comms changed back to ERRTS) simply stops answering.

   Conditions (showIf, notes[].when, defaultWhen[].when, followUps[].when):
     {q, is}  {q, isNot}  {q, in:[…]}  {q, has}  {q, tag}  {q, filled, field?}
     {ps, is} {template: id|[ids]} {station: key, has|is}
     {all:[…]} {any:[…]} {not: cond}                                         */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const sch = () => S.schema;
  const U = () => S.util;

  const emptyVal = v => v == null || v === '' || (Array.isArray(v) && !v.length);

  /* A context bundles what every rule needs, and caches effective answers for
     one pass (rebuild it after any change). */
  function context(defs, session) {
    const qs = sch().templateQuestions(defs, session.template);
    const byCode = {};
    qs.forEach(q => { byCode[q.code] = q; });
    const tpl = sch().template(defs, session.template);
    return { defs, session, qs, byCode, tpl, waterLevel: !!(tpl && tpl.waterLevel), _eff: {}, _busy: {} };
  }

  function questionDef(ctx, code) { return ctx.byCode[code] || (ctx.defs.questions || {})[code] || null; }

  // ---- effective answers ---------------------------------------------------
  function eff(ctx, code) {
    if (ctx._eff[code]) return ctx._eff[code];
    const q = questionDef(ctx, code);
    const a = ctx.session.answers[code] || {};
    const p = ctx.session.prefill[code] || {};
    const out = { code, value: null, src: null, other: a.other || '', fields: {}, fieldSrc: {}, note: a.note || '' };
    if (!q) return out;
    if (ctx._busy[code]) return out;                // a rule that loops reads "no answer"
    ctx._busy[code] = true;
    if (q.type !== 'none') {
      if (!emptyVal(a.value)) { out.value = a.value; out.src = 'user'; }
      else {
        const auto = autoValue(ctx, q);
        if (!emptyVal(auto)) { out.value = auto; out.src = 'auto'; }
        else if (!emptyVal(p.value)) { out.value = p.value; out.src = p.src || 'prefill'; }
      }
      if (q.type === 'multi' && out.value != null && !Array.isArray(out.value)) out.value = [out.value];
      if (q.type === 'single' && Array.isArray(out.value)) out.value = out.value[0] || null;
    }
    (q.fields || []).forEach(f => {
      const af = a.fields || {}, pf = p.fields || {};
      if (af[f.code] !== undefined) { out.fields[f.code] = af[f.code]; out.fieldSrc[f.code] = 'user'; }
      else if (pf[f.code] != null && pf[f.code] !== '') { out.fields[f.code] = pf[f.code]; out.fieldSrc[f.code] = p.src || 'prefill'; }
      else if (f.default != null) { out.fields[f.code] = f.type === 'textarea' ? f.default : String(f.default).replace(/\s*\n+\s*/g, ' '); out.fieldSrc[f.code] = 'default'; }
      else { out.fields[f.code] = ''; out.fieldSrc[f.code] = null; }
    });
    delete ctx._busy[code];
    ctx._eff[code] = out;
    return out;
  }

  // What a rule says the answer is when nobody has chosen one.
  function autoValue(ctx, q) {
    if (q.derive && q.derive.kind === 'commsChange') {
      const fam = code => {
        const e = eff(ctx, code), dq = questionDef(ctx, code);
        if (!dq || emptyVal(e.value)) return null;
        const o = sch().option(dq, Array.isArray(e.value) ? e.value[0] : e.value);
        return o && (o.tags || []).find(t => q.derive.families.includes(t)) || null;
      };
      const from = fam(q.derive.from), to = fam(q.derive.to);
      if (!from || !to) return null;
      const code = from === to ? 'none' : `${from}_to_${to}`;
      return sch().option(q, code) ? code : null;
    }
    for (const d of q.defaultWhen || []) if (test(ctx, d.when)) return d.value;
    return null;
  }

  // ---- conditions -----------------------------------------------------------
  function test(ctx, c) {
    if (c == null) return true;
    if (Array.isArray(c.all)) return c.all.every(x => test(ctx, x));
    if (Array.isArray(c.any)) return c.any.some(x => test(ctx, x));
    if (c.not) return !test(ctx, c.not);
    if (c.template != null) return [].concat(c.template).includes(ctx.session.template);
    if (c.station) {
      const v = (ctx.session.station || {})[c.station];
      if (c.has != null) return Array.isArray(v) ? v.includes(c.has) : v === c.has;
      if (c.is != null) return v === c.is;
      return !emptyVal(v);
    }
    if (c.ps) {
      const v = psQuestionValue(ctx, c.ps);
      if (c.is != null) return v === c.is;
      if (c.isNot != null) return !!v && v !== c.isNot;
      if (Array.isArray(c.in)) return c.in.includes(v);
      return !!v;
    }
    if (c.q) {
      const q = questionDef(ctx, c.q);
      if (!q) return false;
      // A question this template doesn't ask can't satisfy anything.
      if (!ctx.byCode[c.q]) return false;
      const e = eff(ctx, c.q);
      const vals = e.value == null ? [] : [].concat(e.value);
      if (c.filled != null) {
        const fieldFilled = k => e.fieldSrc[k] !== 'default' && String(e.fields[k] == null ? '' : e.fields[k]).trim() !== '';
        const filled = c.field ? fieldFilled(c.field) : (vals.length > 0 || Object.keys(e.fields).some(fieldFilled));
        return c.filled ? filled : !filled;
      }
      if (c.is != null) return vals.includes(c.is);
      if (c.isNot != null) return vals.length > 0 && !vals.includes(c.isNot);
      if (Array.isArray(c.in)) return vals.some(v => c.in.includes(v));
      if (c.has != null) return vals.includes(c.has);
      if (c.tag != null) return vals.some(v => { const o = sch().option(q, v); return !!(o && (o.tags || []).includes(c.tag)); });
      return vals.length > 0;
    }
    return true;
  }

  const visible = (ctx, q) => test(ctx, q.showIf);
  const fieldVisible = (ctx, f) => test(ctx, f.showIf);
  function visibleQuestions(ctx) { return ctx.qs.filter(q => visible(ctx, q)); }

  // Does a question hold anything? (`mine` = only what a person entered.)
  function hasContent(ctx, q, mine) {
    const e = eff(ctx, q.code);
    if (e.note.trim()) return true;
    if (!emptyVal(e.value) && (!mine || e.src === 'user')) return true;
    return (q.fields || []).some(f => {
      if (!fieldVisible(ctx, f)) return false;
      const v = String(e.fields[f.code] || '').trim();
      const src = e.fieldSrc[f.code];
      if (!v || src === 'default') return false;
      return mine ? src === 'user' : true;
    });
  }
  // Something filled in for the person that they haven't accepted yet.
  function awaitingConfirm(ctx, q) {
    const e = eff(ctx, q.code);
    if (e.src && e.src !== 'user' && e.src !== 'auto' && !emptyVal(e.value)) return true;
    return (q.fields || []).some(f => fieldVisible(ctx, f) && ['floodnet', 'precedent', 'map'].includes(e.fieldSrc[f.code]) && String(e.fields[f.code] || '').trim());
  }
  function progress(ctx) {
    const vis = visibleQuestions(ctx);
    let filled = 0, toConfirm = 0;
    vis.forEach(q => { if (hasContent(ctx, q)) filled++; if (awaitingConfirm(ctx, q)) toConfirm++; });
    return { total: vis.length, filled, toConfirm };
  }

  // ---- text for Word and the preview ---------------------------------------
  function fill(ctx, text) {
    const st = ctx.session.station || {};
    return String(text || '').replace(/\{([^{}]+)\}/g, (m, key) => {
      const [k, fallback] = key.split('|');
      if (k === 'hub') return st.hubName || fallback || 'Hub';
      if (k === 'lga') return st.lga || fallback || 'the council';
      if (k === 'owner') return st.owner || fallback || 'the owner';
      if (k === 'station') return st.name || fallback || 'the station';
      if (k.startsWith('f:')) {
        const [qc, fc] = k.slice(2).split('.');
        const v = String(eff(ctx, qc).fields[fc] || '').trim();
        return v || fallback || '';
      }
      if (k.startsWith('q:')) {
        const q = questionDef(ctx, k.slice(2)); const e = eff(ctx, k.slice(2));
        return e.value == null ? (fallback || '') : [].concat(e.value).map(v => sch().optionLabel(q, v)).join(', ');
      }
      return m;
    });
  }
  function fieldText(f, v) {
    let s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (f.type === 'coord') { const p = U().parseCoord(s); if (p.ok) s = U().formatCoord(p.lat, p.lon); }
    if (f.unit && /^-?\d+(\.\d+)?$/.test(s)) s += ` ${f.unit}`;
    return s;
  }
  // The answer cell's lines, as copied into Word.
  function outputLines(ctx, q) {
    const e = eff(ctx, q.code), lines = [];
    if (e.value != null) [].concat(e.value).forEach(v => {
      const o = sch().option(q, v);
      if (!o) { lines.push(String(v)); return; }
      lines.push(o.other && e.other.trim() ? `${o.label.replace(/[:\s]+$/, '')}: ${e.other.trim()}` : o.label);
    });
    (q.fields || []).forEach(f => {
      if (!fieldVisible(ctx, f)) return;
      const t = fieldText(f, e.fields[f.code]);
      if (t) lines.push(`${f.label}: ${t}`);
      else if (f.emptyText) lines.push(`${f.label}: ${fill(ctx, f.emptyText)}`);
    });
    if (e.note.trim()) lines.push(e.note.trim());
    return lines;
  }
  function notesFor(ctx, q) { return (q.notes || []).filter(n => test(ctx, n.when)); }

  // ---- follow-ups ------------------------------------------------------------
  function followUps(ctx) {
    const st = ctx.session.followUpState || {};
    return (ctx.defs.followUps || []).filter(r => test(ctx, r.when)).map(r => {
      const s = st[r.id] || {};
      const auto = r.doneWhen ? test(ctx, r.doneWhen) : false;
      const link = r.link && ctx.defs.links && ctx.defs.links[r.link];
      return { id: r.id, owner: r.owner || '', table: r.table || 'scope', text: fill(ctx, r.text),
        link: link ? { label: link.label, url: link.url } : null,
        done: auto || s.status === 'done', doneAuto: auto, note: s.note || '' };
    });
  }

  // ---- Property Services -------------------------------------------------------
  function psState(session) {
    if (!session.ps) session.ps = {};
    const p = session.ps;
    p.answers = p.answers || {}; p.dirty = p.dirty || {}; p.comments = p.comments || {};
    if (typeof p.general !== 'string') p.general = '';
    return p;
  }
  // Text pulled from a scope answer: field:null = the chosen option's label.
  function psSourceText(ctx, src) {
    if (!src || !ctx.byCode[src.q]) return '';
    const q = questionDef(ctx, src.q);
    if (!visible(ctx, q)) return '';
    const e = eff(ctx, src.q);
    if (src.field == null) return e.value == null ? '' : [].concat(e.value).map(v => sch().optionLabel(q, v)).join(', ');
    const f = (q.fields || []).find(x => x.code === src.field);
    if (f && !fieldVisible(ctx, f)) return '';
    return fieldText(f || {}, e.fields[src.field]);
  }
  function psText(ctx, key, src, dflt) {
    const p = psState(ctx.session);
    if (p.dirty[key]) return p.answers[key] != null ? p.answers[key] : '';
    const d = psSourceText(ctx, src);
    if (d) return d;
    return dflt != null ? dflt : '';
  }
  function psRow(ctx, id) { return ((ctx.defs.propertyServices || {}).rows || []).find(r => r.id === id) || null; }
  function psNA(ctx, row) { return !!(row && row.waterLevelOnly && !ctx.waterLevel); }
  function psQuestionValue(ctx, id) {
    const row = psRow(ctx, id);
    if (!row) return '';
    if (psNA(ctx, row)) return 'na';
    const p = psState(ctx.session);
    if (p.dirty[id]) return p.answers[id] || '';
    if (row.source && ctx.byCode[row.source.q]) {
      const q = questionDef(ctx, row.source.q), e = eff(ctx, row.source.q);
      const v = Array.isArray(e.value) ? e.value[0] : e.value;
      if (v == null) return '';
      const opts = row.options || [];
      const byCode = opts.find(o => o.code === v);
      if (byCode) return byCode.code;
      const lab = sch().optionLabel(q, v).toLowerCase();
      const byLabel = opts.find(o => o.label.toLowerCase() === lab);
      return byLabel ? byLabel.code : '';
    }
    return '';
  }
  function psQuestionLabel(ctx, row) {
    if (psNA(ctx, row)) return 'NA';
    const v = psQuestionValue(ctx, row.id);
    const o = (row.options || []).find(x => x.code === v);
    return o ? o.label : '';
  }
  function psDetail(ctx, row) {
    if (!row.detail) return '';
    const key = `${row.id}.detail`, p = psState(ctx.session);
    if (p.dirty[key]) return p.answers[key] || '';
    const pre = ((ctx.session.prefill || {}).__ps || {})[key];
    return pre && psQuestionValue(ctx, row.id) === 'yes' ? pre : '';
  }

  S.rules = { context, eff, test, visible, fieldVisible, visibleQuestions, hasContent, awaitingConfirm, progress,
    fill, fieldText, outputLines, notesFor, followUps, emptyVal,
    psState, psText, psSourceText, psQuestionValue, psQuestionLabel, psDetail, psNA, psRow };
})(typeof window !== 'undefined' ? window : globalThis);
