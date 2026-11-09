/* SoRT v2 — app.js
   Boots the page and ties the parts together: definitions → session → rules →
   form / Property Services / map / follow-ups / preview, top to bottom.

   Definitions load from, first that works and passes the check (schema.js):
     1. the GitHub contents API (the published copy, as of now)
     2. raw.githubusercontent.com (a CDN copy, up to ~5 minutes behind)
     3. definitions.json next to this page (what was deployed)
   A file that fails the check is skipped with a banner saying so, so a bad edit
   can never stop a forum. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = S.util, R = S.rules, h = U.h, $ = U.$;

  const REPO = { owner: 'cdomotor-g', repo: 'SoRT', branch: 'main', path: 'v2/definitions.json' };
  const LS_THEME = 'sort.theme';            // shared with v1, so the theme follows you

  const A = S.app = {
    defs: null, defsSource: '', defsNote: '', session: null, ctx: null, picture: null,
    playbookChanged: () => { renderDupNote(); renderSavedChip(); if (A.sessionsDraw) A.sessionsDraw(); },
    changed, hint, focusMapOn, drawOnMap, toast, newSession, openSession, refreshStation, useDefs, reloadDefs
  };

  /* ---------------- definitions ---------------- */
  async function loadDefs() {
    const tries = [
      { name: 'GitHub', url: `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}?ref=${REPO.branch}`,
        init: { headers: Object.assign({ Accept: 'application/vnd.github.raw+json' }, S.github ? S.github.authHeader() : {}) } },
      { name: 'GitHub (CDN copy)', url: `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${REPO.branch}/${REPO.path}?t=${Date.now()}` },
      { name: 'the copy deployed with this page', url: `definitions.json?t=${Date.now()}` }
    ];
    const notes = [];
    for (const t of tries) {
      try {
        const d = await U.fetchJson(t.url, { timeoutMs: 10000, init: Object.assign({ cache: 'no-store' }, t.init || {}) });
        const chk = S.schema.check(d);
        if (chk.errors.length) { notes.push(`${t.name}'s definitions have ${chk.errors.length} error(s) (first: ${chk.errors[0]}) — not used.`); continue; }
        A.defs = d; A.defsSource = t.name; A.defsNote = notes.join(' '); A.defsPublishedVersion = d.version;
        // An unpublished draft from "Edit questions" wins in this browser.
        const dr = S.editor && S.editor.draft();
        if (dr && !S.schema.check(dr).errors.length) { A.defs = dr; A.defsSource = 'your unpublished draft'; }
        return;
      } catch (e) { notes.push(`${t.name}: ${e.message || e}`); }
    }
    throw new Error('No definitions could be loaded. ' + notes.join(' '));
  }

  // Switch to other definitions (an editor draft, or a fresh publish) in place.
  function useDefs(defs, source) {
    A.defs = defs; A.defsSource = source;
    if (!S.schema.template(A.defs, A.session.template)) A.session.template = A.defs.templates[0].id;
    rebuild(); renderAll(); renderDefsChip();
  }
  async function reloadDefs() {
    try { await loadDefs(); } catch (e) { toast(e.message); return; }
    useDefs(A.defs, A.defsSource);
  }
  function renderDefsChip() {
    const chip = $('#defsChip'); if (!chip) return;
    chip.innerHTML = '';
    chip.appendChild(document.createTextNode(`Questions v${A.defs.version} · from ${A.defsSource} · `));
    chip.appendChild(h('button', { type: 'button', class: 'link', onclick: () => S.editor.open(A) }, 'Edit questions'));
    const b = $('#banner');
    if (A.defsSource === 'your unpublished draft') {
      b.innerHTML = ''; b.hidden = false;
      b.appendChild(document.createTextNode('You are using your own unpublished changes to the questions. '));
      b.appendChild(h('button', { type: 'button', class: 'link', onclick: () => S.editor.open(A) }, 'Publish or discard them'));
    } else if (A.defsNote) { b.textContent = A.defsNote; b.hidden = false; }
    else b.hidden = true;
  }

  /* ---------------- session plumbing ---------------- */
  // A.localOk: false when this browser refused the last save (its storage full or blocked).
  const saveSoon = U.debounce(() => { if (A.session) keepLocal(); renderSavedChip(); }, 400);
  function keepLocal() {
    const was = A.localOk;
    A.localOk = S.store.save(A.session);
    if (!A.localOk && was !== false) toast('This browser wouldn’t save the session (its storage is full or blocked) — use Download session to keep a copy.');
    return A.localOk;
  }
  const previewSoon = U.debounce(renderPreview, 350);
  function rebuild() { A.ctx = R.context(A.defs, A.session); }

  // Anything changed. `light` = typing in a box: no re-render of the form (so
  // the caret stays put), just the things that read the answers.
  function changed(opts) {
    A.edited = true;
    if (A.earlierForum && !A.forumAsked) { A.forumAsked = true; A.forumAsk = true; renderForum(); }
    rebuild();
    if (!(opts && opts.light)) { S.form.render($('#form')); S.form.renderPS($('#ps')); renderStation(); renderOutputControls(); }
    renderProgress(); renderFollowUps(); previewSoon(); saveSoon();
    if (S.playbook) { S.playbook.autosaveSoon(A); S.playbook.renderActs(A); }
    if (S.mapView) S.mapView.sync(A);
    Object.values(S.suggesters || {}).forEach(m => m.sync(A));   // the corrosion and soil suggestions
  }
  function hint(key) {
    if (key.startsWith('station.')) return S.floodnet.hint(A.session.station, key);
    if (key.startsWith('map.') && S.mapView) return S.mapView.hint(key);
    if (key === 'bureau.benchmarks' && S.bureauBM) return S.bureauBM.node(A);
    return null;
  }
  function focusMapOn(code, field) {
    const el = $('#map-card'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (S.mapView) S.mapView.focusPin(code, field);
  }
  function drawOnMap(code) {
    const el = $('#map-card'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (S.mapView) S.mapView.startDraw(code); else toast('The map isn’t available here.');
  }

  // An older session opened only to look at keeps its forum date and its
  // "changed" time: it is saved, and its date offered for moving, only once
  // somebody actually changes something in it.
  function arrive() {
    A.edited = false; A.forumAsk = false; A.forumAsked = false;
    const d = A.session && A.session.forum && A.session.forum.date;
    A.earlierForum = !!(d && d !== U.todayIso());
  }
  function leave() { if (A.session && A.edited) S.store.save(A.session); }
  // dropped: the session on screen was just deleted — not saved back on the way out.
  function newSession(station, dropped) {
    if (!dropped) leave();
    if (S.playbook) S.playbook.flush(dropped ? null : A);
    A.session = S.store.newSession(A.defs); arrive();
    if (station) A.session.station = station;
    A.picture = null;
    if (S.mapView) S.mapView.reset();
    rebuild(); renderAll();
  }
  function openSession(id) {
    const s = S.store.load(id);
    if (!s) { toast('That session is no longer saved in this browser.'); return; }
    leave();
    if (S.playbook) S.playbook.flush(A);
    A.session = s; arrive(); A.picture = null;
    if (!S.schema.template(A.defs, s.template)) s.template = A.defs.templates[0].id;
    if (S.mapView) S.mapView.reset();
    rebuild(); renderAll();
    toast(`Opened ${s.station && s.station.name ? s.station.name : 'the session'}.`);
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = '';
    t.appendChild(h('span', null, msg));
    if (action) t.appendChild(h('button', { type: 'button', class: 'link', onclick: () => { action.run(); t.hidden = true; } }, action.label));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 8000 : 4000);
  }

  /* ---------------- header + progress ---------------- */
  function renderProgress() {
    const p = R.progress(A.ctx);
    const pct = p.total ? Math.round(100 * p.filled / p.total) : 0;
    $('#progressFill').style.width = pct + '%';
    const txt = $('#progressText');
    txt.innerHTML = '';
    txt.appendChild(document.createTextNode(`${p.filled} of ${p.total} answered`));
    if (p.toConfirm) {
      txt.appendChild(document.createTextNode(' · '));
      txt.appendChild(h('button', { type: 'button', class: 'link confirm-link', id: 'confirmLink', 'aria-haspopup': 'true', 'aria-expanded': String(!!confirmOpen),
        title: 'Answers filled in for you — from Flood-Net, the map, a precedent or an earlier session — that nobody has checked yet. Click to see them.',
        onclick: ev => { ev.stopPropagation(); toggleConfirm(); } }, `${p.toConfirm} to confirm`));
    }
    if (confirmOpen) { if (p.toConfirm) drawConfirm(); else toggleConfirm(false); }
    const st = A.session.station;
    $('#stationChip').textContent = st && st.name ? `${st.name}${st.number ? ' · ' + st.number : ''}` : 'No station yet';
  }
  /* "N to confirm": a list under the progress bar of each answer filled in for
     you and not yet checked — what it says, where it came from — with Keep
     (it's right) and Show (scroll to its card), and Keep all. An answer
     changed on its card counts as checked too. */
  let confirmOpen = false;
  const SRC_WORDS = { floodnet: 'from Flood-Net', map: 'from the map', precedent: 'from a precedent station', earlier: 'from the earlier session' };
  function waitingList() {
    return R.visibleQuestions(A.ctx).filter(q => R.awaitingConfirm(A.ctx, q)).map(q => {
      const e = R.eff(A.ctx, q.code);
      const src = e.src && e.src !== 'user' && e.src !== 'auto' && !R.emptyVal(e.value) ? e.src : Object.values(e.fieldSrc || {}).find(x => R.PREFILL_SRCS.includes(x));
      const bits = [];
      if (e.src === src && !R.emptyVal(e.value)) bits.push([].concat(e.value).map(v => S.schema.optionLabel(q, v)).join(', '));
      (q.fields || []).forEach(f => { if (R.fieldVisible(A.ctx, f) && e.fieldSrc[f.code] === src && String(e.fields[f.code] || '').trim()) bits.push(`${f.label}: ${R.fieldText(f, e.fields[f.code])}`); });
      return { q, src, what: bits.join(' · '), from: (A.session.prefill[q.code] || {}).from || '' };
    });
  }
  function showQuestion(code) {
    const el = document.getElementById(`q-${code}`); if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }
  function drawConfirm() {
    let box = $('#confirmPanel');
    if (!box) {
      box = h('div', { id: 'confirmPanel', class: 'confirm-panel', role: 'dialog', 'aria-label': 'Answers to confirm' });
      box.addEventListener('click', ev => ev.stopPropagation());
      $('.top-progress').appendChild(box);
    }
    box.innerHTML = '';
    const list = waitingList();
    box.appendChild(h('div', { class: 'cp-head' },
      h('b', null, `${list.length} answer${list.length === 1 ? '' : 's'} filled in for you, not checked yet`),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => toggleConfirm(false) }, '✕')));
    box.appendChild(h('p', { class: 'hint' }, 'Each is orange on its card. Keep it if it’s right, or change it on its card — either way it turns green and leaves this list.'));
    const ul = h('ul', { class: 'cp-list' });
    list.forEach(x => ul.appendChild(h('li', null,
      h('div', { class: 'cp-what' }, h('b', null, x.q.label), h('span', { class: `src src-${x.src}` }, SRC_WORDS[x.src] || x.src),
        x.what ? h('div', { class: 'cp-val' }, x.what) : null, x.from ? h('div', { class: 'hint' }, `(${x.from})`) : null),
      h('div', { class: 'cp-acts' },
        h('button', { type: 'button', class: 'btn-mini btn-keep', title: 'This answer is right — keep it', onclick: () => { S.form.confirmQuestion(x.q); changed(); } }, '✓ Keep'),
        h('button', { type: 'button', class: 'btn-mini', title: 'Scroll to its card', onclick: () => showQuestion(x.q.code) }, 'Show')))));
    box.appendChild(ul);
    if (list.length > 1) box.appendChild(h('div', { class: 'cp-foot' },
      h('button', { type: 'button', class: 'btn btn-quiet', title: 'Keep every answer in this list as it is', onclick: () => { list.forEach(x => S.form.confirmQuestion(x.q)); changed(); toast(`${list.length} answers kept.`); } }, `✓ Keep all ${list.length}`)));
  }
  function toggleConfirm(on) {
    confirmOpen = on == null ? !confirmOpen : on;
    const l = $('#confirmLink'); if (l) l.setAttribute('aria-expanded', String(confirmOpen));
    if (confirmOpen) drawConfirm(); else { const b = $('#confirmPanel'); if (b) b.remove(); }
  }
  document.addEventListener('click', () => { if (confirmOpen) toggleConfirm(false); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && confirmOpen) toggleConfirm(false); });

  function renderSavedChip() {
    const s = A.session; if (!s) return;
    const pb = s.playbook && s.playbook.savedAt;
    $('#savedChip').textContent = `${A.localOk === false ? '⚠ Not saved in this browser (its storage is full or blocked)' : 'Saved in this browser ' + U.fmtClock(s.updatedAt)}${pb ? ' · saved to the forum ' + U.fmtClock(pb) : ''}`;
  }

  /* ---------------- forum bar ---------------- */
  function renderForum() {
    const f = A.session.forum;
    const root = $('#forum'); root.innerHTML = '';
    const date = h('input', { type: 'date', id: 'forumDate', value: f.date });
    date.addEventListener('change', ev => { f.date = ev.target.value; A.forumAsked = true; A.forumAsk = false; S.store.rememberForum(f, { dateChosen: true }); changed(); });
    const chips = h('div', { class: 'chips', id: 'attendeeChips' });
    const clear = h('button', { type: 'button', class: 'chips-clear', title: 'Remove every attendee from the list', onclick: () => { const was = f.attendees.slice(); f.attendees = []; renderForum(); changed({ light: true }); toast('Attendees cleared.', { label: 'Undo', run: () => { f.attendees = was; renderForum(); changed({ light: true }); } }); } }, 'Clear all');
    const drawChips = () => {
      chips.innerHTML = '';
      clear.hidden = !f.attendees.length;
      f.attendees.forEach((a, i) => chips.appendChild(h('span', { class: 'chip' }, a,
        h('button', { type: 'button', 'aria-label': `Remove ${a}`, onclick: () => { f.attendees.splice(i, 1); drawChips(); changed({ light: true }); } }, '×'))));
    };
    drawChips();
    const add = h('input', { type: 'text', id: 'attendeeInput', placeholder: 'Initials, then Enter', size: 12, autocomplete: 'off' });
    const commit = () => {
      const parts = add.value.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
      parts.forEach(p => { if (!f.attendees.includes(p)) f.attendees.push(p); });
      add.value = ''; drawChips(); changed({ light: true });
    };
    add.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); commit(); } else if (ev.key === 'Backspace' && !add.value && f.attendees.length) { f.attendees.pop(); drawChips(); changed({ light: true }); } });
    add.addEventListener('blur', () => { if (add.value.trim()) commit(); });
    const last = S.store.forumDay().last;
    const reuse = (!f.attendees.length && last.length) ? h('button', { type: 'button', class: 'link', onclick: () => { f.attendees = last.slice(); renderForum(); changed({ light: true }); } }, `Same as last forum (${last.join(', ')})`) : null;
    const oos = h('input', { type: 'checkbox', checked: f.outOfSession });
    oos.addEventListener('change', ev => { f.outOfSession = ev.target.checked; changed({ light: true }); });
    if (A.forumAsk) {
      const old = f.date, today = U.todayIso();
      const done = move => { A.forumAsk = false; if (move) { f.date = today; changed({ light: true }); } renderForum(); };
      root.appendChild(h('div', { class: 'forum-ask', id: 'forumAsk', role: 'alert' },
        h('span', null, `This session is from the forum of ${U.dmy(old)}. You’ve started changing it — keep that forum date, or move it to today’s forum (${U.dmy(today)})?`), ' ',
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => done(false) }, `Keep ${U.dmy(old)}`), ' ',
        h('button', { type: 'button', class: 'btn', onclick: () => done(true) }, `Move to ${U.dmy(today)}`)));
    }
    root.appendChild(h('div', { class: 'forum-grid' },
      h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'SoRT Forum date'), date),
      h('div', { class: 'fld fld-grow' }, h('label', { class: 'fld-label', for: 'attendeeInput' }, 'Attendees'), h('div', { class: 'chips-box' }, chips, add, clear), reuse),
      h('label', { class: 'inline-check', title: 'Adds “(out of session – scope builder only)” after the attendees, as the reports have it' }, oos, ' Out of session')));
  }

  /* ---------------- station ---------------- */
  let searchSeq = 0;
  function renderStation() {
    const root = $('#station'); root.innerHTML = '';
    const st = A.session.station;
    root.appendChild(h('header', { class: 'sec-head' }, h('h2', null, 'Station'),
      st ? h('button', { type: 'button', class: 'link', onclick: () => { stationSearch(root, true); } }, 'Change station') : null));
    if (!st) stationSearch(root, false);
    else { root.appendChild(stationCard(st)); renderDupNote(); }
    root.appendChild(templatePicker());
  }
  function stationSearch(root, replacing) {
    const old = root.querySelector('.station-find'); if (old) { old.querySelector('input').focus(); return; }
    const input = h('input', { type: 'search', id: 'stationSearch', placeholder: 'Search Flood-Net — station name, Bureau number or ALERT ID', autocomplete: 'off', 'aria-controls': 'stationResults' });
    const list = h('ul', { class: 'results', id: 'stationResults', role: 'listbox' });
    const status = h('div', { class: 'hint' });
    let rows = [], active = -1;
    const pick = r => choose(r.id);
    const draw = () => {
      list.innerHTML = '';
      rows.forEach((r, i) => {
        const li = h('li', { role: 'option', class: i === active ? 'active' : '', 'aria-selected': i === active ? 'true' : 'false', onclick: () => pick(r) },
          h('div', { class: 'res-name' }, r.name, r.station_number ? h('span', { class: 'res-num' }, r.station_number) : null,
            r.proposed ? h('span', { class: 'tag' }, 'proposed') : null),
          h('div', { class: 'res-meta' }, [(r.kinds || []).map(k => S.floodnet.KIND_LABEL[k] || k).join(' + '), r.lga, r.hub_id ? r.hub_id + ' hub' : '',
            (r.telemetry && Object.values(r.telemetry.alert_ids || {}).length) ? 'ALERT ' + Object.values(r.telemetry.alert_ids).join(', ') : ''].filter(Boolean).join(' · ')));
        list.appendChild(li);
      });
    };
    const run = U.debounce(async q => {
      const my = ++searchSeq;
      if (q.trim().length < 2 && !/^\d+$/.test(q.trim())) { rows = []; draw(); status.textContent = ''; return; }
      status.textContent = 'Searching Flood-Net…';
      try {
        const res = await S.floodnet.search(q.trim(), 8);
        if (my !== searchSeq) return;
        rows = res.stations || []; active = rows.length ? 0 : -1; draw();
        status.innerHTML = '';
        if (!rows.length) status.append('No station by that name or number in Flood-Net. ', byHandLink(q));
      } catch (e) {
        if (my !== searchSeq) return;
        rows = []; draw();
        status.innerHTML = '';
        status.append(`Flood-Net didn’t answer (${e.message}). `, byHandLink(q));
      }
    }, 250);
    input.addEventListener('input', ev => run(ev.target.value));
    input.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); draw(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && rows[active]) { ev.preventDefault(); pick(rows[active]); }
      else if (ev.key === 'Escape' && replacing) renderStation();
    });
    const manual = h('details', { class: 'manual' }, h('summary', null, 'Not in Flood-Net? Enter it by hand'), manualForm(null));
    // The search's words go into the form: digits as the number, anything else as the name.
    function byHandLink(q) {
      return h('button', { type: 'button', class: 'link', onclick: () => {
        const t = String(q || '').trim(), f = manual.querySelector('.manual-grid');
        if (t) f.querySelector(/^\d+$/.test(t) ? '[name=number]' : '[name=name]').value = t;
        manual.open = true; f.querySelector('[name=name]').focus();
      } }, 'Enter it by hand');
    }
    const box = h('div', { class: 'station-find' }, input, status, list, manual);
    const card = root.querySelector('.station-card');
    if (card) root.insertBefore(box, card); else root.appendChild(box);
    setTimeout(() => input.focus(), 0);
  }
  /* A station Flood-Net doesn't have yet, typed in (rare). The same facts a
     Flood-Net station has, so everything downstream treats it alike: the table
     suggested from what it measures, the hub team for tasks, the map, Word.
     `was` = the hand-entered station being edited (it stays the same station). */
  const HUBS = [['adelaide', 'Adelaide Hub'], ['brisbane', 'Brisbane Hub'], ['cairns', 'Cairns Hub'], ['darwin', 'Darwin Hub'],
    ['hobart', 'Hobart Hub'], ['melbourne', 'Melbourne Hub'], ['perth', 'Perth Hub'], ['sydney', 'Sydney Hub']];
  const MEASURES = [['rain', 'Rainfall', { kinds: ['rain'] }], ['river', 'Water level', { kinds: ['river'] }],
    ['both', 'Rainfall and water level', { kinds: ['rain', 'river'] }], ['repeater', 'Repeater', { roles: ['repeater'] }],
    ['base', 'Base station', { roles: ['base'] }], ['', 'Not sure', {}]];
  function manualForm(was) {
    const w = was || {};
    const fld = (label, el, hint) => h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, label), el, hint ? h('span', { class: 'hint' }, hint) : null);
    const text = (name, value, placeholder) => h('input', { type: 'text', name, value: value || '', placeholder: placeholder || '' });
    const pick = (name, list, cur) => h('select', { name }, list.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
    const measureNow = (w.roles || []).includes('repeater') ? 'repeater' : (w.roles || []).includes('base') ? 'base'
      : ['rain', 'river'].every(k => (w.kinds || []).includes(k)) ? 'both' : (w.kinds || [])[0] || '';
    const f = {
      name: text('name', w.name, 'e.g. Fifteen Mile AL'),
      number: text('number', w.number, 'e.g. 540601'),
      pos: text('pos', w.lat != null ? U.formatCoord(w.lat, w.lon) : '', 'e.g. -27.4710, 153.0234'),
      measures: pick('measures', MEASURES.map(([v, t]) => [v, t]), measureNow),
      alert: text('alert', (w.alertIds || []).map(a => a.id).join(', '), 'e.g. 4043, 4044'),
      hub: pick('hub', [['', 'Not sure']].concat(HUBS), w.hubId || ''),
      lga: text('lga', w.lga, 'e.g. Toowoomba Regional'),
      owner: text('owner', w.owner, 'e.g. Bureau, or the council')
    };
    const go = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
      const name = f.name.value.trim(), p = U.parseCoord(f.pos.value);
      if (!name) { toast('Give the station a name.'); f.name.focus(); return; }
      if (f.pos.value.trim() && !p.ok) { toast(p.error || 'That position doesn’t read as coordinates.'); f.pos.focus(); return; }
      const ids = [...new Set(f.alert.value.split(/[\s,;]+/).filter(Boolean))];
      if (ids.some(x => !/^\d{1,5}$/.test(x))) { toast('ALERT IDs are whole numbers, e.g. 4043, 4044.'); f.alert.focus(); return; }
      const hub = HUBS.find(x => x[0] === f.hub.value);
      const kindRole = (MEASURES.find(x => x[0] === f.measures.value) || [, , {}])[2];
      const facts = {
        source: 'manual', id: '', number: f.number.value.trim(), name, awrc: '', proposed: false,
        lat: p.ok ? p.lat : null, lon: p.ok ? p.lon : null, precision: p.ok ? U.coordPrecision(p.lat, p.lon) : null, elevation: null,
        kinds: kindRole.kinds || [], roles: kindRole.roles || [],
        hubId: hub ? hub[0] : '', hubName: hub ? hub[1] : '', lga: f.lga.value.trim(), basin: '', stream: '',
        owner: f.owner.value.trim(), sls: null,
        alertIds: ids.map(x => ({ id: Number(x), type: '' })), satcom: false,
        commsGuess: ids.length ? 'errts' : null, commsWhy: ids.length ? 'you entered ALERT IDs for it' : '',
        txFrequency: null, repeater: null, acma: null, acmaLicence: '', acmaHolder: '', fadeMargin: null, radioPath: null,
        lastHeard: null, fetchedAt: Date.now(), app: ''
      };
      if (was) {
        // Same station, details corrected: keep its map check if the position didn't change.
        if (was.checked && was.lat === facts.lat && was.lon === facts.lon) facts.checked = was.checked;
        A.session.station = facts;
        const sug = S.floodnet.suggestTemplate(A.defs, facts);
        if (sug && !Object.keys(A.session.answers).length) A.session.template = sug;
        S.floodnet.applyPrefill(A.defs, A.session);
        renderStation(); changed();
        if (S.mapView) S.mapView.station(A);
        toast('Station details saved.');
      } else setStation(facts);
    } }, was ? 'Save the details' : 'Use this station');
    return h('div', { class: 'manual-grid' },
      fld('Station name *', f.name), fld('Bureau number', f.number), fld('Position', f.pos, 'Or place it on the map later'),
      fld('It measures', f.measures, 'Picks the scope table'), fld('ALERT IDs', f.alert), fld('Hub', f.hub, 'Its hub team gets the hub’s tasks'),
      fld('Council', f.lga), fld('Owner', f.owner),
      h('div', { class: 'manual-acts' }, go,
        was ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => renderStation() }, 'Cancel') : null,
        h('span', { class: 'hint' }, 'Only the name is needed; the rest can be added later with ', h('b', null, 'Edit details'), ' on the station card.')));
  }
  function editManual() {
    const root = $('#station'), card = root.querySelector('.station-card');
    if (!card || root.querySelector('.manual-edit')) return;
    const box = h('div', { class: 'manual-edit' }, h('h3', null, 'Station details (entered by hand)'), manualForm(A.session.station));
    card.replaceWith(box);
    box.querySelector('[name=name]').focus();
  }
  async function choose(id) {
    const root = $('#station');
    const box = root.querySelector('.station-find');
    if (box) box.querySelector('.hint').textContent = 'Fetching the station from Flood-Net…';
    try {
      const facts = await S.floodnet.stationFacts(id);
      setStation(facts);
    } catch (e) {
      if (box) box.querySelector('.hint').textContent = `Couldn’t fetch it (${e.message}). Try again, or enter it by hand.`;
    }
  }
  function setStation(facts) {
    const s = A.session, had = s.station;
    const busy = had && (Object.keys(s.answers).length || Object.keys(s.ps.answers || {}).length);
    const ident = x => (x.id ? 'fn:' + x.id : 'manual:' + (x.number || x.name || ''));
    if (busy && ident(had) !== ident(facts)) {
      // A different station on a session with answers: keep that one, start afresh.
      newSession(facts);
      toast(`New session for ${facts.name}. The previous one is under Sessions.`);
    } else {
      if (had && ident(had) === ident(facts) && had.checked) facts.checked = had.checked;
      s.station = facts;
    }
    const sug = S.floodnet.suggestTemplate(A.defs, facts);
    if (sug && !Object.keys(A.session.answers).length) A.session.template = sug;
    S.floodnet.applyPrefill(A.defs, A.session);
    changed();
    if (S.mapView) S.mapView.station(A);
  }
  async function refreshStation() {
    const st = A.session.station; if (!st || st.source !== 'floodnet') return;
    try {
      const f = await S.floodnet.stationFacts(st.id); f.checked = st.checked;
      const fixed = keepEdits(st, f);
      A.session.station = f; S.floodnet.applyPrefill(A.defs, A.session); changed();
      toast(fixed.length ? `Station refreshed — Flood-Net now has the ${fixed.join(' and ')} you corrected.` : 'Station refreshed from Flood-Net.');
    }
    catch (e) { toast(`Flood-Net didn’t answer (${e.message}).`); }
  }
  /* The station's particulars, corrected here (e.g. a name Flood-Net has cut
     short — Radio Mobile's exports truncate them). The correction goes into the
     Word tables; Flood-Net is not changed. Each one is kept on the station as
     edits[field] = { floodnet: what Flood-Net has, at }, shown on the card, and
     can be reported to Flood-Net so its record gets fixed too. */
  const PARTICULARS = [['name', 'Station name'], ['number', 'Bureau number'], ['hub', 'Hub'], ['lga', 'Council'], ['owner', 'Owner']];
  const partValue = (st, k) => String(k === 'hub' ? (st.hubId || '') : (st[k] || '')).trim();
  const partText = (k, v) => (k === 'hub' ? ((HUBS.find(x => x[0] === v) || [, v])[1] || '') : v) || '(none)';
  // (A hub Flood-Net names that isn't in HUBS keeps its own name: setPart below.)
  function setPart(st, k, v) {
    if (k === 'hub') { const hb = HUBS.find(x => x[0] === v); if (hb || !v) { st.hubId = hb ? hb[0] : ''; st.hubName = hb ? hb[1] : ''; } else st.hubId = v; }
    else st[k] = v;
  }
  // Carries the forum's corrections onto freshly fetched facts; returns the
  // fields Flood-Net has since been corrected in (their edits are dropped).
  function keepEdits(was, fresh) {
    const fixed = [];
    Object.entries(was.edits || {}).forEach(([k, e]) => {
      const mine = partValue(was, k), theirs = partValue(fresh, k);
      if (theirs === mine) { fixed.push(PARTICULARS.find(x => x[0] === k)[1].toLowerCase()); return; }
      fresh.edits = fresh.edits || {};
      fresh.edits[k] = Object.assign({}, e, { floodnet: theirs });
      setPart(fresh, k, mine);
    });
    if (fresh.edits && was.reported) fresh.reported = was.reported;
    return fixed;
  }
  function editParticulars() {
    const st = A.session.station, root = $('#station'), card = root.querySelector('.station-card');
    if (!st || !card || root.querySelector('.manual-edit')) return;
    if (st.source === 'manual') { editManual(); return; }
    const inputs = {};
    const fld = (k, label, el, hint) => { inputs[k] = el; return h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, label), el, hint ? h('span', { class: 'hint' }, hint) : null); };
    const orig = k => (st.edits && st.edits[k] ? st.edits[k].floodnet : partValue(st, k));
    const was = k => (st.edits && st.edits[k] ? `Flood-Net has “${partText(k, orig(k))}”` : null);
    const box = h('div', { class: 'manual-edit' },
      h('h3', null, 'Correct the station’s details'),
      h('p', { class: 'hint' }, 'For this scope and its Word tables. Flood-Net is not changed — the card flags what differs, and you can report it to Flood-Net.'),
      h('div', { class: 'manual-grid' },
        fld('name', 'Station name *', h('input', { type: 'text', name: 'name', value: st.name || '' }), was('name')),
        fld('number', 'Bureau number', h('input', { type: 'text', name: 'number', value: st.number || '' }), was('number')),
        fld('hub', 'Hub', h('select', { name: 'hub' }, [['', 'Not sure']].concat(HUBS, st.hubId && !HUBS.some(x => x[0] === st.hubId) ? [[st.hubId, st.hubName || st.hubId]] : []).map(([v, t]) => h('option', { value: v, selected: v === (st.hubId || '') }, t))), was('hub')),
        fld('lga', 'Council', h('input', { type: 'text', name: 'lga', value: st.lga || '' }), was('lga')),
        fld('owner', 'Owner', h('input', { type: 'text', name: 'owner', value: st.owner || '' }), was('owner')),
        h('div', { class: 'manual-acts' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
            const next = Object.fromEntries(PARTICULARS.map(([k]) => [k, inputs[k].value.trim()]));
            if (!next.name) { toast('Give the station a name.'); inputs.name.focus(); return; }
            PARTICULARS.forEach(([k]) => {
              const o = orig(k);
              if (next[k] === partValue(st, k)) return;
              setPart(st, k, next[k]);
              st.edits = st.edits || {};
              if (next[k] === o) delete st.edits[k]; else st.edits[k] = { floodnet: o, at: Date.now() };
            });
            if (st.edits && !Object.keys(st.edits).length) delete st.edits;
            delete st.reported;   // anything changed since a report is reported afresh
            renderStation(); changed();
            toast(st.edits ? 'Saved for this scope. The card shows what differs from Flood-Net.' : 'Saved — it matches Flood-Net again.');
          } }, 'Save the details'),
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => renderStation() }, 'Cancel'))));
    card.replaceWith(box);
    inputs.name.focus();
  }
  // What the forum changed, and Flood-Net still has: a note on the card, and a
  // report for Flood-Net (filed by Flood-Net's own report route when it's on,
  // or GitHub's ready-made issue page in Flood-Net's tracker until then).
  function editsNote(st) {
    const list = Object.entries(st.edits || {});
    if (!list.length) return null;
    const undo = k => { setPart(st, k, st.edits[k].floodnet); delete st.edits[k]; if (!Object.keys(st.edits).length) delete st.edits; delete st.reported; renderStation(); changed(); };
    return h('div', { class: 'st-edits', role: 'note' },
      h('div', null, h('b', null, '✎ Corrected here — Flood-Net still has the old details. '),
        'The Word tables use the corrections.'),
      h('ul', null, list.map(([k, e]) => h('li', null,
        `${PARTICULARS.find(x => x[0] === k)[1]}: “${partText(k, partValue(st, k))}” — Flood-Net has “${partText(k, e.floodnet)}” `,
        h('button', { type: 'button', class: 'link', title: 'Put back what Flood-Net has', onclick: () => undo(k) }, 'use Flood-Net’s')))),
      h('div', { class: 'st-edits-acts' },
        st.reported ? h('span', { class: 'hint' }, `Reported to Flood-Net ${U.fmtWhen(st.reported.at)}${st.reported.url ? ' — ' : ''}`,
          st.reported.url ? h('a', { href: st.reported.url, target: '_blank', rel: 'noopener' }, st.reported.number ? `#${st.reported.number} ↗` : 'the issue ↗') : null) : null,
        h('button', { type: 'button', class: 'btn-mini', onclick: () => reportEdits(st), title: 'Tell Flood-Net so its record can be corrected too' }, st.reported ? 'Report again' : 'Report to Flood-Net')));
  }
  const FN_ISSUES = 'https://github.com/cdomotor-g/MegaNet/issues/new';
  function editsReport(st) {
    const rows = Object.entries(st.edits || {}).map(([k, e]) => `| ${PARTICULARS.find(x => x[0] === k)[1]} | ${partText(k, e.floodnet)} | ${partText(k, partValue(st, k))} |`);
    const id = st.id || '';
    return {
      title: `[Standalone] [Sonnet5/Low] Correct ${st.number || id} ${(st.edits && st.edits.name ? st.edits.name.floodnet : st.name) || ''}: details from the SoRT forum`.replace(/\s+/g, ' ').trim(),
      body: ['Recommended: Sonnet5 / Low — update the station record from the corrections below (check each first).', '',
        `The SoRT scope builder's forum of ${U.dmy(A.session.forum.date)} corrected these details for Flood-Net station \`${id}\`${st.number ? ` (${st.number})` : ''}. SoRT's Word tables use the corrections; Flood-Net still has the old ones.`, '',
        '| Field | Flood-Net has | The forum has |', '|---|---|---|', ...rows, '',
        `Station: https://floodwarning.net/?station=${encodeURIComponent(id)}`, '',
        'Names cut short are probably Radio Mobile export truncations.'].join('\n')
    };
  }
  async function reportEdits(st) {
    const r = editsReport(st);
    let route = null;
    try { const res = await fetch(`${S.floodnet.API.replace(/\/api\/v1\/?$/, '')}/api/report`); route = res.ok ? await res.json() : null; } catch (_) { route = null; }
    if (route && route.ready) {
      if (!G.confirm(`Send this to Flood-Net? It becomes a public issue in its tracker.\n\n${r.title}\n\n${r.body}`)) return;
      try {
        const res = await fetch(`${S.floodnet.API.replace(/\/api\/v1\/?$/, '')}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'bug', title: r.title, body: r.body }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
        st.reported = { at: Date.now(), url: out.url || '', number: out.number || null };
        renderStation(); changed({ light: true });
        toast(out.number ? `Reported to Flood-Net as #${out.number}.` : 'Reported to Flood-Net.');
        return;
      } catch (e) { toast(`Flood-Net didn’t take it (${e.message}) — opening GitHub’s page instead.`); }
    }
    // Until Flood-Net's report route is on: its tracker's ready-made New issue page.
    const a = h('a', { href: `${FN_ISSUES}?title=${encodeURIComponent(r.title)}&body=${encodeURIComponent(r.body)}`, target: '_blank', rel: 'noopener' });
    document.body.appendChild(a); a.click(); a.remove();
    st.reported = { at: Date.now(), url: '', number: null, via: 'github' };
    renderStation(); changed({ light: true });
    toast('Opened a ready-made issue in Flood-Net’s tracker — press Submit there (it needs a GitHub account).');
  }
  function stationCard(st) {
    const fn = S.floodnet;
    const facts = [];
    const add = (k, v, title) => { if (v) facts.push(h('dt', { title: title || null }, k), h('dd', null, v)); };
    if (st.alertIds && st.alertIds.length) add('ALERT IDs', st.alertIds.map(a => `${a.id}${a.type ? ' (' + a.type.toLowerCase() + ')' : ''}`).join(', '));
    else if (st.source === 'floodnet') add('ALERT IDs', 'none recorded');
    if (st.commsGuess) add('Comms now', `${({ errts: 'ERRTS / ALERT VHF', cellular: 'IP logger – cellular (probably)', satellite: 'IP logger – satellite', unknown: 'not known' })[st.commsGuess]} — ${st.commsWhy}`, 'Flood-Net’s best guess at what is on site now; the Current Comms question starts from it');
    if (st.repeater) add('Repeater radio', `RX ${fn.freqText(st.repeater.rx)} · TX ${fn.freqText(st.repeater.tx)}${st.repeater.passRanges ? ' · passes ' + st.repeater.passRanges : ''}`);
    else if (st.txFrequency) add('Frequency', `${fn.freqText(st.txFrequency.mhz)} — inferred from ${st.txFrequency.from.join(', ')}`, 'Flood-Net records frequencies on repeaters; a field station transmits on what the repeaters passing its ALERT IDs listen on');
    // (The radio path to base is on the Fade Margin question, not here.)
    if (st.acma) {
      const own = st.acma.recorded.concat(st.acma.register).slice(0, 3);
      add('ACMA licence', own.length ? own.map(a => `${a.licence}${a.holder ? ' — ' + a.holder : ''}${a.expired ? ' (expired)' : ''}`).join('; ')
        : `none at the site in the register${st.acma.extract ? ` (extract of ${U.dmy(st.acma.extract.date)})` : ''}`, 'From Flood-Net’s ACMA route; the ACMA Licence question has the detail');
    }
    if (st.lat != null) {
      const p = st.precision;
      add('Location', `${U.formatCoord(st.lat, st.lon)}${p ? ` · ${p.places} decimal places (${p.metres < 1 ? 'under 1 m' : '±' + U.fmtDist(p.metres)})` : ''}${st.checked ? ` · checked on the map, moved ${U.fmtDist(st.checked.movedM)}` : ' · check it on the map'}`);
    }
    add('Hub · council', [st.hubName, st.lga].filter(Boolean).join(' · '));
    if (st.sls) add('Service level', [st.sls.gaugeType, st.sls.dataType, st.sls.priority && `priority ${st.sls.priority}`, st.sls.owner && `owner ${st.sls.owner}`].filter(Boolean).join(' · '));
    if (st.lastHeard) add('Last heard', U.fmtWhen(st.lastHeard), 'When Flood-Net’s own receivers last heard it — most stations report through the Bureau, so “never” here says nothing about whether it works');
    return h('div', { class: 'station-card' },
      h('div', { id: 'dupNote', class: 'st-dup', role: 'note', hidden: true }),
      h('div', { class: 'st-title' }, h('span', { class: 'st-name' }, st.name), st.number ? h('span', { class: 'st-num' }, st.number) : null,
        (st.kinds || []).map(k => h('span', { class: 'tag' }, fn.KIND_LABEL[k] || k)),
        st.proposed ? h('span', { class: 'tag warn' }, 'proposed') : null,
        st.source === 'manual' ? h('span', { class: 'tag' }, 'entered by hand') : null,
        st.edits ? h('span', { class: 'tag warn', title: 'Corrected here; Flood-Net still has the old details' }, 'corrected') : null),
      editsNote(st),
      facts.length ? h('dl', { class: 'st-facts' }, facts) : null,
      h('div', { class: 'st-links' },
        st.app ? h('a', { href: st.app, target: '_blank', rel: 'noopener' }, 'Open in Flood-Net ↗') : null,
        st.source === 'floodnet' ? h('button', { type: 'button', class: 'link', onclick: refreshStation }, 'Refresh from Flood-Net') : null,
        h('button', { type: 'button', class: 'link', onclick: editParticulars, title: 'Correct the name, number, hub, council or owner for this scope' }, 'Edit details')),
      S.playbook ? S.playbook.stationStrip(A) : null);
  }
  function templatePicker() {
    const sug = S.floodnet.suggestTemplate(A.defs, A.session.station);
    const wrap = h('div', { class: 'tpl-pick', role: 'radiogroup', 'aria-label': 'Station type' }, h('span', { class: 'fld-label' }, 'Scope table'));
    A.defs.templates.forEach(t => {
      const on = A.session.template === t.id;
      wrap.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: 'seg' + (on ? ' on' : ''),
        onclick: () => { if (on) return; A.session.template = t.id; S.floodnet.applyPrefill(A.defs, A.session); changed(); } },
        t.label, sug === t.id ? h('span', { class: 'seg-tag', title: 'Suggested from what Flood-Net records about the station' }, 'suggested') : null));
    });
    return wrap;
  }

  /* ---------------- follow-ups + output ---------------- */
  function renderFollowUps() {
    const root = $('#followups'); if (!root) return;
    if (S.tasks) { S.tasks.render(A, root); return; }
    root.innerHTML = '';
  }
  function renderOutputControls() {
    const s = A.session, inc = s.include;
    const root = $('#outputControls'); root.innerHTML = '';
    if (inc.bureauBM == null) inc.bureauBM = true;   // sessions from before it
    if (inc.bridges == null) inc.bridges = true;
    const tick = (key, label, title) => {
      const i = h('input', { type: 'checkbox', checked: inc[key] });
      i.addEventListener('change', ev => { inc[key] = ev.target.checked; if (key === 'empty') S.store.rememberEmpty(ev.target.checked); changed({ light: true }); });
      return h('label', { class: 'inline-check', title: title || null }, i, ' ', label);
    };
    const oc = h('select', { id: 'outcome' }, h('option', { value: '' }, '— not decided —'),
      ((A.defs.session || {}).outcomes || []).map(o => h('option', { value: o.code, selected: s.outcome === o.code }, o.label)));
    oc.addEventListener('change', ev => { s.outcome = ev.target.value || null; changed({ light: true }); });
    const ocn = h('input', { type: 'text', value: s.outcomeNote || '', placeholder: 'e.g. what data or visit is needed', 'data-fk': 'outcomeNote' });
    ocn.addEventListener('input', ev => { s.outcomeNote = ev.target.value; changed({ light: true }); });
    root.appendChild(h('div', { class: 'out-grid' },
      h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Forum outcome'), oc),
      h('label', { class: 'fld fld-grow' }, h('span', { class: 'fld-label' }, 'Outcome note'), ocn)));
    root.appendChild(h('div', { class: 'ticks' },
      tick('header', 'Title, date and attendees', 'The station’s name and number are on every table’s heading either way'), tick('empty', 'Rows with nothing filled in', 'Unticked, the questions nobody answered are left out of Word. This browser remembers your choice for new sessions.'),
      tick('followUps', 'Follow-up actions'), tick('map', 'Map picture'), A.ctx.waterLevel ? tick('marks', 'State survey marks table', 'Queensland’s survey marks near the station (S1–S5 on the map) — water level tables only') : null,
      tick('bridges', 'Bridges table', 'The bridges on the map (BR1, BR2…) and who manages each, with who to contact'),
      tick('bureauBM', 'Bureau benchmarks table', 'The station’s own benchmarks from HDB, once fetched from Flood-Net on the Local TBM question'), tick('ps', 'Property Services table')));
  }
  function renderPreview() {
    const root = $('#preview'); if (!root || !A.ctx) return;
    const out = S.word.build(A.ctx, A.session.include.map ? A.picture : null);
    root.innerHTML = out.html;
    if (A.session.include.map && !A.picture) refreshPicture();
  }
  // The preview shows the map picture as it will land in Word. It is re-taken
  // once the map settles after a change — only while the preview is on screen,
  // and never two at once. Copy for Word takes its own fresh picture anyway.
  let picBusy = false, picFor = -1, previewSeen = false;
  const refreshPicture = U.debounce(async () => {
    if (!previewSeen || picBusy || !A.session.include.map || !S.mapView || !S.mapView.ready()) return;
    const v = S.mapView.version();
    if (A.picture && v === picFor) return;
    picBusy = true;
    try { const pic = await S.mapView.picture(); A.picture = pic; picFor = v; renderPreviewNow(); }
    catch (_) { /* no picture yet (still drawing, no location): the next change tries again */ }
    finally { picBusy = false; }
  }, 1500);
  function renderPreviewNow() {
    const root = $('#preview'); if (!root || !A.ctx) return;
    root.innerHTML = S.word.build(A.ctx, A.session.include.map ? A.picture : null).html;
  }
  A.mapChanged = () => refreshPicture();
  A.picturesLoaded = () => previewSoon();   // a question's pictures reached memory (js/pictures.js)
  function watchPreview() {
    const el = $('#preview'); if (!el || !G.IntersectionObserver) { previewSeen = true; return; }
    new G.IntersectionObserver(es => { previewSeen = es.some(e => e.isIntersecting); if (previewSeen) refreshPicture(); }, { rootMargin: '200px' }).observe(el);
  }
  // The clipboard is handed a promise the moment Copy is pressed, so the time
  // the map picture takes can't outlast the browser's "just clicked" window;
  // browsers without promise support get the older wait-then-write route.
  async function copyForWord() {
    const btns = U.$$('.copy-btn'); btns.forEach(b => { b.disabled = true; });
    let note = '';
    const built = (async () => {
      let picture = null;
      if (A.session.include.map && S.mapView) {
        toast('Making the map picture…');
        try { picture = await S.mapView.picture(); A.picture = picture; }
        catch (e) { note = ` (no map picture: ${e.message})`; }
        if (!picture && !note) note = ' (no map picture — no location yet)';
        if (picture && picture.outside) note = ` — ${picture.outside} location${picture.outside > 1 ? 's are' : ' is'} outside the map picture`;
      }
      if (S.pictures) await S.pictures.ready(A.session);   // the questions' pictures, into memory for build()
      return S.word.build(A.ctx, picture);
    })();
    try {
      let how = null;
      try {
        if (navigator.clipboard && G.ClipboardItem) {
          await navigator.clipboard.write([new G.ClipboardItem({
            'text/html': built.then(o => new Blob([o.html], { type: 'text/html' })),
            'text/plain': built.then(o => new Blob([o.text], { type: 'text/plain' }))
          })]);
          how = 'rich';
        }
      } catch (_) { how = null; }
      if (!how) { const out = await built; how = await S.word.toClipboard(out.html, out.text); }
      toast(how === 'rich' ? `Copied — paste into Word${note}` : 'Copied as plain text only (the browser refused the formatted copy)');
      renderPreview();
    } catch (e) { toast(`Copy failed: ${e.message}`); }
    finally { btns.forEach(b => { b.disabled = false; }); }
  }
  async function downloadSession() {
    // The questions' pictures go in the file too (the session itself keeps only their names).
    const pics = S.pictures ? await S.pictures.bundle(A.session) : null;
    const blob = new Blob([JSON.stringify(pics ? Object.assign({}, A.session, { pictureFiles: pics }) : A.session, null, 2)], { type: 'application/json' });
    const st = A.session.station || {};
    const name = `sort-session-${(st.number || st.name || 'station').toString().replace(/[^\w.-]+/g, '-')}-${A.session.forum.date}.json`;
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function importSession(file) {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const s = S.store.upgrade(JSON.parse(r.result));
        if (!s || !s.id || s.schema !== 'sort-session/1') throw new Error('not a SoRT session file');
        if (s.pictureFiles && S.pictures) await S.pictures.unbundle(s.pictureFiles);
        delete s.pictureFiles;
        S.store.save(s); openSession(s.id);
      } catch (e) { toast(`Couldn’t open that file: ${e.message}`); }
    };
    r.readAsText(file);
  }

  /* ---------------- Sessions Management ---------------- */
  // A session out of this browser (a new one on screen if it was open — the
  // deleted one isn't saved back on the way out, as switching would).
  function dropLocal(id) {
    const cur = A.session && A.session.id === id;
    S.store.remove(id);
    if (cur) newSession(null, true);
  }
  A.dropLocal = dropLocal;
  /* Sessions Management: a search, this browser's sessions, then the shared
     playbook's. Delete is two steps: Delete, then Confirm delete (or Cancel)
     in a line under the row, saying what goes. */
  function openSessions(query) {
    const dlg = $('#sessionsDlg'), list = $('#sessionsList');
    list.innerHTML = '';
    let ask = null;   // the session in this browser whose Delete is waiting to be confirmed: { id, phase, error }
    const search = h('input', { type: 'search', id: 'sessionsSearch', class: 'sess-search', placeholder: 'Find a station — name or number', autocomplete: 'off', value: query || '' });
    const results = h('div', { id: 'sessionsResults' });
    list.appendChild(search); list.appendChild(results);
    const close = () => { if (dlg.open) dlg.close(); };
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      results.innerHTML = '';
      const idx = S.store.index().filter(x => !q || [x.name, x.number].some(v => String(v || '').toLowerCase().includes(q)));
      results.appendChild(h('h3', null, 'In this browser'));
      if (!idx.length) results.appendChild(h('p', { class: 'muted' }, q ? 'No session in this browser matches.' : 'No sessions saved in this browser yet.'));
      const outcomes = Object.fromEntries(((A.defs.session || {}).outcomes || []).map(o => [o.code, o.label]));
      if (ask && !idx.some(x => x.id === ask.id)) ask = null;
      idx.forEach(x => {
        const cur = A.session && x.id === A.session.id, asking = ask && ask.id === x.id;
        results.appendChild(h('div', { class: 'sess' + (cur ? ' current' : '') + (asking ? ' asking' : '') },
          h('div', { class: 'sess-main' },
            h('div', { class: 'sess-name' }, x.name || 'No station', x.number ? h('span', { class: 'res-num' }, x.number) : null, cur ? h('span', { class: 'tag' }, 'open') : null),
            h('div', { class: 'res-meta' }, [(S.schema.template(A.defs, x.template) || {}).label, x.forumDate && `forum ${U.dmy(x.forumDate)}`, x.outcome ? outcomes[x.outcome] : 'not finished',
              `changed ${U.fmtWhen(x.updatedAt)}`, x.playbookAt ? 'saved to the forum' : 'only in this browser'].filter(Boolean).join(' · '))),
          h('div', { class: 'sess-acts' },
            cur ? null : h('button', { type: 'button', class: 'btn', onclick: () => { close(); openSession(x.id); } }, 'Open'),
            asking ? null : h('button', { type: 'button', class: 'btn btn-quiet btn-del', title: 'Delete this session — you are asked to confirm first', onclick: () => {
              ask = { id: x.id, phase: 'ready' };
              if (S.playbook) S.playbook.state.ask = null;
              draw();
            } }, 'Delete')),
          asking ? askLocal(x, cur) : null));
      });
      if (S.playbook) results.appendChild(S.playbook.panel(A, q, close, () => { ask = null; }));
      // Delete just pressed (its button is gone): the keyboard lands on Cancel, never on Confirm.
      const cancel = results.querySelector('.sess-confirm .btn:last-child');
      if (cancel && !dlg.contains(document.activeElement)) cancel.focus();
    };
    // The second step for a session in this browser. Saved to the forum and
    // connected: deleted there too, unless "Only from this browser".
    const askLocal = (x, cur) => {
      const pb = S.playbook, shared = !!x.playbookAt, reach = shared && pb && pb.state.status === 'ready' && S.shared.has();
      const name = x.name || 'this station', busy = ask.phase === 'busy';
      const local = deleted => { if (pb) pb.dropQueued(x.id, deleted); dropLocal(x.id); ask = null; draw(); toast(deleted ? `Deleted the session for ${name}.` : `Deleted the session for ${name} from this browser — the forum’s copy stays.`); };
      const everywhere = async () => {
        ask.phase = 'busy'; draw();
        const s = cur ? A.session : S.store.load(x.id);
        const key = (s && s.playbook && s.playbook.key) || (s && pb.stationKey(s.station));
        try {
          if (key) await pb.deleteShared(A, key, [x.id]); else dropLocal(x.id);
          ask = null; toast(`Deleted the session for ${name} — from this browser and from the forum.`);
        } catch (e) { if (ask) Object.assign(ask, { phase: 'error', error: e.message }); }
        draw();
      };
      const text = !shared ? `Delete the session for ${name}? It is only in this browser, so it will be gone for good.`
        : reach ? `Delete the session for ${name} for good — from this browser and from the forum’s saved sessions? Nobody will be able to open it again. (Only from this browser keeps the forum’s copy.)`
        : `Delete the session for ${name} from this browser? The forum’s saved copy stays — it can be deleted there once this computer is connected to the saved sessions.`;
      return h('div', { class: 'sess-confirm', role: 'group', 'aria-label': `Delete the session for ${name}` },
        h('p', null, text, busy ? ' Deleting…' : ask.phase === 'error' ? ` Couldn’t delete it from the forum (${ask.error}) — nothing was deleted.` : ''),
        h('div', { class: 'sess-acts' },
          h('button', { type: 'button', class: 'btn btn-danger', disabled: busy, onclick: () => (reach ? everywhere() : local(!shared)) }, 'Confirm delete'),
          reach ? h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => local(false) }, 'Only from this browser') : null,
          h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => { ask = null; draw(); } }, 'Cancel')));
    };
    search.addEventListener('input', draw);
    draw();
    A.sessionsDraw = () => { if (dlg.open) draw(); };
    if (S.playbook) S.playbook.onSessionsOpen();
    if (!dlg.open) dlg.showModal();
    search.focus(); search.select();
  }
  // The station already has sessions (here or in the playbook): say so at the top of its card.
  function renderDupNote() {
    const el = $('#dupNote'); if (!el) return;
    el.innerHTML = '';
    const s = A.session, st = s.station;
    const x = S.playbook && st ? S.playbook.existing(A) : null;
    if (!x || s.dupAck || (s.continuesFrom && S.playbook.stationKey(st) === s.continuesFrom.key)) { el.hidden = true; return; }
    const outcomes = Object.fromEntries(((A.defs.session || {}).outcomes || []).map(o => [o.code, o.label]));
    const parts = [];
    if (x.local.length) parts.push(`${x.local.length} in this browser`);
    if (x.shared) parts.push(`${x.shared} saved to the forum`);
    const last = x.entry && x.entry.lastForum ? ` — the last at the forum of ${U.dmy(x.entry.lastForum)}, ${x.entry.lastOutcome ? (outcomes[x.entry.lastOutcome] || x.entry.lastOutcome).toLowerCase() : 'not finished'}` : '';
    el.hidden = false;
    el.appendChild(h('div', null, h('b', null, `⚠ ${st.name} already has ${x.local.length + x.shared === 1 ? 'a session' : 'sessions'}`), ` (${parts.join(', ')})${last}. Open one to carry on with it, or keep going with this new one.`));
    el.appendChild(h('div', { class: 'st-dup-acts' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openSessions(st.number || st.name) }, 'Show its sessions'),
      h('button', { type: 'button', class: 'link', onclick: () => { s.dupAck = true; changed({ light: true }); renderDupNote(); } }, 'Keep this new one')));
  }

  /* ---------------- layout: map above, or beside, the questions ---------------- */
  const LS_LAYOUT = 'sortv2.layout';
  function setLayout(side) {
    document.body.classList.toggle('layout-side', side);
    U.LS.set(LS_LAYOUT, side ? 'side' : 'top');
    const b = $('#layoutBtn');
    if (b) { b.textContent = side ? '⇅ Map above the questions' : '⇆ Map beside the questions'; b.setAttribute('aria-pressed', String(side)); }
    measureTop();
  }
  function measureTop() { const t = $('.top'); if (t) document.documentElement.style.setProperty('--top-h', `${t.offsetHeight}px`); }
  function initLayout() {
    const b = $('#layoutBtn');
    if (b) b.addEventListener('click', () => setLayout(!document.body.classList.contains('layout-side')));
    G.addEventListener('resize', measureTop);
    // Beside the questions unless this browser chose otherwise.
    const saved = U.LS.get(LS_LAYOUT);
    setLayout(saved ? saved === 'side' : true);
  }

  /* ---------------- jump buttons: to the top, and to the question you are up to ---------------- */
  // The questions scroll inside the left pane when the map sits beside them, else the whole page scrolls.
  function scroller() {
    const w = $('.wrap');
    return w && /auto|scroll/.test(G.getComputedStyle(w).overflowY) ? w : null;
  }
  // Where you are up to: the first question still to answer after the last one you answered
  // (the first unanswered one if nothing is left after it, or if you have answered none yet).
  function currentQuestion() {
    const qs = U.$$('#form .q');
    let last = -1;
    qs.forEach((q, i) => { if (q.classList.contains('filled')) last = i; });
    return qs.slice(last + 1).find(q => !q.classList.contains('filled')) || qs.find(q => !q.classList.contains('filled')) || null;
  }
  function updateJump() {
    const box = $('#jumpBtns'); if (!box) return;
    const sc = scroller();
    const y = sc ? sc.scrollTop : (G.scrollY || 0);
    const top = $('#jumpTop'), next = $('#jumpNext');
    top.hidden = y < 400;
    next.hidden = !currentQuestion();
    box.hidden = top.hidden && next.hidden;
  }
  function initJump() {
    const top = $('#jumpTop'), next = $('#jumpNext'); if (!top || !next) return;
    top.addEventListener('click', () => { (scroller() || G).scrollTo({ top: 0, behavior: 'smooth' }); });
    next.addEventListener('click', () => {
      const q = currentQuestion(); if (!q) return;
      q.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Things above it can still be loading and push it about: look again a few times and put it back in view.
      [500, 1300, 2600].forEach(ms => setTimeout(() => {
        const r = q.getBoundingClientRect(), sc = scroller(), box = sc ? sc.getBoundingClientRect() : { top: 0, bottom: G.innerHeight };
        if (q.isConnected && (r.top < box.top || r.bottom > box.bottom)) q.scrollIntoView({ behavior: 'auto', block: 'center' });
      }, ms));
      q.classList.add('jump-flash'); setTimeout(() => q.classList.remove('jump-flash'), 1600);
    });
    let pending = false;
    const later = () => { if (pending) return; pending = true; G.requestAnimationFrame(() => { pending = false; updateJump(); }); };
    G.addEventListener('scroll', later, { passive: true });
    const wrap = $('.wrap'); if (wrap) wrap.addEventListener('scroll', later, { passive: true });
    G.addEventListener('resize', later);
    new MutationObserver(later).observe($('#form'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    updateJump();
  }

  /* ---------------- theme ---------------- */
  function initTheme() {
    const btn = $('#themeBtn');
    const apply = dark => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); btn.textContent = dark ? '☀️' : '🌙'; btn.title = dark ? 'Light mode' : 'Dark mode'; };
    apply(document.documentElement.getAttribute('data-theme') === 'dark');
    btn.addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
      apply(dark); U.LS.set(LS_THEME, dark ? 'dark' : 'light');
      if (S.mapView) S.mapView.theme && S.mapView.theme(dark);
    });
  }

  /* ---------------- boot ---------------- */
  function renderAll() {
    renderForum(); renderStation();
    S.form.render($('#form')); S.form.renderPS($('#ps'));
    renderOutputControls(); renderFollowUps(); renderProgress(); renderSavedChip();
    renderPreview();
    if (S.playbook) { S.playbook.renderActs(A); S.playbook.renderSaveBar(A); }
    renderDupNote();
    if (S.mapView) { S.mapView.station(A); S.mapView.sync(A); }
    Object.values(S.suggesters || {}).forEach(m => m.sync(A));   // the corrosion and soil suggestions
  }
  async function boot() {
    initTheme(); initLayout();
    if (S.help) S.help.init(A);   // first, so Help works even if the questions don't load
    S.form.bind(A);
    try { await loadDefs(); }
    catch (e) { $('#bootMsg').textContent = e.message; $('#bootMsg').classList.add('error'); return; }
    $('#bootMsg').remove();
    renderDefsChip();
    S.store.pruneBlank();
    A.session = S.store.current() || S.store.newSession(A.defs); arrive();
    if (!S.schema.template(A.defs, A.session.template)) A.session.template = A.defs.templates[0].id;
    rebuild();
    U.$$('.copy-btn').forEach(b => b.addEventListener('click', copyForWord));
    $('#sessionsBtn').addEventListener('click', () => openSessions());
    $('#newSessionBtn').addEventListener('click', () => { $('#sessionsDlg').close(); newSession(); toast('New session started.'); });
    $('#downloadBtn').addEventListener('click', downloadSession);
    $('#importInput').addEventListener('change', ev => { if (ev.target.files[0]) importSession(ev.target.files[0]); ev.target.value = ''; });
    $('#sessionsClose').addEventListener('click', () => $('#sessionsDlg').close());
    G.addEventListener('beforeunload', () => { saveSoon.flush(); if (A.session && A.edited) keepLocal(); });
    // Leaving the tab (or closing it): keep it here, and share it now rather than in a moment.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveSoon.flush(); if (S.playbook) S.playbook.flush(A); } });
    if (S.mapView) S.mapView.mount($('#mapMount'), A);
    watchPreview();
    initJump();
    if (S.playbook) S.playbook.init(A);
    if (S.bureauBM) S.bureauBM.init(A);
    renderAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
