/* SoRT v2 — store.js
   Sessions, saved in this browser as you go, so a reload or a crashed tab never
   loses a forum's work (v1 kept no answers at all). One session = one station
   at one forum sitting. The playbook (playbook.js) shares each one with the
   forum by itself; this is the safety net underneath it.

   Keys all start "sortv2." — v1's "Clear cache" removes only "sort." keys, so
   it can never wipe these, and v2 never touches v1's.
     sortv2.index         [{id, name, number, template, forumDate, outcome, updatedAt, playbookAt}]
     sortv2.s.<id>        the session itself
     sortv2.current       the session on screen
     sortv2.forum         the forum day: {date, attendees[], outOfSession, savedOn}

   Session shape (schema "sort-session/1"; field names chosen to flatten into
   tables for a later Dataverse import — see v2/README.md):
     { id, schema, definitionsVersion, createdAt, updatedAt,
       forum:{date, attendees[], outOfSession}, outcome, outcomeNote,
       station:{ source, id, number, name, lat, lon, kinds[], roles[], hubId, hubName,
                 lga, owner, alertIds{}, commsGuess, txFrequency, repeater, acmaLicence,
                 fadeMargin, checked:{lat, lon, movedM, at} } | null,
       template, answers{}, prefill{}, ps{answers, dirty, comments, general},
       map:{ features[], hiddenMarks[], marks[], bridges[] },
       followUpState{}, include{}, playbook:{savedAt, asOf, key, sha, fp, allowed[]} }                     */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const P = 'sortv2.';
  const MAX_KEPT = 80;

  const DEFAULT_INCLUDE = { header: true, station: true, empty: true, followUps: true, ps: true, map: true, marks: true, bridges: true, bureauBM: true };

  function forumDay() {
    const f = U().LS.json(P + 'forum', null);
    const today = U().todayIso();
    if (f && f.savedOn === today) return { date: f.date || today, attendees: f.attendees || [], outOfSession: !!f.outOfSession, last: f.attendees || [] };
    return { date: today, attendees: [], outOfSession: false, last: (f && f.attendees) || [] };
  }
  function rememberForum(forum) {
    U().LS.set(P + 'forum', JSON.stringify({ date: forum.date, attendees: forum.attendees, outOfSession: forum.outOfSession, savedOn: U().todayIso() }));
  }

  function newSession(defs) {
    const f = forumDay(), now = Date.now();
    return {
      id: U().uuid(), schema: 'sort-session/1', definitionsVersion: defs.version,
      createdAt: now, updatedAt: now,
      forum: { date: f.date, attendees: f.attendees.slice(), outOfSession: f.outOfSession },
      outcome: null, outcomeNote: '',
      station: null,
      template: (defs.templates[0] || {}).id,
      answers: {}, prefill: {},
      ps: { answers: {}, dirty: {}, comments: {}, general: '' },
      map: { features: [], hiddenMarks: [], marks: [], bridges: [] },
      followUpState: {},
      include: Object.assign({}, DEFAULT_INCLUDE),
      playbook: null
    };
  }
  // Bring a stored (or imported) session up to the current shape.
  function upgrade(s) {
    if (!s || typeof s !== 'object') return null;
    s.answers = s.answers || {}; s.prefill = s.prefill || {};
    s.ps = Object.assign({ answers: {}, dirty: {}, comments: {}, general: '' }, s.ps || {});
    s.map = Object.assign({ features: [], hiddenMarks: [], marks: [], bridges: [] }, s.map || {});
    s.followUpState = s.followUpState || {};
    s.include = Object.assign({}, DEFAULT_INCLUDE, s.include || {});
    s.forum = Object.assign({ date: U().todayIso(), attendees: [], outOfSession: false }, s.forum || {});
    return s;
  }

  function index() { return U().LS.json(P + 'index', []); }
  function writeIndex(list) { U().LS.set(P + 'index', JSON.stringify(list)); }
  function summary(s) {
    const st = s.station || {};
    return { id: s.id, name: st.name || '', number: st.number || '', stationId: st.source === 'floodnet' ? (st.id || '') : '', template: s.template,
      forumDate: (s.forum || {}).date || '', outcome: s.outcome || null, updatedAt: s.updatedAt,
      playbookAt: (s.playbook && s.playbook.savedAt) || null };
  }

  // keepTime: a copy brought in as it was (from the playbook) keeps its own time.
  function save(s, keepTime) {
    if (!keepTime || !s.updatedAt) s.updatedAt = Date.now();
    const ok = U().LS.set(P + 's.' + s.id, JSON.stringify(s));
    const list = index().filter(x => x.id !== s.id);
    list.unshift(summary(s));
    // Keep the newest MAX_KEPT; past that, forget the oldest that the playbook
    // already holds (never one that exists only here).
    while (list.length > MAX_KEPT) {
      let i = -1;
      for (let k = list.length - 1; k >= 0; k--) if (list[k].playbookAt) { i = k; break; }
      if (i < 0) break;
      U().LS.del(P + 's.' + list[i].id); list.splice(i, 1);
    }
    writeIndex(list);
    U().LS.set(P + 'current', s.id);
    rememberForum(s.forum);
    return ok;
  }
  // Write a session back exactly as it is — its time, its place in the list and
  // which session is open all unchanged (the playbook noting that it was shared).
  function update(s) {
    if (!U().LS.get(P + 's.' + s.id)) return false;
    const ok = U().LS.set(P + 's.' + s.id, JSON.stringify(s));
    const list = index(), i = list.findIndex(x => x.id === s.id);
    if (i >= 0) { list[i] = summary(s); writeIndex(list); }
    return ok;
  }
  function load(id) { return upgrade(U().LS.json(P + 's.' + id, null)); }
  function current() { const id = U().LS.get(P + 'current'); return id ? load(id) : null; }
  function remove(id) {
    U().LS.del(P + 's.' + id);
    writeIndex(index().filter(x => x.id !== id));
    if (U().LS.get(P + 'current') === id) U().LS.del(P + 'current');
  }

  S.store = { newSession, upgrade, save, update, load, current, remove, index, forumDay, rememberForum, DEFAULT_INCLUDE, PREFIX: P };
})(typeof window !== 'undefined' ? window : globalThis);
