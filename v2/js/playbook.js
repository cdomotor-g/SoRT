/* SoRT v2 — playbook.js
   The playbook: how earlier SoRT forums dealt with each station, kept in the
   private GitHub repo cdomotor-g/SoRT-playbook so a station that comes back,
   or one like it, starts from what was decided before.

   The repo holds:
     index.json               one line per station — enough to search and rank
     stations/<key>.json      that station's sessions, newest last
   where <key> is the Bureau number (else Flood-Net's id, else "manual-<name>").
   A session is stored twice over: `summary` (every answer as codes + labels,
   Property Services, follow-ups, map — flat, for precedents and a later
   Dataverse import) and `session` (the browser session itself, for Continue).
   Sessions imported from Word reports carry only the summary.

   It keeps no landholder names or contact details and no gate, padlock or key
   codes: Save checks the typed text for anything that looks like one first. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules, sch = () => S.schema;
  const h = (...a) => U().h(...a);
  const REPO = { owner: 'cdomotor-g', repo: 'SoRT-playbook', branch: 'main' };
  const LS_INDEX = 'sortv2.pb.index';
  const P = { A: null, index: null, status: 'off', error: '', files: new Map(), busy: false };

  /* ---------------- keys + loading ---------------- */
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function stationKey(st) {
    if (!st) return null;
    const n = String(st.number || '').replace(/\D/g, '');
    if (n) return n;
    if (st.id) return slug(st.id);
    return st.name ? `manual-${slug(st.name)}` : null;
  }
  async function loadIndex() {
    if (!S.github.auth()) { P.status = 'off'; P.index = U().LS.json(LS_INDEX, null); return; }
    P.status = 'loading'; refresh();
    try {
      const f = await S.github.getFile(REPO, 'index.json');
      if (!f) {
        // Either the repo is empty (fine: the first save creates the index) or it isn't there at all.
        try { await S.github.api(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`); P.index = []; P.status = 'ready'; }
        catch (e) { P.status = e.status === 404 ? 'missing' : 'error'; P.error = e.message; }
      } else { P.index = JSON.parse(f.text).stations || []; P.indexSha = f.sha; P.status = 'ready'; U().LS.set(LS_INDEX, JSON.stringify(P.index)); }
    } catch (e) { P.status = e.status === 401 ? 'denied' : 'error'; P.error = e.message; P.index = U().LS.json(LS_INDEX, null); }
    refresh();
  }
  async function loadStation(key, fresh) {
    if (!fresh && P.files.has(key)) return P.files.get(key);
    const f = await S.github.getFile(REPO, `stations/${key}.json`);
    const v = f ? { data: JSON.parse(f.text), sha: f.sha } : null;
    if (v) P.files.set(key, v);
    return v;
  }

  /* ---------------- what a session says, flat ---------------- */
  function summary(defs, session) {
    const ctx = R().context(defs, session);
    const answers = {};
    R().visibleQuestions(ctx).forEach(q => {
      const e = R().eff(ctx, q.code);
      const vals = e.value == null ? [] : [].concat(e.value);
      const fields = {};
      (q.fields || []).forEach(f => { if (R().fieldVisible(ctx, f)) { const t = R().fieldText(f, e.fields[f.code]); if (t) fields[f.code] = t; } });
      if (!vals.length && !Object.keys(fields).length && !e.note.trim()) return;
      answers[q.code] = { value: q.type === 'multi' ? vals : (vals[0] || null), labels: vals.map(v => sch().optionLabel(q, v)), other: e.other || '', fields, note: e.note.trim(), src: e.src || null };
    });
    const ps = {};
    ((defs.propertyServices || {}).rows || []).forEach(row => {
      if (row.kind === 'question') { const v = R().psQuestionValue(ctx, row.id); if (v) ps[row.id] = v; const d = R().psDetail(ctx, row); if (d) ps[`${row.id}.detail`] = d; }
      else if (row.kind === 'coordGroup') (row.coords || []).forEach(c => { const t = R().psText(ctx, `${row.id}.${c.key}`, c.source, c.default); if (t) ps[`${row.id}.${c.key}`] = t; });
      else if (row.kind === 'text') { const t = R().psText(ctx, row.id, row.source, ''); if (t) ps[row.id] = t; }
    });
    const p = R().psState(session);
    return { answers, ps, psComments: Object.assign({}, p.comments), psGeneral: p.general || '',
      followUps: R().followUps(ctx).map(f => ({ id: f.id, owner: f.owner, text: f.text, done: f.done })),
      tasks: S.tasks ? S.tasks.summary(session) : [],
      map: { checked: (session.station || {}).checked || null, features: session.map.features || [], marks: session.map.marks || [], bridges: session.map.bridges || [] } };
  }
  function record(defs, session) {
    const a = S.github.auth() || {};
    const s = U().clone(session);
    delete s.prefill.__ps; delete s.playbook;
    return { id: session.id, source: 'sort-v2', savedAt: new Date().toISOString(), savedBy: a.login || '', forum: session.forum,
      outcome: session.outcome || null, outcomeNote: session.outcomeNote || '', template: session.template, definitionsVersion: defs.version,
      continuesFrom: session.continuesFrom || null, summary: summary(defs, session), session: s };
  }
  function indexEntry(file) {
    const st = file.station || {}, ss = file.sessions || [];
    const last = ss[ss.length - 1] || {}, sum = last.summary || { answers: {} }, A = sum.answers || {};
    const v = c => A[c] ? A[c].value : null;
    return { key: file.key, number: st.number || '', name: st.name || '', floodnetId: st.floodnetId || '', lat: st.lat, lon: st.lon,
      lga: st.lga || '', hub: st.hub || '', kinds: st.kinds || [], template: last.template || '', sessions: ss.length,
      lastForum: (last.forum || {}).date || '', lastOutcome: last.outcome || null,
      complexity: [].concat(v('complexity') || []), comms: v('comms'), commsChange: v('commsChange'), relocation: v('relocation'),
      remediation: [].concat(v('remediation') || []), tags: file.tags || [],
      openFollowUps: (sum.followUps || []).filter(f => !f.done).map(f => ({ id: f.id, owner: f.owner, text: f.text })),
      updatedAt: new Date().toISOString() };
  }

  /* ---------------- privacy check before anything leaves the browser ---------------- */
  const CHECKS = [
    { what: 'an email address', re: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g },
    { what: 'a phone number', re: /(?:\+?61[\s-]?|\b0)[2-478](?:[\s-]?\d){8}\b/g },
    { what: 'a gate, padlock or key code', re: /\b(?:gate|padlock|lock|key|combo|combination|access)\s*(?:code|no\.?|number|#)?\s*(?:is|=|:)?\s*\d{3,8}\b/gi }
  ];
  function privacyScan(session) {
    const texts = [];
    Object.entries(session.answers || {}).forEach(([c, a]) => {
      if (a.other) texts.push([c, a.other]);
      if (a.note) texts.push([c, a.note]);
      Object.entries(a.fields || {}).forEach(([f, v]) => texts.push([`${c}.${f}`, v]));
    });
    const p = session.ps || {};
    Object.entries(p.comments || {}).forEach(([k, v]) => texts.push([`Property Services ${k}`, v]));
    Object.entries(p.answers || {}).forEach(([k, v]) => texts.push([`Property Services ${k}`, v]));
    if (p.general) texts.push(['Property Services comments', p.general]);
    if (session.outcomeNote) texts.push(['Outcome note', session.outcomeNote]);
    const found = [];
    texts.forEach(([where, t]) => CHECKS.forEach(c => { const m = String(t || '').match(c.re); if (m) m.forEach(x => found.push(`${c.what} in ${where}: “${x}”`)); }));
    return found;
  }

  /* ---------------- save ---------------- */
  async function putJson(path, obj, msg, sha) { return S.github.putFile(REPO, path, JSON.stringify(obj, null, 2) + '\n', msg, sha); }
  async function save(A, session, quiet, auto) {
    session = session || A.session;
    if (auto && (!S.github.auth() || P.status !== 'ready' || P.busy)) return false;
    if (!S.github.auth()) { S.github.connectDialog({ why: 'Saving to the playbook needs a GitHub token that can reach the private SoRT-playbook repo.', onDone: login => { if (login) { loadIndex().then(() => save(A, session)); } } }); return false; }
    const st = session.station, key = stationKey(st);
    if (!key) { A.toast('Choose (or enter) the station first — the playbook files sessions by station.'); return false; }
    const found = privacyScan(session);
    // Saving by itself never asks: what looks private holds it until a person decides.
    if (auto) { if (found.length) { P.held = { id: session.id, found }; refresh(); return false; } }
    else if (found.length && !G.confirm(`This session’s text looks like it holds:\n\n• ${found.slice(0, 6).join('\n• ')}\n\nThe playbook keeps no landholder contact details and no gate, padlock or key codes. Cancel to remove it first, or OK if it is fine to keep.`)) return false;
    P.busy = true; refresh();
    try {
      const rec = record(A.defs, session);
      const msg = `Session: ${st.name}${st.number ? ' (' + st.number + ')' : ''} — forum ${U().dmy(session.forum.date)}${session.outcome ? ' — ' + session.outcome.replace(/_/g, ' ') : ''}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const cur = await loadStation(key, true);
        const file = cur ? cur.data : { schema: 'sort-playbook-station/1', key, sessions: [], tags: [] };
        file.station = { number: st.number || '', name: st.name || '', floodnetId: st.source === 'floodnet' ? st.id : '', lat: st.lat, lon: st.lon,
          kinds: st.kinds || [], lga: st.lga || '', hub: st.hubName || '', owner: st.owner || '' };
        const i = file.sessions.findIndex(x => x.id === rec.id);
        if (i >= 0) file.sessions[i] = rec; else file.sessions.push(rec);
        file.sessions.sort((a, b) => String((a.forum || {}).date).localeCompare(String((b.forum || {}).date)));
        try {
          const r = await putJson(`stations/${key}.json`, file, msg, cur && cur.sha);
          P.files.set(key, { data: file, sha: r.sha });
          await upsertIndex(file, msg);
          session.playbook = { savedAt: Date.now(), key, sha: r.sha };
          if (P.held && P.held.id === session.id) P.held = null;
          S.store.save(session);
          if (!quiet) A.toast(`Saved to the playbook (${st.name}).`);
          return true;
        } catch (e) { if (!(e.status === 409 || e.status === 422) || attempt) throw e; }   // someone saved in between: re-read, retry once
      }
    } catch (e) {
      A.toast(e.status === 404 ? 'The private SoRT-playbook repo isn’t there yet, or this token can’t reach it — the session is still saved in this browser.' : `Couldn’t save to the playbook: ${e.message}`);
      return false;
    } finally { P.busy = false; refresh(); }
    return false;
  }
  async function upsertIndex(file, msg) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await S.github.getFile(REPO, 'index.json');
      const idx = cur ? JSON.parse(cur.text) : { schema: 'sort-playbook-index/1', stations: [] };
      const e = indexEntry(file);
      const i = idx.stations.findIndex(x => x.key === e.key);
      if (i >= 0) idx.stations[i] = e; else idx.stations.push(e);
      idx.stations.sort((a, b) => a.name.localeCompare(b.name));
      idx.updated = new Date().toISOString();
      try { await putJson('index.json', idx, msg, cur && cur.sha); P.index = idx.stations; U().LS.set(LS_INDEX, JSON.stringify(P.index)); return; }
      catch (err) { if (!(err.status === 409 || err.status === 422) || attempt) throw err; }
    }
  }
  async function saveAllUnsaved(A) {
    const todo = S.store.index().filter(x => !x.playbookAt && x.name);
    if (!todo.length) { A.toast('Every session with a station is already in the playbook.'); return; }
    let n = 0;
    for (const x of todo) { const s = S.store.load(x.id); if (s && await save(A, s, true)) n++; }
    A.toast(`${n} of ${todo.length} session${todo.length > 1 ? 's' : ''} saved to the playbook.`);
  }

  /* ---------------- precedents ---------------- */
  function similar(A) {
    const st = A.session.station, key = stationKey(st);
    if (!P.index || !st) return [];
    const sum = summary(A.defs, A.session).answers;
    const v = c => sum[c] ? [].concat(sum[c].value || []) : [];
    const mine = { complexity: v('complexity'), comms: v('comms')[0], change: v('commsChange')[0], remediation: v('remediation') };
    return P.index.filter(e => e.key !== key).map(e => {
      let score = 0; const why = [];
      if (e.template && e.template === A.session.template) { score += 3; why.push('same table'); }
      const shared = (e.complexity || []).filter(c => mine.complexity.includes(c));
      if (shared.length) { score += 2 * shared.length; why.push('same complexity'); }
      if (mine.change && e.commsChange === mine.change && mine.change !== 'none') { score += 2; why.push('same comms change'); }
      else if (mine.comms && e.comms === mine.comms) { score += 1; why.push('same comms'); }
      if ((e.remediation || []).some(r => mine.remediation.includes(r))) { score += 1; why.push('same extra works'); }
      if ((st.kinds || []).length && (e.kinds || []).join() === (st.kinds || []).join()) score += 1;
      if (e.lga && e.lga === st.lga) { score += 1; why.push('same council'); }
      if (st.lat != null && e.lat != null) {
        const km = U().haversineM(st, e) / 1000;
        if (km < 25) score += 1.5; else if (km < 100) score += 0.5;
        why.push(`${km < 10 ? km.toFixed(1) : Math.round(km)} km away`);
      }
      return { e, score, why };
    }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  // Fill answers from a stored session as suggestions (src: precedent/earlier).
  function prefillFrom(A, rec, src, from) {
    const ctx = R().context(A.defs, A.session);
    const answers = (rec.summary || {}).answers || {};
    let n = 0;
    ctx.qs.forEach(q => {
      const a = answers[q.code];
      if (!a || q.precedent === false && src === 'precedent') return;
      const mine = A.session.answers[q.code];
      if (mine && (!R().emptyVal(mine.value) || Object.values(mine.fields || {}).some(x => String(x || '').trim()))) return;
      const fields = {};
      (q.fields || []).forEach(f => {
        if (src === 'precedent' && (f.type === 'coord' || f.precedent === false)) return;
        if (a.fields && a.fields[f.code] != null) fields[f.code] = String(a.fields[f.code]).replace(new RegExp(`\\s*${f.unit || '@@'}$`), '');
      });
      // Only answers the question still offers (an option retired since isn't carried).
      let value = q.type === 'none' ? null : a.value;
      if (q.type !== 'none') {
        const ok = new Set(sch().flatOptions(q.options).map(o => o.code));
        const vs = [].concat(value == null ? [] : value).filter(v => ok.has(v));
        value = q.type === 'multi' ? (vs.length ? vs : null) : (vs[0] || null);
      }
      if (R().emptyVal(value) && !Object.keys(fields).length) return;
      A.session.prefill[q.code] = { src, from, value, other: a.other || '', fields, note: src === 'earlier' ? (a.note || '') : '' };
      n++;
    });
    return n;
  }
  async function usePrecedent(A, key) {
    try {
      const f = await loadStation(key);
      if (!f) { A.toast('That station’s file isn’t in the playbook.'); return; }
      const rec = (f.data.sessions || []).filter(s => s.summary && Object.keys(s.summary.answers || {}).length).slice(-1)[0];
      if (!rec) { A.toast('No answers recorded for that station yet.'); return; }
      const before = U().clone(A.session.prefill);
      const name = f.data.station.name;
      const n = prefillFrom(A, rec, 'precedent', `${name} (${U().dmy((rec.forum || {}).date)})`);
      A.changed();
      A.toast(`${n} answer${n === 1 ? '' : 's'} filled from ${name} — marked Precedent until you confirm them.`, { label: 'Undo', run: () => { A.session.prefill = before; A.changed(); } });
    } catch (e) { A.toast(`Couldn’t read the playbook: ${e.message}`); }
  }
  // Start today's session for a station from the last one the playbook holds.
  async function continueFrom(A, key) {
    try {
      const f = await loadStation(key, true);
      if (!f) return;
      const rec = (f.data.sessions || []).slice(-1)[0];
      if (!rec) return;
      const sameStation = stationKey(A.session.station) === key;
      const station = sameStation ? A.session.station : Object.assign({ source: f.data.station.floodnetId ? 'floodnet' : 'manual', id: f.data.station.floodnetId }, f.data.station);
      A.newSession(station);
      const s = A.session, old = rec.session;
      s.template = rec.template || s.template;
      s.continuesFrom = { key, sessionId: rec.id, date: (rec.forum || {}).date || '' };
      if (old) {
        s.ps = U().clone(old.ps || s.ps);
        s.map.features = U().clone((old.map || {}).features || []);
        s.map.hiddenMarks = U().clone((old.map || {}).hiddenMarks || []);
        s.followUpState = U().clone(old.followUpState || {});
        if (old.station && old.station.checked && s.station) s.station.checked = old.station.checked;
      } else {
        // An imported report: carry its Property Services answers (not its
        // coordinates — those follow the scope answers, as always).
        const kinds = Object.fromEntries((((A.defs.propertyServices || {}).rows) || []).map(r => [r.id, r.kind]));
        Object.entries(((rec.summary || {}).ps) || {}).forEach(([k, v]) => {
          if (['question', 'text'].includes(kinds[k]) && v !== '') { s.ps.answers[k] = v; s.ps.dirty[k] = true; }
        });
        if ((rec.summary || {}).psGeneral) s.ps.general = rec.summary.psGeneral;
      }
      const n = prefillFrom(A, rec, 'earlier', `the session of ${U().dmy((rec.forum || {}).date)}`);
      S.floodnet.applyPrefill(A.defs, s);
      A.changed();
      if (S.mapView) S.mapView.station(A);
      A.toast(`Continuing from ${U().dmy((rec.forum || {}).date)}: ${n} answers carried over, marked Earlier session until you confirm them.`);
      if (s.station && s.station.source === 'floodnet' && !sameStation) A.refreshStation();
    } catch (e) { A.toast(`Couldn’t read the playbook: ${e.message}`); }
  }

  /* ---------------- on the page ---------------- */
  let stripHost = null;
  function stationStrip(A) {
    P.A = A;
    stripHost = h('div', { class: 'pb-strip', id: 'pbStrip' });
    fillStrip();
    return stripHost;
  }
  const OUTCOME = A => Object.fromEntries((((A.defs || {}).session || {}).outcomes || []).map(o => [o.code, o.label]));
  function fillStrip() {
    const el = stripHost, A = P.A; if (!el || !A) return;
    el.innerHTML = '';
    const head = h('span', { class: 'fld-label' }, 'Playbook');
    if (P.status === 'off') { el.appendChild(h('div', null, head, ' — ', h('button', { type: 'button', class: 'link', onclick: () => S.github.connectDialog({ onDone: () => loadIndex() }) }, 'Connect GitHub'), ' to see this station’s earlier sessions and similar precedents.')); return; }
    if (P.status === 'loading') { el.appendChild(h('div', null, head, ' — loading…')); return; }
    if (P.status === 'missing') { el.appendChild(h('div', null, head, ' — the private SoRT-playbook repo isn’t there yet (or this GitHub token can’t see it). Sessions are kept in this browser until it is.')); return; }
    if (P.status !== 'ready') { el.appendChild(h('div', null, head, ` — couldn’t be read (${P.error}). `, h('button', { type: 'button', class: 'link', onclick: () => loadIndex() }, 'Try again'))); return; }
    const key = stationKey(A.session.station);
    const mine = (P.index || []).find(e => e.key === key);
    const o = OUTCOME(A);
    if (mine && !(A.session.continuesFrom && A.session.continuesFrom.key === key)) {
      el.appendChild(h('div', null, head, ` — ${mine.sessions} earlier session${mine.sessions > 1 ? 's' : ''}, the last at the forum of ${U().dmy(mine.lastForum)}${mine.lastOutcome ? ' (' + (o[mine.lastOutcome] || mine.lastOutcome) + ')' : ''}. `,
        h('button', { type: 'button', class: 'btn-mini', onclick: () => continueFrom(A, key) }, 'Continue from it')));
    } else if (mine) el.appendChild(h('div', null, head, ` — continuing from the session of ${U().dmy(A.session.continuesFrom.date)}.`));
    else el.appendChild(h('div', null, head, ' — no earlier session for this station.'));
    const sim = similar(A);
    if (sim.length) {
      el.appendChild(h('div', { class: 'hint' }, 'Similar stations — use one to fill the answers it shares (marked Precedent until confirmed):'));
      sim.forEach(x => el.appendChild(h('div', { class: 'pb-sim' },
        h('b', null, x.e.name), x.e.number ? h('span', { class: 'res-num' }, x.e.number) : null,
        h('span', { class: 'hint' }, ` ${x.why.join(' · ')}${x.e.lastOutcome ? ' · ' + (o[x.e.lastOutcome] || x.e.lastOutcome) : ''}`), ' ',
        h('button', { type: 'button', class: 'btn-mini', onclick: () => usePrecedent(A, x.e.key) }, 'Use'))));
    }
  }
  function renderActs(A) {
    P.A = A;
    const el = document.getElementById('playbookActs'); if (!el) return;
    el.innerHTML = '';
    const s = A.session, at = s.playbook && s.playbook.savedAt;
    const stale = at && s.updatedAt > at + 2000;
    el.appendChild(h('button', { type: 'button', class: 'btn', disabled: P.busy, title: 'Keep this session in the private playbook, under its station', onclick: () => save(A) }, P.busy ? 'Saving…' : (at ? 'Save to playbook again' : 'Save to playbook')));
    el.appendChild(h('span', { class: 'hint' }, at ? ` In the playbook since ${U().fmtClock(at)}${stale ? ' — changed since' : ''}.` : ' Not in the playbook yet.'));
  }
  /* ---------------- saving by itself, to the shared playbook ---------------- */
  // A few seconds after the last change (and before another session opens),
  // the open session goes to the playbook — once it has a station, while
  // GitHub is connected and the playbook can be read.
  const AUTOSAVE_MS = () => (typeof G.SORT_AUTOSAVE_MS === 'number' ? G.SORT_AUTOSAVE_MS : 12000);
  let autoTimer = null, autoFor = null;
  // Something worth keeping: a station, and at least one answer (looking a station up files nothing).
  const answered = s => Object.values(s.answers || {}).some(a => a && (!R().emptyVal(a.value) || Object.values(a.fields || {}).some(v => String(v || '').trim())))
    || Object.values((s.ps || {}).answers || {}).some(v => String(v || '').trim()) || !!s.outcome;
  const needsSave = s => !!(s && s.station && stationKey(s.station) && answered(s) && (!s.playbook || !s.playbook.savedAt || s.updatedAt > s.playbook.savedAt + 1000));
  function autosaveSoon(A) {
    if (P.status !== 'ready' || !S.github.auth() || !A.session || !stationKey(A.session.station)) return;
    clearTimeout(autoTimer); autoFor = A.session;
    autoTimer = setTimeout(() => { const s = autoFor; autoTimer = null; autoFor = null; if (needsSave(s)) save(A, s, true, true); }, AUTOSAVE_MS());
  }
  function flush(A) {   // before switching away from a session
    if (!autoTimer) return;
    clearTimeout(autoTimer); autoTimer = null;
    const s = autoFor; autoFor = null;
    if (needsSave(s)) save(A, s, true, true);
  }

  // Open a session exactly as it was last saved to the playbook (another
  // computer's, or this one's from before) — the newer of it and this browser's copy.
  async function openSaved(A, key) {
    try {
      const f = await loadStation(key, true);
      const rec = f && (f.data.sessions || []).filter(x => x.session).slice(-1)[0];
      if (!rec) { continueFrom(A, key); return; }
      const mine = S.store.load(rec.id);
      const theirs = U().clone(rec.session);
      theirs.playbook = { savedAt: Date.parse(rec.savedAt) || Date.now(), key, sha: f.sha };
      if (!mine || (theirs.updatedAt || 0) >= (mine.updatedAt || 0)) { theirs.playbook.savedAt = Math.max(theirs.playbook.savedAt, theirs.updatedAt || 0); S.store.save(theirs, true); }
      A.openSession(rec.id);
    } catch (e) { A.toast(`Couldn’t read the playbook: ${e.message}`); }
  }

  /* ---------------- where this session is kept: the warning bar ---------------- */
  function renderSaveBar(A) {
    const el = document.getElementById('saveBar'); if (!el || !A || !A.session) return;
    el.innerHTML = '';
    const dl = () => { const b = document.getElementById('downloadBtn'); if (b) b.click(); };
    const bar = (cls, ...kids) => { el.className = 'save-bar ' + cls; el.hidden = false; kids.forEach(k => k && el.appendChild(k)); };
    const link = (label, run, title) => h('button', { type: 'button', class: 'link', onclick: run, title: title || null }, label);
    if (P.held && P.held.id === A.session.id) {
      bar('warn', h('span', null, h('b', null, 'Not saved to the shared playbook: '), `it looks like it holds ${P.held.found[0]}${P.held.found.length > 1 ? ` (and ${P.held.found.length - 1} more)` : ''}. The playbook keeps no landholder contact details and no gate, padlock or key codes — remove it, or `),
        link('save it anyway', () => save(A)), document.createTextNode('.'));
      return;
    }
    if (P.status === 'ready') { el.hidden = true; return; }
    if (P.status === 'loading') { bar('info', h('span', null, 'Connecting to the shared playbook…')); return; }
    const why = P.status === 'off' ? null : P.status === 'missing' ? 'the shared playbook can’t be reached with this computer’s GitHub token' : `the shared playbook can’t be read just now (${P.error})`;
    bar('warn', h('span', null, h('b', null, '⚠ Saved only in this browser'), why ? ` — ${why}. ` : '. ',
      'Nobody else can open this session, and clearing the browser loses it. '),
      P.status === 'off' ? link('Connect to the shared playbook', () => S.github.connectDialog({ why: 'The shared playbook keeps every session where everyone can open it. Connect once per computer.', onDone: () => loadIndex() }))
        : link('Try again', () => loadIndex()),
      document.createTextNode(' · '), link('Download a copy', dl, 'Save this session as a file'));
  }

  /* ---------------- the Sessions dialog: the shared playbook ---------------- */
  const matches = (q, ...xs) => !q || xs.some(x => String(x || '').toLowerCase().includes(q));
  function panel(A, query, close) {
    const q = String(query || '').trim().toLowerCase();
    const box = h('div', { class: 'pb-panel' }, h('h3', null, 'In the shared playbook'));
    if (P.status === 'off') { box.appendChild(h('p', { class: 'hint' }, 'Not connected — the sessions above are only in this browser. ', h('button', { type: 'button', class: 'link', onclick: () => S.github.connectDialog({ onDone: () => loadIndex() }) }, 'Connect to the shared playbook'))); return box; }
    if (P.status !== 'ready') { box.appendChild(h('p', { class: 'hint' }, P.status === 'loading' ? 'Loading…' : `The shared playbook can’t be read just now${P.error ? ` (${P.error})` : ''}. `, P.status === 'loading' ? null : h('button', { type: 'button', class: 'link', onclick: () => loadIndex() }, 'Try again'))); return box; }
    const o = OUTCOME(A), curKey = stationKey(A.session.station);
    const all = (P.index || []).slice().sort((a, b) => String(b.lastForum).localeCompare(String(a.lastForum)));
    const rows = all.filter(e => matches(q, e.name, e.number, e.lga, e.hub));
    if (!rows.length) { box.appendChild(h('p', { class: 'hint' }, q ? 'No station in the playbook matches.' : 'Nothing in the playbook yet.')); }
    (q ? rows : rows.slice(0, 12)).forEach(e => {
      const other = curKey && e.key !== curKey;
      box.appendChild(h('div', { class: 'sess' },
        h('div', { class: 'sess-main' },
          h('div', { class: 'sess-name' }, e.name, e.number ? h('span', { class: 'res-num' }, e.number) : null),
          h('div', { class: 'res-meta' }, [`${e.sessions} session${e.sessions === 1 ? '' : 's'}`, e.lastForum && `last at the forum of ${U().dmy(e.lastForum)}`,
            e.lastOutcome ? (o[e.lastOutcome] || e.lastOutcome) : 'not finished', e.lga].filter(Boolean).join(' · '))),
        h('div', { class: 'sess-acts' },
          h('button', { type: 'button', class: 'btn', title: 'Open its last session as it was saved, and carry on with it', onclick: () => { close(); openSaved(A, e.key); } }, 'Open'),
          h('button', { type: 'button', class: 'btn btn-quiet', title: 'A new session for today’s forum, starting from its last answers (each to check)', onclick: () => { close(); continueFrom(A, e.key); } }, 'Start from it'),
          other ? h('button', { type: 'button', class: 'btn btn-quiet', title: `Fill ${A.session.station ? A.session.station.name : 'this session'}’s unanswered questions from this station’s last session — each one orange until you check it`, onclick: () => { close(); usePrecedent(A, e.key); } }, 'Use as a precedent') : null)));
    });
    if (!q && rows.length > 12) box.appendChild(h('p', { class: 'hint' }, `${rows.length - 12} more — search to find them.`));
    const unsaved = S.store.index().filter(x => !x.playbookAt && x.name).length;
    if (unsaved) box.appendChild(h('div', { class: 'out-acts' }, h('button', { type: 'button', class: 'btn', onclick: () => saveAllUnsaved(A) }, `Save the ${unsaved} session${unsaved > 1 ? 's' : ''} only in this browser to the playbook`)));
    return box;
  }
  // The station's other sessions — in this browser and in the playbook — for the card's warning.
  function existing(A) {
    const s = A.session, st = s.station, key = stationKey(st);
    if (!key) return null;
    const local = S.store.index().filter(x => x.id !== s.id && stationKey({ number: x.number, id: x.stationId, name: x.name }) === key);
    const e = (P.index || []).find(x => x.key === key);
    let shared = e ? e.sessions - (s.playbook && s.playbook.key === key ? 1 : 0) : 0;
    if (shared < 0) shared = 0;
    if (!local.length && !shared) return null;
    return { local, shared, entry: e };
  }

  function refresh() { fillStrip(); if (P.A) { renderActs(P.A); renderSaveBar(P.A); if (P.A.playbookChanged) P.A.playbookChanged(); } }
  function init(A) { P.A = A; renderSaveBar(A); loadIndex(); }

  S.playbook = { REPO, init, stationStrip, renderActs, panel, existing, openSaved, autosaveSoon, flush, renderSaveBar, save, saveAllUnsaved, usePrecedent, continueFrom, similar, summary, record, indexEntry, stationKey, privacyScan, loadIndex, state: P };
})(typeof window !== 'undefined' ? window : globalThis);
