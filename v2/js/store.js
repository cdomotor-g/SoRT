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

  const DEFAULT_INCLUDE = { header: true, station: true, empty: false, followUps: true, ps: true, map: true, marks: true, bridges: true, bureauBM: true };
  // "Rows with nothing filled in" is this browser's choice, not the session's:
  // off until someone here ticks it (sortv2.pref.empty), then as they left it
  // for every session opened here.
  const LS_EMPTY = P + 'pref.empty';
  function includeEmpty() { return U().LS.get(LS_EMPTY) === '1'; }
  function rememberEmpty(on) { U().LS.set(LS_EMPTY, on ? '1' : '0'); }
  const startInclude = () => Object.assign({}, DEFAULT_INCLUDE, { empty: includeEmpty() });

  function forumDay() {
    const f = U().LS.json(P + 'forum', null);
    const today = U().todayIso();
    // A new session takes today's date, unless someone picked another date in
    // the forum bar today (dateChosen). Saving or opening an older session never
    // moves it: that once dated every new session to an older forum's day.
    if (f && f.savedOn === today) return { date: (f.dateChosen && f.date) || today, attendees: f.attendees || [], outOfSession: !!f.outOfSession, last: f.attendees || [] };
    return { date: today, attendees: [], outOfSession: false, last: (f && f.attendees) || [] };
  }
  function rememberForum(forum, opts) {
    const today = U().todayIso(), was = U().LS.json(P + 'forum', null) || {};
    const keep = was.savedOn === today && was.dateChosen;
    const chosen = opts && opts.dateChosen ? forum.date !== today : keep;
    U().LS.set(P + 'forum', JSON.stringify({ date: chosen ? (opts && opts.dateChosen ? forum.date : was.date) : today, dateChosen: !!chosen,
      attendees: forum.attendees, outOfSession: forum.outOfSession, savedOn: today }));
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
      include: startInclude(),
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
    s.include = Object.assign({}, DEFAULT_INCLUDE, s.include || {}, { empty: includeEmpty() });
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

  // A session with no station is not kept: it is what "New session" or opening
  // the page leaves behind before a station is picked (one shared with the
  // forum is always kept). It is not saved, and an old saved one is dropped.
  function blank(s) {
    if (!s || (s.playbook && s.playbook.savedAt)) return false;
    return !(s.station && (s.station.name || s.station.number || s.station.id));
  }
  // Forget blank sessions an earlier version saved.
  function pruneBlank() {
    index().forEach(x => { if (!x.name && !x.number && !x.stationId && !x.playbookAt) { const s = load(x.id); if (!s || blank(s)) remove(x.id); } });
  }

  // keepTime: a copy brought in as it was (from the playbook) keeps its own time.
  function save(s, keepTime) {
    if (blank(s)) { if (!s.playbook) remove(s.id); return true; }
    if (!keepTime || !s.updatedAt) s.updatedAt = Date.now();
    const key = P + 's.' + s.id, text = JSON.stringify(s);
    let ok = U().LS.set(key, text);
    // The browser's storage is full (it is shared with every cdomotor-g.github.io
    // page): make room by forgetting the oldest sessions the forum already holds
    // unchanged, then try again. Never one that exists only here.
    if (!ok) {
      const spare = index().filter(x => x.id !== s.id && x.playbookAt && (x.updatedAt || 0) <= x.playbookAt);
      for (let k = spare.length - 1; k >= 0 && !ok; k--) {
        U().LS.del(P + 's.' + spare[k].id); writeIndex(index().filter(x => x.id !== spare[k].id));
        ok = U().LS.set(key, text);
      }
    }
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
    // Only a session started today speaks for today's forum (its attendees).
    if (U().dmy(U().todayIso()) === U().fmtWhen(s.createdAt).slice(0, 10)) rememberForum(s.forum);
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

  S.store = { newSession, upgrade, save, update, load, current, remove, blank, pruneBlank, index, forumDay, rememberForum, rememberEmpty, includeEmpty, DEFAULT_INCLUDE, PREFIX: P };
})(typeof window !== 'undefined' ? window : globalThis);
