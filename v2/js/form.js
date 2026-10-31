/* SoRT v2 — form.js
   The questions, section by section, and the Property Services block. Renders
   from the effective answers (rules.js) and writes only what a person does into
   session.answers / session.ps; app.js re-runs the rules and re-renders after
   anything that can change what shows. Focus and caret survive a re-render, so
   typing is never interrupted. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules, sch = () => S.schema;
  const h = (...a) => U().h(...a);

  const SRC_LABEL = { floodnet: 'Flood-Net', precedent: 'Precedent', earlier: 'Earlier session', map: 'Map', prefill: 'Suggested', auto: 'Auto' };
  const SRC_TITLE = {
    floodnet: 'Filled in from Flood-Net. Check it, then press ✓ to keep it (or just change it).',
    precedent: 'Copied from a precedent station. Check it, then press ✓ to keep it (or just change it).',
    map: 'Taken from the map. Check it, then press ✓ to keep it (or just change it).',
    earlier: 'Carried over from this station’s earlier session. Check it, then press ✓ to keep it (or just change it).',
    auto: 'Filled in by a rule from your other answers (e.g. NA for an IP logger). Choose another answer to override it.'
  };
  const LICENCE_RE = /^\d{4,9}\/\d{1,3}$/;

  let app = null;                 // { defs, session, ctx, changed(opts), hint(key), focusMapOn(code, field) }
  function bind(a) { app = a; }

  function ans(code) {
    const s = app.session;
    if (!s.answers[code]) s.answers[code] = { value: null, fields: {} };
    const a = s.answers[code]; a.fields = a.fields || {};
    return a;
  }
  // Accept everything a prefill or rule suggested for this question as the person's own.
  function confirmQuestion(q) {
    const e = R().eff(app.ctx, q.code), a = ans(q.code);
    if (R().emptyVal(a.value) && !R().emptyVal(e.value)) a.value = U().clone(e.value);
    (q.fields || []).forEach(f => {
      if (a.fields[f.code] === undefined && R().PREFILL_SRCS.includes(e.fieldSrc[f.code])) a.fields[f.code] = e.fields[f.code];
    });
    if (a.other === undefined && e.other) a.other = e.other;
    if (a.note === undefined && e.note) a.note = e.note;
  }

  /* ---------------- focus keeping ---------------- */
  function rememberFocus() {
    const el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.fk) return null;
    return { key: el.dataset.fk, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
  }
  function restoreFocus(f) {
    if (!f) return;
    const el = document.querySelector(`[data-fk="${CSS.escape(f.key)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch (_) { /* not a text input */ }
    if (f.scroll) el.scrollTop = f.scroll;
  }

  /* ---------------- the scope questions ---------------- */
  function render(root) {
    const ctx = app.ctx, defs = app.defs;
    const focus = rememberFocus();
    root.innerHTML = '';
    const vis = new Set(R().visibleQuestions(ctx).map(q => q.code));
    (defs.sections || []).forEach(sec => {
      const qs = ctx.qs.filter(q => (q.section || 'notes') === sec.id && vis.has(q.code));
      if (!qs.length) return;
      const filled = qs.filter(q => R().hasContent(ctx, q)).length;
      const secEl = h('section', { class: 'sec card', id: `sec-${sec.id}` },
        h('header', { class: 'sec-head' },
          h('h2', null, sec.title),
          h('span', { class: 'sec-count' + (filled === qs.length ? ' done' : ''), title: 'Questions answered in this section' }, `${filled} / ${qs.length}`)),
        qs.map(q => questionCard(q)));
      root.appendChild(secEl);
    });
    restoreFocus(focus);
  }

  function badge(src, onConfirm, from) {
    if (!src || src === 'user' || src === 'default') return null;
    const b = h('span', { class: `src src-${src}`, title: (SRC_TITLE[src] || '') + (from ? ` (From ${from}.)` : '') }, SRC_LABEL[src] || src);
    if (onConfirm && src !== 'auto') {
      b.appendChild(h('button', { type: 'button', class: 'src-ok', title: 'Keep this answer', 'aria-label': 'Keep this answer', onclick: onConfirm }, '✓'));
    }
    return b;
  }

  function questionCard(q) {
    const ctx = app.ctx, e = R().eff(ctx, q.code);
    const filled = R().hasContent(ctx, q), waiting = R().awaitingConfirm(ctx, q);
    const card = h('div', { class: 'q' + (filled ? ' filled' : '') + (waiting ? ' waiting' : ''), dataset: { q: q.code }, id: `q-${q.code}` });
    const head = h('div', { class: 'q-head' },
      q.icon ? h('span', { class: 'q-icon', 'aria-hidden': 'true' }, q.icon) : null,
      h('div', { class: 'q-titles' },
        h('div', { class: 'q-label' }, q.label),
        q.hint ? h('div', { class: 'q-hint' }, q.hint) : null),
      h('div', { class: 'q-tools' },
        waiting ? badge(e.src && e.src !== 'user' ? e.src : Object.values(e.fieldSrc).find(s => R().PREFILL_SRCS.includes(s)), () => { confirmQuestion(q); app.changed(); }, (app.session.prefill[q.code] || {}).from) : null,
        e.src === 'auto' ? badge('auto') : null,
        h('button', { type: 'button', class: 'q-clear', title: 'Clear this answer', onclick: () => {
          delete app.session.answers[q.code]; delete app.session.prefill[q.code]; app.changed();
        } }, 'Clear')));
    const side = h('div', { class: 'q-side' }, head);
    R().notesFor(ctx, q).forEach(n => side.appendChild(h('div', { class: 'q-note' + (n.level === 'info' ? ' info' : '') }, n.text)));
    if (q.hintFrom) {
      const t = app.hint(q.hintFrom);
      if (t) side.appendChild(h('div', { class: 'q-note info' }, t));
    }
    card.appendChild(side);

    const body = h('div', { class: 'q-body' });
    if (q.type !== 'none') body.appendChild(optionsEl(q, e));
    // An "Other" option asks for its words.
    if (q.type !== 'none') {
      const chosen = [].concat(e.value || []).map(v => sch().option(q, v)).filter(o => o && o.other);
      if (chosen.length) {
        body.appendChild(h('label', { class: 'fld' },
          h('span', { class: 'fld-label' }, 'Specify'),
          h('input', { type: 'text', value: e.other || '', 'data-fk': `${q.code}::other`, placeholder: 'e.g. the value or detail',
            oninput: ev => { ans(q.code).other = ev.target.value; app.changed({ light: true }); },
            onchange: () => app.changed() })));
      }
    }
    (q.fields || []).forEach(f => { if (R().fieldVisible(ctx, f)) body.appendChild(fieldEl(q, f, e)); });
    body.appendChild(noteEl(q, e));
    card.appendChild(body);
    return card;
  }

  function optionsEl(q, e) {
    const opts = q.options || [];
    const flat = sch().flatOptions(opts);
    const long = flat.length > 5 || flat.some(o => o.label.length > 28) || opts.some(o => o.options);
    const wrap = h('div', { class: 'opts' + (long ? ' opts-list' : ' opts-pills'), role: q.type === 'single' ? 'radiogroup' : 'group', 'aria-label': q.label });
    const vals = [].concat(e.value == null ? [] : e.value);
    const name = `opt-${q.code}`;
    const one = o => {
      const checked = vals.includes(o.code);
      const input = h('input', { type: q.type === 'single' ? 'radio' : 'checkbox', name, value: o.code, checked, 'data-fk': `${q.code}::opt::${o.code}` });
      input.addEventListener('click', () => {
        const a = ans(q.code);
        if (a.other === undefined && e.other) a.other = e.other;
        if (q.type === 'single') {
          // Clicking the answer already chosen by a person clears it.
          if (checked && e.src === 'user') a.value = null; else a.value = o.code;
        } else {
          const cur = e.src === 'user' || e.src == null ? [].concat(a.value || []) : vals.slice();
          a.value = cur.includes(o.code) ? cur.filter(x => x !== o.code) : cur.concat(o.code);
        }
        app.changed();
      });
      return h('label', { class: 'opt' + (checked ? ' on' : '') + (checked && e.src && e.src !== 'user' ? ` from-${e.src}` : '') }, input, h('span', null, o.label));
    };
    opts.forEach(o => {
      if (o.options) wrap.appendChild(h('div', { class: 'opt-group' }, h('div', { class: 'opt-group-label' }, o.group), o.options.map(one)));
      else wrap.appendChild(one(o));
    });
    return wrap;
  }

  function fieldEl(q, f, e) {
    const val = e.fields[f.code] == null ? '' : String(e.fields[f.code]);
    const src = e.fieldSrc[f.code];
    const fk = `${q.code}::f::${f.code}`;
    const set = v => { ans(q.code).fields[f.code] = v; };
    const ph = f.emptyText ? R().fill(app.ctx, f.emptyText) : (f.placeholder || '');
    const common = { 'data-fk': fk, placeholder: ph, class: R().PREFILL_SRCS.includes(src) ? `prefilled pre-${src}` : null,
      'aria-label': `${q.label} — ${f.label}` };
    let input;
    if (f.type === 'textarea') {
      input = h('textarea', Object.assign({ rows: Math.min(14, Math.max(3, val.split('\n').length + 1)) }, common));
      input.value = val;
    } else if (f.type === 'date') {
      input = h('input', Object.assign({ type: 'date', value: val }, common));
    } else {
      input = h('input', Object.assign({ type: 'text', value: val, inputmode: f.type === 'number' ? 'decimal' : null, spellcheck: f.type === 'coord' || f.type === 'licence' ? 'false' : null }, common));
    }
    input.addEventListener('input', ev => { set(ev.target.value); app.changed({ light: true }); });
    input.addEventListener('change', () => app.changed());
    const row = h('div', { class: 'fld' + (f.type === 'textarea' ? ' fld-wide' : '') },
      h('label', { class: 'fld-label', for: null }, f.label, f.unit ? h('span', { class: 'fld-unit' }, ` (${f.unit})`) : null));
    const line = h('div', { class: 'fld-line' }, input);
    if (R().PREFILL_SRCS.includes(src)) line.appendChild(badge(src, () => { set(val); app.changed(); }, (app.session.prefill[q.code] || {}).from));
    if (q.pin && q.pin.field === f.code) {
      line.appendChild(h('button', { type: 'button', class: 'btn-mini', title: 'Show this point on the map', onclick: () => app.focusMapOn(q.code, f.code) }, '📍 Map'));
    }
    if (q.mapDraw && q.mapDraw.field === f.code) {
      line.appendChild(h('button', { type: 'button', class: 'btn-mini', title: `Draw the ${q.mapDraw.label.toLowerCase()} on the map`, onclick: () => app.drawOnMap(q.code) },
        q.mapDraw.kind === 'circle' ? '◯ Draw on map' : '〰 Draw on map'));
    }
    row.appendChild(line);
    // Coordinates: DMS converts on paste, and a bad one says why (v1's behaviour).
    if (f.type === 'coord') attachCoordHints(row, input, v => { set(v); app.changed(); });
    if (f.type === 'licence' && val.trim() && !LICENCE_RE.test(val.trim())) {
      row.appendChild(h('div', { class: 'hint warn' }, 'ACMA licence numbers look like 1441013/1 — check this one.'));
    }
    if (f.default != null && src === 'user' && val !== f.default) {
      row.appendChild(h('button', { type: 'button', class: 'link', onclick: () => { delete ans(q.code).fields[f.code]; app.changed(); } }, '↺ Restore default text'));
    }
    return row;
  }

  function attachCoordHints(row, input, commit) {
    const hint = h('div', { class: 'hint', hidden: true });
    row.appendChild(hint);
    const show = (cls, html) => { hint.hidden = false; hint.className = 'hint ' + cls; hint.innerHTML = html; };
    function validate() {
      const r = U().parseCoord(input.value);
      if (r.empty) { hint.hidden = true; return; }
      if (!r.ok || r.warn) {
        let html = U().esc(r.error || r.warn);
        if (r.swap) html += ` <button type="button" class="link coord-swap">Swap to ${U().esc(U().formatCoord(r.swap.lat, r.swap.lon))}</button>`;
        show(r.ok ? 'warn' : 'error', html);
        const b = hint.querySelector('.coord-swap');
        if (b) b.addEventListener('click', () => commit(U().formatCoord(r.swap.lat, r.swap.lon)));
        return;
      }
      hint.hidden = true;
    }
    input.addEventListener('blur', validate);
    input.addEventListener('paste', ev => {
      const text = (ev.clipboardData || G.clipboardData).getData('text');
      const r = U().parseCoord(text);
      if (!(r.ok && r.format === 'dms')) return;
      ev.preventDefault();
      commit(U().formatCoord(r.lat, r.lon));
    });
    if (input.value.trim()) validate();
  }

  function noteEl(q, e) {
    const has = !!e.note.trim();
    const wrap = h('div', { class: 'q-extra' });
    if (!has) {
      wrap.appendChild(h('button', { type: 'button', class: 'link', onclick: () => {
        wrap.innerHTML = ''; wrap.appendChild(noteBox(q, ''));
        const t = wrap.querySelector('textarea'); if (t) t.focus();
      } }, '+ Add note'));
    } else wrap.appendChild(noteBox(q, e.note));
    return wrap;
  }
  function noteBox(q, v) {
    const t = h('textarea', { rows: 2, 'data-fk': `${q.code}::note`, placeholder: 'A note for this row — copied into Word under the answer' });
    t.value = v;
    t.addEventListener('input', ev => { ans(q.code).note = ev.target.value; app.changed({ light: true }); });
    t.addEventListener('change', () => app.changed());
    return h('label', { class: 'fld fld-wide' }, h('span', { class: 'fld-label' }, 'Note'), t);
  }

  /* ---------------- Property Services ---------------- */
  function renderPS(root) {
    const ctx = app.ctx, ps = app.defs.propertyServices, p = R().psState(app.session);
    const focus = rememberFocus();
    root.innerHTML = '';
    const card = h('section', { class: 'sec card ps', id: 'sec-ps' },
      h('header', { class: 'sec-head' }, h('h2', null, ps.title),
        h('label', { class: 'inline-check', title: 'Copy the Property Services table into Word as its own table' },
          h('input', { type: 'checkbox', checked: app.session.include.ps, onchange: ev => { app.session.include.ps = ev.target.checked; app.changed({ light: true }); } }),
          ' Include in the Word copy')));
    const setText = (key, v) => { p.answers[key] = v; p.dirty[key] = true; };
    const reset = key => { delete p.answers[key]; delete p.dirty[key]; };
    const overridden = key => h('span', { class: 'ps-over' }, 'Overridden — ',
      h('button', { type: 'button', class: 'link', onclick: () => { reset(key); app.changed(); } }, 'reset to the scope answer'));
    const commentEl = row => {
      const v = p.comments[row.id] || '';
      const w = h('div', { class: 'q-extra' });
      if (!v) w.appendChild(h('button', { type: 'button', class: 'link', onclick: () => { w.innerHTML = ''; w.appendChild(box('')); w.querySelector('textarea').focus(); } }, '+ Add comment'));
      else w.appendChild(box(v));
      function box(val) {
        const t = h('textarea', { rows: 2, 'data-fk': `ps::c::${row.id}`, placeholder: 'Copied into Word under this row’s answer' });
        t.value = val;
        t.addEventListener('input', ev => { p.comments[row.id] = ev.target.value; app.changed({ light: true }); });
        t.addEventListener('change', () => app.changed());
        return t;
      }
      return w;
    };
    ps.rows.forEach(row => {
      if (!R().test(ctx, row.showIf)) return;
      const na = R().psNA(ctx, row);
      if (row.kind === 'sectionHeader') { card.appendChild(h('div', { class: 'ps-sub' }, row.label, na ? ' (not a water level site — NA)' : '')); return; }
      const el = h('div', { class: 'q ps-row', dataset: { ps: row.id } });
      if (row.kind === 'coordGroup') {
        el.appendChild(h('div', { class: 'q-label' }, row.label));
        (row.coords || []).forEach(c => {
          const key = `${row.id}.${c.key}`, v = R().psText(ctx, key, c.source, c.default);
          const input = h('input', { type: 'text', value: v, 'data-fk': `ps::${key}`, placeholder: c.default || '' });
          input.addEventListener('input', ev => { setText(key, ev.target.value); app.changed({ light: true }); });
          input.addEventListener('change', () => app.changed());
          el.appendChild(h('div', { class: 'fld' }, h('span', { class: 'fld-label' }, c.label), h('div', { class: 'fld-line' }, input), p.dirty[key] && c.source ? overridden(key) : null));
        });
      } else if (row.kind === 'question') {
        const v = R().psQuestionValue(ctx, row.id);
        const needs = row.required && !na && !v;
        if (needs) el.classList.add('todo');
        if (v || na) el.classList.add('filled');
        el.appendChild(h('div', { class: 'q-label' }, row.label));
        if (na) el.appendChild(h('div', { class: 'q-hint' }, 'NA — not a water level site'));
        else {
          const opts = h('div', { class: 'opts opts-pills', role: 'radiogroup', 'aria-label': row.label });
          (row.options || []).forEach(o => {
            const input = h('input', { type: 'radio', name: `ps-${row.id}`, value: o.code, checked: v === o.code, 'data-fk': `ps::q::${row.id}::${o.code}` });
            input.addEventListener('click', () => { if (v === o.code && p.dirty[row.id]) { reset(row.id); } else setText(row.id, o.code); app.changed(); });
            opts.appendChild(h('label', { class: 'opt' + (v === o.code ? ' on' : '') }, input, h('span', null, o.label)));
          });
          el.appendChild(opts);
          if (row.linkedNote && row.source && !p.dirty[row.id] && v) el.appendChild(h('div', { class: 'q-note info' }, row.linkedNote));
          if (p.dirty[row.id] && row.source) el.appendChild(overridden(row.id));
          if (row.detail && v === 'yes') {
            const key = `${row.id}.detail`, dv = R().psDetail(ctx, row);
            const input = h('input', { type: 'text', value: dv, 'data-fk': `ps::${key}`, placeholder: row.detail.placeholder || '' });
            input.addEventListener('input', ev => { setText(key, ev.target.value); app.changed({ light: true }); });
            input.addEventListener('change', () => app.changed());
            el.appendChild(h('div', { class: 'fld' }, h('span', { class: 'fld-label' }, row.detail.label), h('div', { class: 'fld-line' }, input)));
          }
        }
      } else if (row.kind === 'text' || row.kind === 'date') {
        const v = row.kind === 'date' ? R().psText(ctx, row.id, null, U().dmy(app.session.forum.date)) : (na ? 'NA' : R().psText(ctx, row.id, row.source, ''));
        el.appendChild(h('div', { class: 'q-label' }, row.label));
        const input = h('input', { type: 'text', value: v, disabled: na, 'data-fk': `ps::${row.id}`, placeholder: row.placeholder || '' });
        input.addEventListener('input', ev => { setText(row.id, ev.target.value); app.changed({ light: true }); });
        input.addEventListener('change', () => app.changed());
        el.appendChild(h('div', { class: 'fld' }, h('div', { class: 'fld-line' }, input)));
      }
      if (!na) el.appendChild(commentEl(row));
      card.appendChild(el);
    });
    const gen = h('textarea', { rows: 2, 'data-fk': 'ps::general', placeholder: 'Anything for Property Services that isn’t about one row' });
    gen.value = p.general;
    gen.addEventListener('input', ev => { p.general = ev.target.value; app.changed({ light: true }); });
    card.appendChild(h('label', { class: 'fld fld-wide' }, h('span', { class: 'fld-label' }, 'Additional comments'), gen));
    card.appendChild(h('div', { class: 'ps-note' }, ps.note));
    root.appendChild(card);
    restoreFocus(focus);
  }

  S.form = { bind, render, renderPS, confirmQuestion };
})(typeof window !== 'undefined' ? window : globalThis);
