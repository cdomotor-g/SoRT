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
    changed, hint, focusMapOn, drawOnMap, toast, newSession, openSession, refreshStation
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
        A.defs = d; A.defsSource = t.name; A.defsNote = notes.join(' ');
        return;
      } catch (e) { notes.push(`${t.name}: ${e.message || e}`); }
    }
    throw new Error('No definitions could be loaded. ' + notes.join(' '));
  }

  /* ---------------- session plumbing ---------------- */
  const saveSoon = U.debounce(() => { if (A.session) S.store.save(A.session); renderSavedChip(); }, 400);
  const previewSoon = U.debounce(renderPreview, 350);
  function rebuild() { A.ctx = R.context(A.defs, A.session); }

  // Anything changed. `light` = typing in a box: no re-render of the form (so
  // the caret stays put), just the things that read the answers.
  function changed(opts) {
    rebuild();
    if (!(opts && opts.light)) { S.form.render($('#form')); S.form.renderPS($('#ps')); renderStation(); }
    renderProgress(); renderFollowUps(); previewSoon(); saveSoon();
    if (S.playbook) S.playbook.renderActs(A);
    if (S.mapView) S.mapView.sync(A);
  }
  function hint(key) {
    if (key.startsWith('station.')) return S.floodnet.hint(A.session.station, key);
    if (key.startsWith('map.') && S.mapView) return S.mapView.hint(key);
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

  function newSession(station) {
    if (A.session) S.store.save(A.session);
    A.session = S.store.newSession(A.defs);
    if (station) A.session.station = station;
    A.picture = null;
    if (S.mapView) S.mapView.reset();
    rebuild(); renderAll();
  }
  function openSession(id) {
    const s = S.store.load(id);
    if (!s) { toast('That session is no longer saved in this browser.'); return; }
    if (A.session) S.store.save(A.session);
    A.session = s; A.picture = null;
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
      txt.appendChild(h('button', { type: 'button', class: 'link', title: 'Answers filled in from Flood-Net, the map or a precedent that nobody has checked yet', onclick: () => {
        const el = document.querySelector('.q.waiting'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
      } }, `${p.toConfirm} to confirm`));
    }
    const st = A.session.station;
    $('#stationChip').textContent = st && st.name ? `${st.name}${st.number ? ' · ' + st.number : ''}` : 'No station yet';
  }
  function renderSavedChip() {
    const s = A.session; if (!s) return;
    const pb = s.playbook && s.playbook.savedAt;
    $('#savedChip').textContent = `Saved in this browser ${U.fmtClock(s.updatedAt)}${pb ? ' · playbook ' + U.fmtClock(pb) : ''}`;
  }

  /* ---------------- forum bar ---------------- */
  function renderForum() {
    const f = A.session.forum;
    const root = $('#forum'); root.innerHTML = '';
    const date = h('input', { type: 'date', id: 'forumDate', value: f.date });
    date.addEventListener('change', ev => { f.date = ev.target.value; changed(); });
    const chips = h('div', { class: 'chips', id: 'attendeeChips' });
    const drawChips = () => {
      chips.innerHTML = '';
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
    root.appendChild(h('div', { class: 'forum-grid' },
      h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'SoRT Forum date'), date),
      h('div', { class: 'fld fld-grow' }, h('label', { class: 'fld-label', for: 'attendeeInput' }, 'Attendees'), h('div', { class: 'chips-box' }, chips, add), reuse),
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
    else root.appendChild(stationCard(st));
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
        status.textContent = rows.length ? '' : 'No station by that name or number in Flood-Net. You can enter it by hand below.';
      } catch (e) {
        if (my !== searchSeq) return;
        rows = []; draw();
        status.textContent = `Flood-Net didn’t answer (${e.message}). Enter the station by hand below.`;
      }
    }, 250);
    input.addEventListener('input', ev => run(ev.target.value));
    input.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); draw(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && rows[active]) { ev.preventDefault(); pick(rows[active]); }
      else if (ev.key === 'Escape' && replacing) renderStation();
    });
    const manual = h('details', { class: 'manual' }, h('summary', null, 'Not in Flood-Net? Enter it by hand'), manualForm());
    const box = h('div', { class: 'station-find' }, input, status, list, manual);
    const card = root.querySelector('.station-card');
    if (card) root.insertBefore(box, card); else root.appendChild(box);
    setTimeout(() => input.focus(), 0);
  }
  function manualForm() {
    const name = h('input', { type: 'text', placeholder: 'Station name' });
    const num = h('input', { type: 'text', placeholder: 'Bureau number (if any)' });
    const pos = h('input', { type: 'text', placeholder: 'Latitude, longitude (e.g. -27.4710, 153.0234)' });
    const go = h('button', { type: 'button', class: 'btn', onclick: () => {
      const p = U.parseCoord(pos.value);
      if (!name.value.trim()) { toast('Give the station a name.'); return; }
      if (pos.value.trim() && !p.ok) { toast(p.error || 'That position doesn’t read as coordinates.'); return; }
      setStation({ source: 'manual', id: '', number: num.value.trim(), name: name.value.trim(), lat: p.ok ? p.lat : null, lon: p.ok ? p.lon : null,
        precision: p.ok ? U.coordPrecision(p.lat, p.lon) : null, kinds: [], roles: [], alertIds: [], acma: [] });
    } }, 'Use this station');
    return h('div', { class: 'manual-grid' }, name, num, pos, go);
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
    if (busy && had.id !== facts.id) {
      // A different station on a session with answers: keep that one, start afresh.
      newSession(facts);
      toast(`New session for ${facts.name}. The previous one is under Sessions.`);
    } else {
      if (had && had.id === facts.id && had.checked) facts.checked = had.checked;
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
    try { const f = await S.floodnet.stationFacts(st.id); f.checked = st.checked; A.session.station = f; S.floodnet.applyPrefill(A.defs, A.session); changed(); toast('Station refreshed from Flood-Net.'); }
    catch (e) { toast(`Flood-Net didn’t answer (${e.message}).`); }
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
      h('div', { class: 'st-title' }, h('span', { class: 'st-name' }, st.name), st.number ? h('span', { class: 'st-num' }, st.number) : null,
        (st.kinds || []).map(k => h('span', { class: 'tag' }, fn.KIND_LABEL[k] || k)),
        st.proposed ? h('span', { class: 'tag warn' }, 'proposed') : null,
        st.source === 'manual' ? h('span', { class: 'tag' }, 'entered by hand') : null),
      facts.length ? h('dl', { class: 'st-facts' }, facts) : null,
      h('div', { class: 'st-links' },
        st.app ? h('a', { href: st.app, target: '_blank', rel: 'noopener' }, 'Open in Flood-Net ↗') : null,
        st.source === 'floodnet' ? h('button', { type: 'button', class: 'link', onclick: refreshStation }, 'Refresh from Flood-Net') : null),
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
    const list = R.followUps(A.ctx);
    root.innerHTML = '';
    if (!list.length) { root.appendChild(h('p', { class: 'muted' }, 'None — the answers so far don’t call for any.')); return; }
    const st = A.session.followUpState;
    list.forEach(f => {
      const s = st[f.id] = st[f.id] || {};
      const box = h('input', { type: 'checkbox', checked: f.done, disabled: f.doneAuto, title: f.doneAuto ? 'Done — the answer it was waiting for is in' : 'Tick when done' });
      box.addEventListener('change', ev => { s.status = ev.target.checked ? 'done' : 'open'; s.at = Date.now(); changed({ light: true }); });
      root.appendChild(h('div', { class: 'fu' + (f.done ? ' done' : '') },
        h('label', { class: 'fu-check' }, box),
        h('div', { class: 'fu-body' },
          h('div', null, h('span', { class: 'owner' }, f.owner), ' ', f.text, f.link ? [' ', h('a', { href: f.link.url, target: '_blank', rel: 'noopener' }, f.link.label + ' ↗')] : null),
          h('div', { class: 'fu-meta' }, f.table === 'ps' ? 'Goes in the Property Services table' : f.table === 'scope' ? 'Goes in the scope table’s Follow-up Actions row' : '', f.done ? ' · done' : ''))));
    });
  }
  function renderOutputControls() {
    const s = A.session, inc = s.include;
    const root = $('#outputControls'); root.innerHTML = '';
    const tick = (key, label, title) => {
      const i = h('input', { type: 'checkbox', checked: inc[key] });
      i.addEventListener('change', ev => { inc[key] = ev.target.checked; changed({ light: true }); });
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
      tick('header', 'Title, date and attendees'), tick('station', 'Station row'), tick('empty', 'Rows with nothing filled in'),
      tick('followUps', 'Follow-up actions'), tick('map', 'Map picture'), tick('marks', 'Survey marks table'), tick('ps', 'Property Services table')));
  }
  function renderPreview() {
    const root = $('#preview'); if (!root || !A.ctx) return;
    const out = S.word.build(A.ctx, A.session.include.map ? A.picture : null);
    root.innerHTML = out.html;
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
  function downloadSession() {
    const blob = new Blob([JSON.stringify(A.session, null, 2)], { type: 'application/json' });
    const st = A.session.station || {};
    const name = `sort-session-${(st.number || st.name || 'station').toString().replace(/[^\w.-]+/g, '-')}-${A.session.forum.date}.json`;
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function importSession(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = S.store.upgrade(JSON.parse(r.result));
        if (!s || !s.id || s.schema !== 'sort-session/1') throw new Error('not a SoRT session file');
        S.store.save(s); openSession(s.id);
      } catch (e) { toast(`Couldn’t open that file: ${e.message}`); }
    };
    r.readAsText(file);
  }

  /* ---------------- sessions dialog ---------------- */
  function openSessions() {
    const dlg = $('#sessionsDlg'), list = $('#sessionsList');
    list.innerHTML = '';
    const idx = S.store.index();
    if (!idx.length) list.appendChild(h('p', { class: 'muted' }, 'No sessions saved in this browser yet.'));
    const outcomes = Object.fromEntries(((A.defs.session || {}).outcomes || []).map(o => [o.code, o.label]));
    idx.forEach(x => {
      const cur = A.session && x.id === A.session.id;
      list.appendChild(h('div', { class: 'sess' + (cur ? ' current' : '') },
        h('div', { class: 'sess-main' },
          h('div', { class: 'sess-name' }, x.name || 'No station', x.number ? h('span', { class: 'res-num' }, x.number) : null, cur ? h('span', { class: 'tag' }, 'open') : null),
          h('div', { class: 'res-meta' }, [(S.schema.template(A.defs, x.template) || {}).label, x.forumDate && `forum ${U.dmy(x.forumDate)}`, x.outcome && outcomes[x.outcome],
            `changed ${U.fmtWhen(x.updatedAt)}`, x.playbookAt ? 'in the playbook' : 'only in this browser'].filter(Boolean).join(' · '))),
        h('div', { class: 'sess-acts' },
          cur ? null : h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); openSession(x.id); } }, 'Open'),
          h('button', { type: 'button', class: 'btn btn-quiet', title: 'Forget this session in this browser', onclick: () => {
            if (!confirm(`Forget the session for ${x.name || 'this station'} in this browser?${x.playbookAt ? '' : ' It has not been saved to the playbook.'}`)) return;
            S.store.remove(x.id);
            if (cur) newSession();
            openSessions();
          } }, 'Forget'))));
    });
    if (S.playbook) list.appendChild(S.playbook.followUpsPanel(A));
    if (!dlg.open) dlg.showModal();
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
    if (S.playbook) S.playbook.renderActs(A);
    if (S.mapView) { S.mapView.station(A); S.mapView.sync(A); }
  }
  async function boot() {
    initTheme();
    S.form.bind(A);
    try { await loadDefs(); }
    catch (e) { $('#bootMsg').textContent = e.message; $('#bootMsg').classList.add('error'); return; }
    $('#bootMsg').remove();
    if (A.defsNote) { const b = $('#banner'); b.textContent = A.defsNote; b.hidden = false; }
    $('#defsChip').textContent = `Questions v${A.defs.version} · from ${A.defsSource}`;
    A.session = S.store.current() || S.store.newSession(A.defs);
    if (!S.schema.template(A.defs, A.session.template)) A.session.template = A.defs.templates[0].id;
    rebuild();
    U.$$('.copy-btn').forEach(b => b.addEventListener('click', copyForWord));
    $('#sessionsBtn').addEventListener('click', openSessions);
    $('#newSessionBtn').addEventListener('click', () => { $('#sessionsDlg').close(); newSession(); toast('New session started.'); });
    $('#downloadBtn').addEventListener('click', downloadSession);
    $('#importInput').addEventListener('change', ev => { if (ev.target.files[0]) importSession(ev.target.files[0]); ev.target.value = ''; });
    $('#sessionsClose').addEventListener('click', () => $('#sessionsDlg').close());
    G.addEventListener('beforeunload', () => { saveSoon.flush(); if (A.session) S.store.save(A.session); });
    if (S.mapView) S.mapView.mount($('#mapMount'), A);
    if (S.playbook) S.playbook.init(A);
    renderAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
