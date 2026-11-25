/* SoRT v2 — live.js
   Several people in one session at once, each on their own computer.

   What each person sees:
     * everybody else's answers, within about ten seconds, without reloading;
     * a bar saying who else is in the session, and which question each is in;
     * a question somebody else is in, greyed and marked "✎ Sam is editing",
       with a Take over button. That is a soft lock: it stops two people
       typing over each other, never stops a forum (it lapses by itself).

   How, with nothing new on Flood-Net's server (worker/sort.js, docs/sort-store.md):
     * Who is where: one small file per session, stations/live-<session id>.json,
       saved through the same store as the sessions (ETags, If-Match). Each
       computer's tab writes its own line in it — its name, the question it is
       in (q:<code>, or ps:<row> on the Property Services table), when, and when
       it last saved the session — every 20–40 seconds while the page is in
       front, and at once when it moves to another question.
     * Changes: when somebody's line says they saved since we last looked, the
       station's file is read and their session merged into the one on screen,
       question by question (merge3). The same merge runs whenever a save finds
       somebody else saved first (playbook.js putStation), so no save can wipe
       out another computer's answers any more.
     * The merge, per question (and per Property Services row, forum detail,
       map pin or bridge): changed on one side only → that side's; changed on
       both → the person holding the question's lock wins, else this computer
       (the one about to save — the later change).
   It goes quiet (no requests at all) while the tab is hidden, without the
   forum passphrase, and for a session that isn't saved to the forum yet.
   Flood-Net's brake is 120 requests a minute per office address: the read
   every 6–15 seconds (slower the more people are in the session, 20 s alone)
   keeps a whole office of computers well under it. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const h = (...a) => U().h(...a);
  const LS_NAME = 'sortv2.me', LS_BASE = 'sortv2.live.base';
  const T = () => (typeof G.SORT_LIVE_MS === 'number' ? G.SORT_LIVE_MS : 0);   // tests: everything faster
  const ALONE_MS = () => T() || 20000;
  const BEAT_MS = held => (T() ? T() * 2 : held ? 20000 : 40000);
  const FRESH_MS = () => (T() ? T() * 8 : 75000);
  const IDLE_TYPING_MS = () => (T() ? T() * 10 : 90000);   // a text box left alone this long lets the question go
  const IDLE_CLICK_MS = () => (T() ? T() * 5 : 15000);     // a button clicked (an option) — shorter
  const pace = n => (T() ? T() : Math.max(6000, Math.min(15000, 4000 * (n + 1))));

  let tabId = '';
  try { tabId = G.sessionStorage.getItem('sortv2.live.tab') || ''; } catch (_) { /* */ }
  if (!tabId) { tabId = Math.random().toString(36).slice(2, 10); try { G.sessionStorage.setItem('sortv2.live.tab', tabId); } catch (_) { /* */ } }

  const L = {
    A: null, id: null, file: null,            // file: { data, sha } — the live file as last read or written
    seen: new Map(),                          // tab → { at, when }: its `at` and when (our clock) it last changed
    savedSeen: new Map(),                     // tab → the `saved` we last merged from
    unit: null, unitAt: 0, typing: false,     // the question this tab is in, since when it was last used
    take: null,                               // { unit, from } — a question taken over from another tab
    mySaved: 0, lastWrite: 0, writing: false, wantWrite: false, needPull: true,
    timer: null, pausedTill: 0, bases: new Map()
  };

  /* ---------------- names ---------------- */
  const myName = () => { try { return G.localStorage.getItem(LS_NAME) || ''; } catch (_) { return ''; } };
  function setName(n) {
    try { G.localStorage.setItem(LS_NAME, String(n || '').trim().slice(0, 40)); } catch (_) { /* */ }
    writeSoon(); bar();
  }
  const nameOf = p => (p && p.name) || 'Someone on another computer';

  /* ---------------- the merge ---------------- */
  // Plain data compared whatever order its keys were written in.
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return v === undefined ? 'null' : JSON.stringify(v);
  }
  const same = (a, b) => stable(a) === stable(b);
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // How far down each part is merged: 1 = each key on its own; an object = its
  // keys as given (others whole); 'id' = a list merged item by item, by id.
  const SPEC = {
    answers: 1, prefill: 1, followUpState: 1, include: 1, forum: 1,
    ps: { answers: 1, dirty: 1, comments: 1 },
    map: { features: 'id', marks: 'id', bridges: 'id' }
  };
  // What only this browser keeps, never merged (and never in a shared copy).
  const LOCAL = ['playbook', 'bureauBenchmarks', 'updatedAt'];
  function shareable(s) {
    const c = U().clone(s || {});
    LOCAL.forEach(k => delete c[k]);
    if (c.prefill) delete c.prefill.__ps;
    if (c.include) delete c.include.empty;
    return c;
  }
  // The question (or Property Services row) a part of the session belongs to.
  function unitOf(path) {
    if ((path[0] === 'answers' || path[0] === 'prefill') && path[1] != null) return 'q:' + path[1];
    if (path[0] === 'ps' && /^(answers|dirty|comments)$/.test(path[1]) && path[2] != null) return 'ps:' + String(path[2]).split('.')[0];
    return null;
  }
  function pick(b, m, t, prefer) {
    if (same(m, b)) return t;
    if (same(t, b) || same(m, t)) return m;
    return prefer === 'theirs' ? t : m;
  }
  function mergeList(b, m, t, path, prefer) {
    const all = [b, m, t].map(x => (Array.isArray(x) ? x : []));
    if (all.some(x => x.some(i => !isObj(i) || i.id == null))) return pick(b, m, t, prefer(path));
    const [B, M, Tm] = all.map(x => new Map(x.map(i => [String(i.id), i])));
    const order = [...Tm.keys(), ...[...M.keys()].filter(k => !Tm.has(k)), ...[...B.keys()].filter(k => !Tm.has(k) && !M.has(k))];
    const out = [];
    order.forEach(k => { const v = pick(B.get(k), M.get(k), Tm.get(k), prefer(path.concat(k))); if (v !== undefined) out.push(v); });
    return out;
  }
  function merge(b, m, t, spec, path, prefer) {
    if (spec === 'id') return mergeList(b, m, t, path, prefer);
    if (spec && isObj(m) && isObj(t)) {
      const B = isObj(b) ? b : {}, out = {};
      new Set([...Object.keys(B), ...Object.keys(m), ...Object.keys(t)]).forEach(k => {
        const v = merge(B[k], m[k], t[k], spec === 1 ? null : spec[k], path.concat(k), prefer);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    return pick(b, m, t, prefer(path));
  }
  // base: what both last agreed on; mine: this computer's; theirs: the forum's.
  // In a clash, the person holding that question's lock wins, else this computer.
  function merge3(base, mine, theirs, holder) {
    const prefer = path => { const u = unitOf(path); const who = u && holder ? holder(u) : null; return who ? 'theirs' : 'mine'; };
    return merge(shareable(base), shareable(mine), shareable(theirs), SPEC, [], prefer);
  }

  /* ---------------- what both sides last agreed on ---------------- */
  function base(id) {
    if (L.bases.has(id)) return L.bases.get(id);
    const b = U().LS.json(LS_BASE, null);
    return b && b.id === id ? b.session : null;
  }
  function setBase(id, s) {
    const c = shareable(s);
    L.bases.set(id, c);
    U().LS.set(LS_BASE, JSON.stringify({ id, session: c }));
  }

  // Put the forum's copy of the session on screen into it. → true when the
  // session on screen changed. `sha`/`rec`: the station's file it came from,
  // so a copy that ends up the same as theirs isn't sent back.
  function absorb(theirs, rec, key, sha) {
    const A = L.A, s = A && A.session;
    if (!s || !theirs || theirs.id !== s.id) return false;
    const b = base(s.id);
    if (b && same(shareable(theirs), b)) return false;            // nothing new from them
    const mineBefore = shareable(s);
    const merged = merge3(b || {}, s, theirs, u => holderOther(u));
    setBase(s.id, theirs);
    const changed = !same(merged, mineBefore);
    if (changed) {
      const keep = { playbook: s.playbook, bureauBenchmarks: s.bureauBenchmarks, ps: (s.prefill || {}).__ps, empty: (s.include || {}).empty };
      Object.keys(s).forEach(k => { if (!LOCAL.includes(k)) delete s[k]; });
      Object.assign(s, merged);
      if (keep.bureauBenchmarks !== undefined) s.bureauBenchmarks = keep.bureauBenchmarks;
      s.prefill = s.prefill || {}; if (keep.ps !== undefined) s.prefill.__ps = keep.ps;
      s.include = Object.assign({}, s.include || {}, { empty: keep.empty });
      S.store.upgrade(s);
    }
    if (same(merged, shareable(theirs))) {
      // Now exactly the forum's copy: nothing of ours to send.
      s.updatedAt = theirs.updatedAt || s.updatedAt;
      if (rec && key) {
        const pb = s.playbook || {};
        s.playbook = Object.assign({}, pb, { savedAt: Date.now(), asOf: s.updatedAt, key, sha: sha || pb.sha || '', fp: S.playbook.fingerprint(rec) });
      }
    } else if (changed) s.updatedAt = Date.now();
    if (changed || rec) S.store.save(s, true, true);
    return changed;
  }

  // Called by playbook.js while saving, with the station file's copy of the
  // session on screen: if somebody else saved it since, merge theirs in first.
  // → true when the session on screen changed (the save then sends the merge).
  function reconcile(theirs) {
    const A = L.A, s = A && A.session;
    if (!s || !theirs || theirs.id !== s.id) return false;
    const b = base(s.id);
    if (b ? same(shareable(theirs), b) : same(shareable(theirs), shareable(s))) return false;
    const changed = absorb(theirs, null, null, null);
    if (changed) { s.updatedAt = Date.now(); A.remoteChanged(); }
    return changed;
  }
  // Called by playbook.js once a save went through: that is what both agree on now.
  function saved(rec) {
    if (!rec || !rec.session) return;
    setBase(rec.session.id, rec.session);
    if (L.A && L.A.session && L.A.session.id === rec.session.id) { L.mySaved = rec.session.updatedAt || Date.now(); writeSoon(); }
  }

  /* ---------------- who is where ---------------- */
  const path = id => `stations/live-${id}.json`;
  const people = () => ((L.file && L.file.data && L.file.data.people) || {});
  function observe() {
    const now = Date.now();
    Object.entries(people()).forEach(([tab, p]) => {
      const was = L.seen.get(tab);
      if (!was || was.at !== p.at) L.seen.set(tab, { at: p.at, when: now });
    });
  }
  // Somebody else, still there: their line changed lately (our clock — the
  // computers' clocks needn't agree), and isn't from a long time ago (theirs).
  function fresh(tab, p) {
    const s = L.seen.get(tab), now = Date.now();
    return !!s && now - s.when < FRESH_MS() && Math.abs(now - (p.at || 0)) < 10 * 60000;
  }
  function others() {
    return Object.entries(people()).filter(([tab, p]) => tab !== tabId && fresh(tab, p)).map(([tab, p]) => Object.assign({ tab }, p));
  }
  // Who holds a question: everyone in it, less anybody it was taken over from;
  // if two still claim it (both clicked in within the same few seconds), the
  // same one on every computer.
  function holder(u) {
    const claim = others().filter(p => p.unit === u);
    if (L.unit === u) claim.push({ tab: tabId, unit: u, take: L.take, name: myName() });
    const out = claim.filter(p => !claim.some(q => q.take && q.take.unit === u && q.take.from === p.tab));
    out.sort((a, b) => (a.tab < b.tab ? -1 : 1));
    return out[0] || null;
  }
  const holderOther = u => { const p = holder(u); return p && p.tab !== tabId ? p : null; };

  /* ---------------- reading and writing the live file ---------------- */
  async function readLive() {
    const f = await S.shared.getFile(path(L.id));
    L.file = f ? { data: JSON.parse(f.text), sha: f.sha } : null;
    observe();
  }
  async function writeMe(gone) {
    if (!L.id || L.writing) { L.wantWrite = true; return; }
    L.writing = true; L.wantWrite = false;
    const id = L.id;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cur = L.file, data = cur ? U().clone(cur.data) : { schema: 'sort-live/1', id, people: {} };
        data.people = data.people || {};
        const now = Date.now();
        Object.keys(data.people).forEach(t => { const p = data.people[t]; if (t !== tabId && !fresh(t, p) && Math.abs(now - (p.at || 0)) > 3 * 60000) delete data.people[t]; });
        if (gone) delete data.people[tabId];
        else data.people[tabId] = Object.assign({ name: myName(), unit: L.unit, at: now, saved: L.mySaved }, L.take && L.take.unit === L.unit ? { take: L.take } : {});
        try {
          const r = await S.shared.putFile(path(id), JSON.stringify(data), '', cur && cur.sha);
          if (L.id === id) { L.file = { data, sha: r.sha }; L.lastWrite = now; }
          return;
        } catch (e) {
          if (e.status !== 409 || attempt === 2 || L.id !== id) throw e;
          await readLive();
        }
      }
    } catch (e) { if (e.status === 429) L.pausedTill = Date.now() + 60000; }
    finally { L.writing = false; if (L.wantWrite && !gone && L.id) writeSoon(); }
  }
  let writeTimer = null;
  function writeSoon() {
    if (!active()) return;
    clearTimeout(writeTimer);
    const gap = Math.max(T() ? 100 : 1500, (T() ? T() / 2 : 4000) - (Date.now() - L.lastWrite));   // at most one write every few seconds
    writeTimer = setTimeout(() => { writeTimer = null; writeMe(false); }, gap);
  }

  /* ---------------- the loop ---------------- */
  function active() {
    const A = L.A, s = A && A.session;
    return !!(s && S.shared && S.shared.has() && S.playbook && S.playbook.state.status === 'ready' &&
      s.playbook && s.playbook.key && !S.playbook.state.gone.has(s.id) && G.document.visibilityState !== 'hidden');
  }
  function schedule(ms) { clearTimeout(L.timer); L.timer = setTimeout(tick, ms); }
  function leaveSession() {
    if (L.id && L.file && L.file.data && (L.file.data.people || {})[tabId]) writeMe(true);
    L.id = null; L.file = null; L.seen.clear(); L.savedSeen.clear(); L.unit = null; L.take = null; L.mySaved = 0; L.lastWrite = 0; L.needPull = true;
  }
  async function tick() {
    clearTimeout(L.timer);
    const A = L.A, s = A && A.session;
    if (L.id && (!s || s.id !== L.id || !active())) { leaveSession(); bar(); decorate(); }
    if (!active()) { schedule(ALONE_MS()); return; }
    if (Date.now() < L.pausedTill) { schedule(L.pausedTill - Date.now()); return; }
    if (!L.id) { L.id = s.id; L.needPull = true; L.mySaved = (s.playbook && s.playbook.asOf) || 0; }
    try {
      await readLive();
      const ppl = others();
      const savedLater = ppl.some(p => p.saved && p.saved !== L.savedSeen.get(p.tab));
      if ((L.needPull && ppl.length) || savedLater) {   // alone, there is nobody's work to fetch
        L.needPull = false;
        ppl.forEach(p => L.savedSeen.set(p.tab, p.saved));
        await pull();
      }
      // Somebody took over the question we are in: let it go.
      if (L.unit) {
        const by = ppl.find(p => p.take && p.take.from === tabId && p.take.unit === L.unit && p.unit === L.unit);
        if (by) release(`${nameOf(by)} took over “${label(L.unit)}” — your answer there was saved.`);
      }
      if (L.unit && Date.now() - L.unitAt > (L.typing ? IDLE_TYPING_MS() : IDLE_CLICK_MS())) release(null);
      const mine = people()[tabId];
      if (!mine || (mine.unit || null) !== L.unit || Date.now() - L.lastWrite > BEAT_MS(!!L.unit)) await writeMe(false);
      bar(); decorate();
      schedule(ppl.length ? pace(ppl.length) : ALONE_MS());
    } catch (e) {
      if (e.status === 429) L.pausedTill = Date.now() + 60000;
      schedule(e.status === 429 ? 60000 : ALONE_MS());
    }
  }
  async function pull() {
    const A = L.A, s = A.session, key = s.playbook && s.playbook.key;
    if (!key) return;
    const f = await S.playbook.loadStation(key, true);
    const rec = f && (f.data.sessions || []).find(x => x.id === s.id);
    if (!rec || !rec.session || A.session !== s) return;
    if (absorb(rec.session, rec, key, f.sha)) A.remoteChanged();
    else S.playbook.renderActs(A);
  }
  function now() { schedule(0); }

  /* ---------------- which question this tab is in ---------------- */
  function unitOfEl(el) {
    // The lock's own Take over button doesn't count as being in the question.
    const c = el && el.closest && !el.closest('.live-lock') && el.closest('#form [data-q], #ps [data-ps]');
    if (!c) return null;
    return c.dataset.q ? 'q:' + c.dataset.q : 'ps:' + c.dataset.ps;
  }
  const cardOf = u => (u.startsWith('q:') ? G.document.querySelector(`#form [data-q="${CSS.escape(u.slice(2))}"]`) : G.document.querySelector(`#ps [data-ps="${CSS.escape(u.slice(3))}"]`));
  function label(u) {
    const c = cardOf(u), l = c && c.querySelector('.q-label');
    return l ? l.textContent.trim() : u.slice(u.indexOf(':') + 1);
  }
  const isTyping = el => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(el.type)));
  function claim(u, el) {
    if (u !== L.unit) {
      if (L.unit && others().length && S.playbook) S.playbook.flush(L.A);   // the question left: its answer goes now
      L.unit = u; if (!u || !L.take || L.take.unit !== u) L.take = null;
      writeSoon();
    }
    L.unitAt = Date.now(); L.typing = isTyping(el);
  }
  function release(msg) {
    const u = L.unit; if (!u) return;
    const card = cardOf(u), act = G.document.activeElement;
    L.unit = null; L.take = null;
    if (card && act && card.contains(act)) act.blur();
    if (S.playbook) S.playbook.flush(L.A);
    writeSoon();
    if (msg && L.A) L.A.toast(msg);
  }
  function takeOver(u) {
    const p = holderOther(u); if (!p) return;
    L.take = { unit: u, from: p.tab };
    L.unit = u; L.unitAt = Date.now(); L.typing = true;
    writeMe(false).then(() => { bar(); decorate(); });
    decorate();
    const c = cardOf(u), f = c && c.querySelector('input, textarea, select, button.opt, button:not(.live-take)');
    if (f) f.focus();
  }
  function onFocusIn(ev) { const u = unitOfEl(ev.target); if (u) claim(u, ev.target); }
  function onFocusOut() {
    setTimeout(() => { const u = unitOfEl(G.document.activeElement); if (u !== L.unit) claim(u, G.document.activeElement); }, 250);
  }
  function onActivity(ev) { const u = unitOfEl(ev.target); if (u && u === L.unit) { L.unitAt = Date.now(); if (isTyping(ev.target)) L.typing = true; } }

  /* ---------------- what it looks like ---------------- */
  // A question somebody else is in: greyed, out of reach, marked with who — and Take over.
  function decorate() {
    G.document.querySelectorAll('.live-lock').forEach(x => x.remove());
    G.document.querySelectorAll('.live-locked').forEach(c => { c.classList.remove('live-locked'); [...c.children].forEach(k => k.removeAttribute('inert')); });
    if (!L.id) return;
    const seen = new Set();
    others().forEach(p => {
      if (!p.unit || seen.has(p.unit)) return;
      seen.add(p.unit);
      const who = holderOther(p.unit); if (!who) return;
      const c = cardOf(p.unit); if (!c) return;
      [...c.children].forEach(k => k.setAttribute('inert', ''));
      c.classList.add('live-locked');
      c.appendChild(h('div', { class: 'live-lock', role: 'status' },
        h('span', { class: 'live-who' }, `✎ ${nameOf(who)} is editing this`),
        h('button', { type: 'button', class: 'btn btn-mini live-take', title: `Edit it yourself — ${nameOf(who)} is moved out of it, and what they typed so far is kept`, onclick: () => takeOver(p.unit) }, 'Take over')));
    });
  }
  // The bar at the top: who else is in this session, and where.
  let nameBox = null;   // kept between redraws, so a name half typed isn't wiped
  function bar() {
    const el = G.document.getElementById('liveBar'); if (!el) return;
    const ppl = L.id ? others() : [];
    if (!ppl.length) { el.innerHTML = ''; el.hidden = true; return; }
    const keep = !myName() && nameBox && el.contains(nameBox) ? nameBox : null;
    el.innerHTML = '';
    el.hidden = false;
    const list = [];
    ppl.forEach((p, i) => {
      if (i) list.push(document.createTextNode(', '));
      list.push(h('b', null, nameOf(p)));
      if (p.unit && holderOther(p.unit) && holderOther(p.unit).tab === p.tab) list.push(document.createTextNode(` (in “${label(p.unit)}”)`));
    });
    el.appendChild(h('span', { title: 'Their changes show here within about ten seconds, and yours on their screens. A question somebody is in is greyed for the others until they leave it (or somebody presses Take over).' },
      '👥 Also in this session: ', ...list, '.'));
    if (keep) { el.appendChild(keep); return; }
    if (!myName()) {
      const input = h('input', { type: 'text', id: 'liveName', placeholder: 'Your name', maxlength: '40', autocomplete: 'off' });
      const go = () => { if (input.value.trim()) { nameBox = null; setName(input.value); } };
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
      nameBox = h('span', { class: 'live-name' }, ' They see you as “Someone on another computer” — your name: ', input, h('button', { type: 'button', class: 'btn btn-mini', onclick: go }, 'Use it'));
      el.appendChild(nameBox);
    }
  }

  function init(A) {
    L.A = A;
    G.document.addEventListener('focusin', onFocusIn);
    G.document.addEventListener('focusout', onFocusOut);
    ['input', 'click', 'keydown'].forEach(t => G.document.addEventListener(t, onActivity, true));
    G.document.addEventListener('visibilitychange', () => {
      if (G.document.visibilityState === 'hidden') { if (L.id) leaveSession(); bar(); decorate(); }
      else now();
    });
    G.addEventListener('pagehide', () => { if (L.id) leaveSession(); });
    schedule(1500);
  }

  S.live = { init, now, decorate, reconcile, saved, merge3, unitOf, holder, setName, state: L, tab: () => tabId };
})(typeof window !== 'undefined' ? window : globalThis);
