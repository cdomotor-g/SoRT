/* SoRT v2 — playbook.js
   The playbook — the saved sessions: how SoRT forums dealt with each station,
   kept by Flood-Net's server for whoever has the forum passphrase
   (store-remote.js), so every forum computer sees the same sessions and a
   station that comes back, or one like it, starts from what was decided before.
   (Until Nov 2026 it was the private GitHub repo cdomotor-g/SoRT-playbook,
   which still holds the five stations it was seeded with.)

   The repo holds:
     index.json               one line per station — enough to search and rank
     stations/<key>.json      that station's sessions, newest last
   where <key> is the Bureau number (else Flood-Net's id, else "manual-<name>").
   A session is stored twice over: `summary` (every answer as codes + labels,
   Property Services, follow-ups, map — flat, for precedents and a later
   Dataverse import) and `session` (the browser session itself, for Continue).
   Sessions imported from Word reports carry only the summary.

   It keeps no landholder names or contact details and no gate, padlock or key
   codes: sharing checks the typed text for anything that looks like one first,
   and holds the session back until a person decides. There is no Share
   button — see "sharing by itself" below.

   Deleting (Sessions → Delete → Confirm delete) takes a session out of its
   station's file and leaves a note of it there (`deleted`: id and when), so
   a computer that still has it open, or kept a copy, never shares it back
   by itself — it says it was deleted, and offers to share it again. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules, sch = () => S.schema;
  const h = (...a) => U().h(...a);
  const REPO = { owner: 'cdomotor-g', repo: 'SoRT-playbook', branch: 'main' };
  const LS_INDEX = 'sortv2.pb.index';
  const P = { A: null, index: null, indexSha: '', indexAt: 0, status: 'off', error: '', files: new Map(), busy: false, held: new Map(), failure: null, gone: new Set(), ask: null };
  // P.gone: ids deleted from the saved sessions (here, or found deleted there) — never shared again by
  // themselves. P.ask: the shared row whose Delete is waiting to be confirmed.

  /* ---------------- keys + loading ---------------- */
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function stationKey(st) {
    if (!st) return null;
    const n = String(st.number || '').replace(/\D/g, '');
    if (n) return n;
    if (st.id) return slug(st.id);
    return st.name ? `manual-${slug(st.name)}` : null;
  }
  let indexRetry = null;
  async function loadIndex() {
    clearTimeout(indexRetry); indexRetry = null;
    if (!S.shared.has()) { P.status = 'off'; P.index = U().LS.json(LS_INDEX, null); refresh(); return; }
    P.status = 'loading'; refresh();
    try {
      const f = await S.shared.getFile('index.json');
      if (!f) { P.index = []; P.indexSha = ''; P.status = 'ready'; }   // nothing saved yet: the first save makes the index
      else { P.index = JSON.parse(f.text).stations || []; P.indexSha = f.sha; P.status = 'ready'; U().LS.set(LS_INDEX, JSON.stringify(P.index)); }
      P.indexAt = Date.now();
    } catch (e) {
      P.status = e.status === 401 ? 'denied' : 'error'; P.error = e.message; P.index = U().LS.json(LS_INDEX, null);
      // Out of reach (not refused): try again by itself in a minute.
      if (P.status === 'error') indexRetry = setTimeout(loadIndex, RETRY_MS() * 4);
    }
    refresh();
    if (P.status === 'ready') catchUp();
  }
  // The index again, quietly, if it is more than a little old (Sessions opening).
  async function freshIndex() {
    if (P.status !== 'ready' || P.busy || Date.now() - P.indexAt < 20000) return;
    try {
      const f = await S.shared.getFile('index.json');
      if (f && !P.busy) { P.index = JSON.parse(f.text).stations || []; P.indexSha = f.sha; P.indexAt = Date.now(); U().LS.set(LS_INDEX, JSON.stringify(P.index)); refresh(); }
    } catch (_) { /* the list stays as it was */ }
  }
  async function loadStation(key, fresh) {
    if (!fresh && P.files.has(key)) return P.files.get(key);
    const f = await S.shared.getFile(`stations/${key}.json`);
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
    const s = U().clone(session);
    // The Bureau benchmarks list is Flood-Net's editors' only: the one a forum Used
    // is in its Local TBM answer; the list itself stays in the browser that fetched it.
    delete s.prefill.__ps; delete s.playbook; delete s.bureauBenchmarks;
    return { id: session.id, source: 'sort-v2', savedAt: new Date().toISOString(), savedBy: ((session.forum || {}).attendees || []).join(', '), forum: session.forum,
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
      (Array.isArray(a.pictures) ? a.pictures : []).forEach(p => { if (p && p.caption) texts.push([`${c} picture caption`, p.caption]); });   // the pictures themselves can't be read
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
  // A short fingerprint of what a save would store (cyrb53, 64 bits): the same
  // fingerprint as last time means there is nothing new to send. The time it
  // was taken and the time it was last edited don't count.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  const fingerprint = rec => hash(JSON.stringify(Object.assign({}, rec, { savedAt: null, session: Object.assign({}, rec.session, { updatedAt: null }) })));
  const sameLine = (a, b) => !!a && !!b && JSON.stringify(Object.assign({}, a, { updatedAt: null })) === JSON.stringify(Object.assign({}, b, { updatedAt: null }));

  async function putJson(path, obj, sha) { return S.shared.putFile(path, JSON.stringify(obj, null, 2) + '\n', '', sha); }
  // The station's file with this session put in. Written straight over the copy
  // this computer last read or wrote (one request); only if another computer
  // saved it in between (412) is it read again and the session put in afresh.
  // A copy of the same session that was changed later elsewhere is never
  // replaced by an older one from here, unless this is the session on screen.
  const deletedHere = (file, id) => (file.deleted || []).some(d => d.id === id);
  async function putStation(key, st, rec, onScreen, again) {
    let cur = P.files.get(key) || await loadStation(key, true), reread = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = cur ? U().clone(cur.data) : { schema: 'sort-playbook-station/1', key, sessions: [], tags: [] };
      file.station = { number: st.number || '', name: st.name || '', floodnetId: st.source === 'floodnet' ? st.id : '', lat: st.lat, lon: st.lon,
        kinds: st.kinds || [], lga: st.lga || '', hub: st.hubName || '', owner: st.owner || '' };
      file.sessions = file.sessions || [];
      // Deleted from the saved sessions: not put back unless a person asked to share it again.
      if (deletedHere(file, rec.id)) { if (!again) return { file, sha: cur.sha, gone: true, reread }; file.deleted = file.deleted.filter(d => d.id !== rec.id); }
      const i = file.sessions.findIndex(x => x.id === rec.id);
      const theirs = i >= 0 ? ((file.sessions[i].session || {}).updatedAt || 0) : 0;
      if (!onScreen && theirs > (rec.session.updatedAt || 0)) return { file, sha: cur.sha, newer: true, reread };
      if (i >= 0) file.sessions[i] = rec; else file.sessions.push(rec);
      file.sessions.sort((a, b) => String((a.forum || {}).date).localeCompare(String((b.forum || {}).date)));
      try {
        const r = await putJson(`stations/${key}.json`, file, cur && cur.sha);
        P.files.set(key, { data: file, sha: r.sha });
        return { file, sha: r.sha, reread };
      } catch (e) {
        if (e.status !== 409 || attempt === 2) throw e;
        cur = await loadStation(key, true); reread = true;   // someone saved in between: read it again
      }
    }
  }
  // The index: rewritten only when this station's line in it changed (or when
  // another computer had saved the station since — its line may be behind).
  async function upsertIndex(file, force) {
    const e = file.sessions.length ? indexEntry(file) : null;
    const was = (P.index || []).find(x => x.key === file.key);
    if (!force && (e ? sameLine(was, e) : !was)) return;
    let cur = P.indexSha ? { sha: P.indexSha, idx: { schema: 'sort-playbook-index/1', stations: (P.index || []).slice() } } : null;
    if (!cur) { const f = await S.shared.getFile('index.json'); cur = f ? { sha: f.sha, idx: JSON.parse(f.text) } : null; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const idx = cur ? cur.idx : { schema: 'sort-playbook-index/1', stations: [] };
      idx.stations = (idx.stations || []).filter(x => x.key !== file.key);
      if (e) idx.stations.push(e);
      idx.stations.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      idx.updated = new Date().toISOString();
      try {
        const r = await putJson('index.json', idx, cur && cur.sha);
        P.index = idx.stations; P.indexSha = r.sha; P.indexAt = Date.now(); U().LS.set(LS_INDEX, JSON.stringify(P.index));
        return;
      } catch (err) {
        if (err.status !== 409 || attempt === 2) throw err;
        const f = await S.shared.getFile('index.json');   // someone saved it in between: read it again
        cur = f ? { sha: f.sha, idx: JSON.parse(f.text) } : null;
      }
    }
  }
  // Sessions out of a station's file (and its line in the index brought up to
  // date). deleted: noted in the file as deleted, so they aren't shared back.
  // → how many were taken out.
  async function takeOut(key, ids, deleted) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await loadStation(key, true);
      if (!cur) {   // no file: at most a line in the index that shouldn't be there
        if (deleted && (P.index || []).some(x => x.key === key)) await upsertIndex({ key, sessions: [] });
        return 0;
      }
      const file = U().clone(cur.data);
      const out = (file.sessions || []).filter(x => ids.includes(x.id));
      if (!out.length) { if (deleted) await upsertIndex(file); return 0; }
      file.sessions = file.sessions.filter(x => !ids.includes(x.id));
      if (deleted) file.deleted = (file.deleted || []).filter(d => !ids.includes(d.id)).concat(out.map(x => ({ id: x.id, at: new Date().toISOString() })));
      try {
        const r = await putJson(`stations/${key}.json`, file, cur.sha);
        P.files.set(key, { data: file, sha: r.sha });
        await upsertIndex(file, true);
        return out.length;
      } catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
    }
  }
  // A session whose station changed (a Bureau number corrected) leaves the old station's file.
  const moveOut = (key, id) => takeOut(key, [id], false);
  // Note on the session — on screen, in this browser's copy, or both — that it is shared.
  function markShared(session, pb) {
    session.playbook = pb;
    const live = P.A && P.A.session && P.A.session.id === session.id ? P.A.session : null;
    if (live && live !== session) live.playbook = Object.assign({}, pb);
    const kept = S.store.load(session.id);
    if (kept) { kept.playbook = Object.assign({}, pb); S.store.update(kept); }
  }

  // Share one session with the forum. auto: by itself (never asks anything;
  // what looks private holds it until a person decides). → 'saved' (sent),
  // 'same' (nothing new to send), 'newer' (a later copy is already shared),
  // 'held', 'off', 'none' (no station), 'no' (a person said no), 'gone'
  // (deleted from the saved sessions) or 'failed'. again: a person asked to
  // share a deleted session again.
  async function save(A, session, quiet, auto, again) {
    session = session || A.session;
    if (P.gone.has(session.id) && !again) return 'gone';
    if (!S.shared.has()) {
      if (!auto) S.shared.dialog({ why: 'Saving to the forum needs the forum passphrase — once on this computer.', onDone: ok => { if (ok) loadIndex(); } });
      return 'off';
    }
    const st = session.station, key = stationKey(st);
    if (!key) { if (!auto) A.toast('Choose (or enter) the station first — the saved sessions are filed by station.'); return 'none'; }
    const old = session.playbook || {};
    // A person who said "save it anyway" isn't asked again about the same text.
    const allowed = new Set(old.allowed || []);
    const found = privacyScan(session).filter(f => !allowed.has(hash(f)));
    if (found.length) {
      if (auto) { P.held.set(session.id, found); refresh(); return 'held'; }
      if (!G.confirm(`This session’s text looks like it holds:\n\n• ${found.slice(0, 6).join('\n• ')}\n\nThe saved sessions keep no landholder contact details and no gate, padlock or key codes. Cancel to remove it first, or OK if it is fine to keep.`)) return 'no';
      found.forEach(f => allowed.add(hash(f)));
      session.playbook = Object.assign({}, old, { allowed: [...allowed] });
    }
    P.held.delete(session.id);
    const rec = record(A.defs, session), fp = fingerprint(rec);
    const pb = (sha, savedAt) => ({ savedAt: savedAt || Date.now(), asOf: rec.session.updatedAt || Date.now(), key, sha: sha || '', fp, allowed: [...allowed] });
    if (old.fp === fp && old.key === key && old.savedAt && !again) { markShared(session, pb(old.sha, old.savedAt)); refresh(); return 'same'; }
    P.busy = session.id; refresh();
    try {
      const onScreen = !!(A.session && A.session.id === session.id);
      if (S.pictures) await S.pictures.share(session);   // its pictures first, each its own file (js/pictures.js)
      const r = await putStation(key, st, rec, onScreen, again);
      if (r.gone) { P.gone.add(session.id); P.failure = null; return 'gone'; }
      P.gone.delete(session.id);
      if (r.newer) { markShared(session, Object.assign(pb(r.sha), { fp: null })); return 'newer'; }
      await upsertIndex(r.file, r.reread || again);   // shared again: its line may have left the index
      if (old.key && old.key !== key) await moveOut(old.key, session.id).catch(() => {});
      markShared(session, pb(r.sha));
      P.failure = null;
      if (!quiet) A.toast(`Saved to the forum (${st.name}).`);
      return 'saved';
    } catch (e) {
      if (e.status === 401) { P.status = 'denied'; P.error = e.message; }
      P.failure = { message: e.message, status: e.status, at: Date.now(), id: session.id };
      if (!quiet) A.toast(`Couldn’t save it to the forum (${e.message}) — it is still saved in this browser.`);
      return 'failed';
    } finally { P.busy = false; refresh(); }
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
      if (!f) { A.toast('That station isn’t in the saved sessions.'); return; }
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
  let stripHost = null, stripFor = '', stripOpen = false;   // the fold stays as the person left it while the card redraws
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
    const head = h('span', { class: 'fld-label' }, 'Saved sessions');
    if (P.status === 'off') { el.appendChild(h('div', null, head, ' — ', h('button', { type: 'button', class: 'link', onclick: () => S.shared.dialog({ onDone: () => loadIndex() }) }, 'Enter the forum passphrase'), ' to see this station’s earlier sessions and similar precedents.')); return; }
    if (P.status === 'loading') { el.appendChild(h('div', null, head, ' — loading…')); return; }
    if (P.status === 'denied') { el.appendChild(h('div', null, head, ' — the forum passphrase on this computer isn’t right any more. ', h('button', { type: 'button', class: 'link', onclick: () => S.shared.dialog({ onDone: () => loadIndex() }) }, 'Enter it again'))); return; }
    if (P.status !== 'ready') { el.appendChild(h('div', null, head, ` — couldn’t be read (${P.error}). `, h('button', { type: 'button', class: 'link', onclick: () => loadIndex() }, 'Try again'))); return; }
    const key = stationKey(A.session.station);
    if (stripFor !== `${A.session.id}|${key}`) { stripFor = `${A.session.id}|${key}`; stripOpen = false; }   // another session or station: folded again
    const mine = (P.index || []).find(e => e.key === key);
    const o = OUTCOME(A);
    const sim = similar(A);
    // Folded away until asked for: one line says what is inside.
    const cont = mine && !(A.session.continuesFrom && A.session.continuesFrom.key === key);
    const gist = [cont ? `${mine.sessions} earlier session${mine.sessions > 1 ? 's' : ''}` : mine ? 'continuing from an earlier session' : 'no earlier session',
      sim.length ? `${sim.length} similar station${sim.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    const body = h('div', { class: 'pb-fold-body' });
    const fold = h('details', { class: 'pb-fold', id: 'pbFold', open: stripOpen },
      h('summary', { title: 'This station’s earlier sessions, and similar stations whose answers can fill this one in' }, head, h('span', { class: 'hint' }, ` — ${gist}`)), body);
    fold.addEventListener('toggle', () => { stripOpen = fold.open; });
    el.appendChild(fold);
    if (cont) {
      body.appendChild(h('div', null, `${mine.sessions} earlier session${mine.sessions > 1 ? 's' : ''}, the last at the forum of ${U().dmy(mine.lastForum)}${mine.lastOutcome ? ' (' + (o[mine.lastOutcome] || mine.lastOutcome) + ')' : ''}. `,
        h('button', { type: 'button', class: 'btn-mini', onclick: () => continueFrom(A, key) }, 'Continue from it')));
    } else if (mine) body.appendChild(h('div', null, `Continuing from the session of ${U().dmy(A.session.continuesFrom.date)}.`));
    else body.appendChild(h('div', null, 'No earlier session for this station.'));
    if (sim.length) {
      body.appendChild(h('div', { class: 'hint' }, 'Similar stations — use one to fill the answers it shares (marked Precedent until confirmed):'));
      sim.forEach(x => body.appendChild(h('div', { class: 'pb-sim' },
        h('div', { class: 'pb-sim-what' }, h('b', null, x.e.name), x.e.number ? h('span', { class: 'res-num' }, x.e.number) : null,
          h('span', { class: 'hint' }, ` ${x.why.join(' · ')}${x.e.lastOutcome ? ' · ' + (o[x.e.lastOutcome] || x.e.lastOutcome) : ''}`)),
        h('button', { type: 'button', class: 'btn-mini', onclick: () => usePrecedent(A, x.e.key) }, 'Use'))));
    }
  }
  /* ---------------- sharing by itself ---------------- */
  // Every change is saved to the forum by itself, with nothing to press: a
  // few seconds after the last change (so a burst of clicks is one save), and
  // at least every half minute while changes keep coming. A save sends only
  // what changed: nothing when the fingerprint is the same as last time, else
  // the station's file once (putStation) and the index only when its line
  // changed (upsertIndex) — one request where it used to be four.
  // What fails (no internet, the server busy) is tried again by itself, and
  // sessions left unshared — made offline, before the passphrase was typed, or
  // closed before their save went — go one at a time once the server answers.
  // Only what looks private waits for a person (the bar at the top).
  const AUTOSAVE_MS = () => (typeof G.SORT_AUTOSAVE_MS === 'number' ? G.SORT_AUTOSAVE_MS : 4000);
  const MAX_WAIT_MS = () => AUTOSAVE_MS() * 8;
  const RETRY_MS = () => (typeof G.SORT_RETRY_MS === 'number' ? G.SORT_RETRY_MS : 15000);
  // Between sessions being caught up: Flood-Net's brake is 120 requests a
  // minute for a whole office (its computers usually share one address).
  const GAP_MS = () => Math.min(4000, AUTOSAVE_MS());
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Something worth keeping: a station, and at least one answer (looking a station up files nothing).
  const answered = s => Object.values(s.answers || {}).some(a => a && (!R().emptyVal(a.value) || Object.values(a.fields || {}).some(v => String(v || '').trim())))
    || Object.values((s.ps || {}).answers || {}).some(v => String(v || '').trim()) || !!s.outcome;
  // Changed since it was last shared (asOf: the last change that save carried).
  function needsSave(s) {
    if (!(s && s.station && stationKey(s.station) && answered(s)) || P.gone.has(s.id)) return false;
    const pb = s.playbook || {};
    if (!pb.savedAt) return true;
    return (s.updatedAt || 0) > (pb.asOf != null ? pb.asOf : pb.savedAt + 1000);
  }
  const todo = new Map();   // id → the session to share (the one on screen is the live object)
  let soon = null, since = 0, running = false, retry = null, retryAt = 0, fails = 0;
  const ready = () => P.status === 'ready' && S.shared.has();
  const retryable = st => st == null || st === 0 || st === 409 || st === 429 || st >= 500;

  function autosaveSoon(A) {
    P.A = A;
    if (!ready() || !A.session || !stationKey(A.session.station)) return;
    const now = Date.now(), s = A.session;
    if (!soon) since = now;
    clearTimeout(soon);
    soon = setTimeout(() => { soon = null; todo.set(s.id, s); pump(); }, Math.max(0, Math.min(AUTOSAVE_MS(), since + MAX_WAIT_MS() - now)));
  }
  // Now rather than in a moment: before another session opens, or when the page is hidden.
  function flush(A) {
    const s = A && A.session;
    if (soon) { clearTimeout(soon); soon = null; }
    if (s && needsSave(s)) todo.set(s.id, s);
    pump();
  }
  // Every session in this browser that has changed since it was shared.
  function catchUp() {
    if (!ready()) return;
    const live = P.A && P.A.session;
    S.store.index().forEach(x => {
      if (!x.name || todo.has(x.id) || P.held.has(x.id) || (x.playbookAt && (x.updatedAt || 0) <= x.playbookAt)) return;
      const s = live && live.id === x.id ? live : S.store.load(x.id);
      if (needsSave(s)) todo.set(x.id, s);
    });
    pump();
  }
  async function pump() {
    if (running || retry || !ready()) return;
    running = true;
    try {
      while (todo.size && ready()) {
        const live = P.A && P.A.session;
        const id = live && todo.has(live.id) ? live.id : todo.keys().next().value;   // the session on screen first
        const s = live && live.id === id ? live : todo.get(id); todo.delete(id);
        if (!needsSave(s)) continue;
        const r = await save(P.A, s, true, true);
        if (r === 'failed') {
          const st = (P.failure || {}).status;
          if (!retryable(st) || !ready()) break;   // refused (the passphrase, too large): the bar says so; the next change tries again
          if (!todo.has(s.id)) todo.set(s.id, s);
          fails++;
          const wait = st === 429 ? 60000 : Math.min(RETRY_MS() * 2 ** (fails - 1), 300000);
          retryAt = Date.now() + wait;
          retry = setTimeout(() => { retry = null; retryAt = 0; pump(); }, wait);
          break;
        }
        fails = 0;
        if (r === 'saved' && s !== (P.A && P.A.session) && todo.size) await sleep(GAP_MS());
      }
    } finally { running = false; refresh(); }
  }
  function tryNow() {
    clearTimeout(retry); retry = null; retryAt = 0;
    if (P.status === 'error') loadIndex(); else { flush(P.A); catchUp(); }
  }

  // Where the session on screen stands with the forum: a short word for the top
  // bar, and a sentence for under Copy for Word.
  function shareState(A) {
    const s = A && A.session; if (!s) return null;
    const clock = t => U().fmtClock(t);
    if (!S.shared.has() || P.status === 'off') return { cls: 'warn', short: '⚠ Only in this browser', text: 'Saved only in this browser — with the forum passphrase (the bar at the top) it is saved to the forum by itself.' };
    if (P.status === 'denied') return { cls: 'warn', short: '⚠ Only in this browser', text: 'Saved only in this browser — the forum passphrase on this computer isn’t right any more (the bar at the top).' };
    if (P.status === 'loading') return { cls: '', short: 'Connecting…', text: 'Connecting to the saved sessions…' };
    if (P.status !== 'ready') return { cls: 'warn', short: '⚠ Only in this browser', text: `Saved only in this browser for now — the saved sessions can’t be reached (${P.error}). It is saved by itself once they can.` };
    if (P.held.has(s.id)) return { cls: 'warn', short: '⚠ Not saved', text: 'Not saved: its text looks like it holds something private — see the bar at the top.' };
    if (P.gone.has(s.id)) return { cls: 'warn', short: '⚠ Deleted from the forum', text: 'Not saved: someone deleted this session from the forum’s saved sessions. It is still saved in this browser — see the bar at the top.' };
    if (!stationKey(s.station) || !answered(s)) return { cls: '', short: '', text: 'It is saved to the forum by itself once it has a station and an answer.' };
    if (P.busy === s.id) return { cls: '', short: 'Saving…', text: 'Saving to the forum…' };
    if (P.failure && needsSave(s)) return { cls: 'warn', short: '⚠ Not saved yet', text: `Not saved yet — ${P.failure.message}. ${retryAt ? `It tries again by itself at ${clock(retryAt)}.` : 'It tries again at the next change.'} Everything is saved in this browser meanwhile.` };
    if (soon || todo.has(s.id) || needsSave(s)) return { cls: '', short: 'Saving in a moment…', text: 'Changed — saved to the forum by itself in a moment.' };
    const at = (s.playbook || {}).savedAt;
    return { cls: 'ok', short: `✓ Saved ${clock(at)}`, text: `✓ Saved to the forum by itself — last sent at ${clock(at)}.` };
  }
  function renderActs(A) {
    P.A = A;
    const st = shareState(A); if (!st) return;
    const el = document.getElementById('playbookActs');
    if (el) { el.innerHTML = ''; el.appendChild(h('span', { class: `share-state ${st.cls}`, id: 'shareState' }, st.text)); }
    const chip = document.getElementById('shareChip');
    if (chip) { chip.textContent = st.short ? ` · ${st.short}` : ''; chip.className = `share-chip ${st.cls}`; chip.title = st.text; }
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
      // Its fingerprint as shared, so opening it sends nothing until something changes.
      theirs.playbook = { savedAt: Date.parse(rec.savedAt) || Date.now(), asOf: theirs.updatedAt || 0, key, sha: f.sha, fp: fingerprint(rec) };
      if (!mine || (theirs.updatedAt || 0) >= (mine.updatedAt || 0)) { theirs.playbook.savedAt = Math.max(theirs.playbook.savedAt, theirs.updatedAt || 0); S.store.save(theirs, true); }
      A.openSession(rec.id);
    } catch (e) { A.toast(`Couldn’t read the playbook: ${e.message}`); }
  }

  /* ---------------- where this session is kept: the warning bar ---------------- */
  // Hidden while all is well; it speaks only when a person is needed, or when
  // sharing has been failing for a while.
  function renderSaveBar(A) {
    const el = document.getElementById('saveBar'); if (!el || !A || !A.session) return;
    el.innerHTML = '';
    const dl = () => { const b = document.getElementById('downloadBtn'); if (b) b.click(); };
    const bar = (cls, ...kids) => { el.className = 'save-bar ' + cls; el.hidden = false; kids.forEach(k => k && el.appendChild(k)); };
    const link = (label, run, title) => h('button', { type: 'button', class: 'link', onclick: run, title: title || null }, label);
    const held = P.held.get(A.session.id);
    if (held) {
      bar('warn', h('span', null, h('b', null, 'Not saved to the forum: '), `it looks like it holds ${held[0]}${held.length > 1 ? ` (and ${held.length - 1} more)` : ''}. Saved sessions keep no landholder contact details and no gate, padlock or key codes — remove it, or `),
        link('save it anyway', () => save(A), 'Save it as it is — you won’t be asked again about this text'), document.createTextNode('.'));
      return;
    }
    if (P.gone.has(A.session.id)) {
      bar('warn', h('span', null, h('b', null, '⚠ Deleted from the forum’s saved sessions'), ' — someone deleted this session there, so it isn’t saved there any more. It is still saved in this browser. '),
        link('Save it again', () => save(A, A.session, false, false, true), 'Put it back in the saved sessions, as it is now'), document.createTextNode(' · '), link('Download a copy', dl, 'Save this session as a file'));
      return;
    }
    if (P.status === 'ready') {
      const f = P.failure;
      if (f && needsSave(A.session) && (fails >= 2 || !retry)) {
        bar('warn', h('span', null, h('b', null, '⚠ Not saved to the forum yet'), ` — ${f.message}. `, retry ? `It keeps trying by itself (next at ${U().fmtClock(retryAt)}); ` : '', 'everything is saved in this browser meanwhile. '),
          link('Try now', tryNow), document.createTextNode(' · '), link('Download a copy', dl, 'Save this session as a file'));
        return;
      }
      el.hidden = true; return;
    }
    if (P.status === 'loading') { bar('info', h('span', null, 'Connecting to the saved sessions…')); return; }
    const why = P.status === 'off' ? null : P.status === 'denied' ? 'the forum passphrase on this computer isn’t right any more' : `the saved sessions can’t be reached just now (${P.error}); it keeps trying by itself`;
    bar('warn', h('span', null, h('b', null, '⚠ Saved only in this browser'), why ? ` — ${why}. ` : '. ',
      'Nobody else can open this session, and clearing the browser loses it. '),
      P.status === 'off' || P.status === 'denied' ? link('Enter the forum passphrase', () => S.shared.dialog({ onDone: () => loadIndex() }), 'Once on this computer: then every session is saved for the whole forum by itself')
        : link('Try now', tryNow),
      document.createTextNode(' · '), link('Download a copy', dl, 'Save this session as a file'));
  }

  /* ---------------- deleting ---------------- */
  // Delete sessions from the saved sessions, and this browser's copies with
  // them (a new session if one was on screen). Throws if it couldn't; then
  // nothing has changed.
  async function deleteShared(A, key, ids) {
    ids.forEach(id => { P.gone.add(id); todo.delete(id); P.held.delete(id); });   // nothing shares them back meanwhile
    try { await takeOut(key, ids, true); }
    catch (e) { ids.forEach(id => P.gone.delete(id)); throw e; }
    ids.forEach(id => A.dropLocal(id));
    refresh();
  }
  // Out of this browser only. deleted: for good (it was never shared), so no save on its way shares it.
  function dropQueued(id, deleted) { todo.delete(id); P.held.delete(id); if (deleted) P.gone.add(id); }
  const recWhat = (A, r) => [r.forum && r.forum.date ? `forum ${U().dmy(r.forum.date)}` : '', r.outcome ? (OUTCOME(A)[r.outcome] || r.outcome) : 'not finished'].filter(Boolean).join(' · ');
  // A shared row's Delete: its station's file read afresh, then the question.
  async function askDelete(A, e) {
    P.ask = { key: e.key, phase: 'loading' }; refresh();
    try {
      const f = await loadStation(e.key, true);
      if (!P.ask || P.ask.key !== e.key) return;
      Object.assign(P.ask, { phase: 'ready', recs: f ? (f.data.sessions || []).map(r => ({ id: r.id, what: recWhat(A, r) })) : [] });
    } catch (err) { if (P.ask && P.ask.key === e.key) Object.assign(P.ask, { phase: 'error', error: err.message }); }
    refresh();
  }
  async function confirmDelete(A, e, ids) {
    const a = P.ask; if (!a) return;
    a.phase = 'busy'; refresh();
    try {
      await deleteShared(A, e.key, ids);
      P.ask = null;
      A.toast(ids.length > 1 ? `Deleted all ${ids.length} of ${e.name}’s sessions from the forum.` : `Deleted ${e.name}’s session from the forum.`);
    } catch (err) { if (P.ask === a) Object.assign(a, { phase: 'error', error: err.message }); }
    refresh();
  }
  // The second step, under the row: what goes, and the buttons that do it.
  function askRow(A, e) {
    const a = P.ask, cancel = h('button', { type: 'button', class: 'btn', onclick: () => { P.ask = null; refresh(); } }, 'Cancel');
    const strip = (text, ...btns) => h('div', { class: 'sess-confirm', role: 'group', 'aria-label': `Delete ${e.name}’s session` }, h('p', null, text), h('div', { class: 'sess-acts' }, btns, cancel));
    if (a.phase === 'loading') return strip('Reading its sessions…');
    if (a.phase === 'error' && !a.recs) return strip(`Couldn’t read its sessions (${a.error}).`, h('button', { type: 'button', class: 'btn', onclick: () => askDelete(A, e) }, 'Try again'));
    const recs = a.recs || [], last = recs[recs.length - 1];
    if (!last) return strip('It has no sessions left to delete.');
    const busy = a.phase === 'busy';
    const del = (label, ids, title) => h('button', { type: 'button', class: 'btn btn-danger', disabled: busy, title, onclick: () => confirmDelete(A, e, ids) }, label);
    const here = recs.filter(r => S.store.load(r.id)).length;
    const text = recs.length === 1
      ? `Delete ${e.name}’s session (${last.what}) from the forum’s saved sessions, for everyone? Nobody will be able to open it again.`
      : `Delete ${e.name}’s last session (${last.what}) from the forum’s saved sessions, for everyone? Its ${recs.length - 1} earlier session${recs.length > 2 ? 's stay' : ' stays'}.`;
    return strip([text, here ? ` ${here === 1 ? 'Its copy in this browser goes too.' : 'The copies in this browser go too.'}` : '', busy ? ' Deleting…' : a.phase === 'error' ? ` Couldn’t delete it (${a.error}).` : ''].join(''),
      del('Confirm delete', [last.id], recs.length === 1 ? 'Delete it for good' : 'Delete its last session for good; the earlier ones stay'),
      recs.length > 1 ? del(`Delete all ${recs.length}`, recs.map(r => r.id), `Delete every one of ${e.name}’s ${recs.length} saved sessions for good`) : null);
  }

  /* ---------------- the Sessions dialog: the shared playbook ---------------- */
  const matches = (q, ...xs) => !q || xs.some(x => String(x || '').toLowerCase().includes(q));
  function panel(A, query, close, onAsk) {
    const q = String(query || '').trim().toLowerCase();
    const box = h('div', { class: 'pb-panel' });
    if (P.status === 'off' || P.status === 'denied') { box.appendChild(h('p', { class: 'hint' }, P.status === 'off' ? 'Not connected — sessions are only being kept in this browser. ' : 'The forum passphrase on this computer isn’t right any more. ', h('button', { type: 'button', class: 'link', onclick: () => S.shared.dialog({ onDone: () => loadIndex() }) }, 'Enter the forum passphrase'))); return box; }
    if (P.status !== 'ready') { box.appendChild(h('p', { class: 'hint' }, P.status === 'loading' ? 'Loading…' : `The saved sessions can’t be reached just now${P.error ? ` (${P.error})` : ''}. `, P.status === 'loading' ? null : h('button', { type: 'button', class: 'link', onclick: () => loadIndex() }, 'Try again'))); return box; }
    const o = OUTCOME(A), curKey = stationKey(A.session.station);
    const all = (P.index || []).slice().sort((a, b) => String(b.lastForum).localeCompare(String(a.lastForum)));
    const rows = all.filter(e => matches(q, e.name, e.number, e.lga, e.hub));
    if (!rows.length) { box.appendChild(h('p', { class: 'hint' }, q ? 'No saved session matches.' : 'Nothing saved yet.')); }
    if (P.ask && !all.some(e => e.key === P.ask.key)) P.ask = null;
    const rowsBox = h('div', { class: 'sess-list' });
    box.appendChild(rowsBox);
    (q ? rows : rows.slice(0, 15)).forEach(e => {
      const other = curKey && e.key !== curKey, asking = P.ask && P.ask.key === e.key;
      rowsBox.appendChild(h('div', { class: 'sess' + (asking ? ' asking' : '') },
        h('div', { class: 'sess-main' },
          h('div', { class: 'sess-name' }, e.name, e.number ? h('span', { class: 'res-num' }, e.number) : null),
          h('div', { class: 'res-meta' }, [`${e.sessions} session${e.sessions === 1 ? '' : 's'}`, e.lastForum && `last at the forum of ${U().dmy(e.lastForum)}`,
            e.lastOutcome ? (o[e.lastOutcome] || e.lastOutcome) : 'not finished', e.lga].filter(Boolean).join(' · '))),
        h('div', { class: 'sess-acts' },
          h('button', { type: 'button', class: 'btn', title: 'Open its last session as it was saved, and carry on with it', onclick: () => { close(); openSaved(A, e.key); } }, 'Open'),
          h('button', { type: 'button', class: 'btn btn-quiet', title: 'A new session for today’s forum, starting from its last answers (each to check)', onclick: () => { close(); continueFrom(A, e.key); } }, 'Start from it'),
          other ? h('button', { type: 'button', class: 'btn btn-quiet', title: `Fill ${A.session.station ? A.session.station.name : 'this session'}’s unanswered questions from this station’s last session — each one orange until you check it`, onclick: () => { close(); usePrecedent(A, e.key); } }, 'Use as a precedent') : null,
          asking ? null : h('button', { type: 'button', class: 'btn btn-quiet btn-del', title: 'Delete its last session from the forum’s saved sessions, for everyone — you are asked to confirm first', onclick: () => { if (onAsk) onAsk(); askDelete(A, e); } }, 'Delete')),
        asking ? askRow(A, e) : null));
    });
    if (!q && rows.length > 15) box.appendChild(h('p', { class: 'hint' }, `${rows.length - 15} more — search to find them.`));
    const waiting = todo.size + (P.busy ? 1 : 0), held = P.held.size;
    if (waiting) box.appendChild(h('p', { class: 'hint' }, `${waiting} session${waiting > 1 ? 's' : ''} from this browser ${waiting > 1 ? 'are' : 'is'} being saved by ${waiting > 1 ? 'themselves' : 'itself'}, one at a time.`));
    if (held) box.appendChild(h('p', { class: 'hint' }, `${held} session${held > 1 ? 's' : ''} in this browser ${held > 1 ? 'are' : 'is'} held back: the text looks like it holds a phone number, an email or a gate code. Open ${held > 1 ? 'each' : 'it'} to see what, and remove it or save it anyway.`));
    box.appendChild(h('p', { class: 'hint' }, h('button', { type: 'button', class: 'link', id: 'changePass', onclick: () => S.shared.changeDialog({ onDone: () => A.toast('Forum passphrase changed — tell the forum; each computer asks for it next time.') }) }, 'Change the forum passphrase')));
    return box;
  }
  // How many stations the forum's list holds (or how many match a search); null while it can't be read.
  function count(query) {
    if (P.status !== 'ready') return null;
    const q = String(query || '').trim().toLowerCase();
    return (P.index || []).filter(e => matches(q, e.name, e.number, e.lga, e.hub)).length;
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
  function init(A) {
    P.A = A; renderSaveBar(A); loadIndex();
    // Back online: what was waiting goes now.
    G.addEventListener('online', () => { if (retry || P.status === 'error') tryNow(); });
  }
  // Sessions opening: the shared list as it is now, and anything left unshared.
  function onSessionsOpen() { P.ask = null; freshIndex(); catchUp(); }

  S.playbook = { REPO, init, stationStrip, renderActs, panel, count, existing, openSaved, autosaveSoon, flush, catchUp, onSessionsOpen, renderSaveBar, save, needsSave, shareState, usePrecedent, continueFrom, similar, summary, record, indexEntry, fingerprint, stationKey, privacyScan, loadIndex, deleteShared, dropQueued, state: P };
})(typeof window !== 'undefined' ? window : globalThis);
