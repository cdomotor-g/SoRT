/* SoRT v2 — benchmarks.js
   The Bureau's benchmarks (HDB's Benchmark Details) for the Local TBM question.

   Flood-Net keeps them for its editors only, so they never come through its
   public API. Instead SoRT opens a Flood-Net tab (#benchmarks-for-sort=…), a
   signed-in editor there checks the station's marks and presses Send to SoRT,
   and Flood-Net posts them to this tab alone (window.opener.postMessage, target
   origin cdomotor-g.github.io). If the tab can't be reached (a sign-in round trip
   can lose it), Flood-Net's Copy for SoRT gives a text this page's Paste from
   Flood-Net reads. Contract: Flood-Net's atlas `benchmarks-for-sort`.

   Not to be confused with the State survey marks (QSpatial's PSMs, S1–S5 on the
   map): those are public and found by the map. These are the station's own
   marks, B1, B2…, with a level, a datum, the height on the gauge where Flood-Net
   can work it out, what each is and where. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const h = (...a) => U().h(...a);
  const FN = 'https://floodwarning.net';
  const DATUMS = ['AHD', 'STATE', 'ASSUM', 'UNKNOWN'];
  const DATUM_TEXT = { AHD: 'AHD', STATE: 'State datum', ASSUM: 'assumed datum', UNKNOWN: 'datum unknown' };
  // Plain words for the hover and the fold.
  const WORDS = {
    bureau: 'The station’s own benchmarks, as the Bureau’s HDB lists them (its Benchmark Details report). They are not the State survey marks on the map.',
    AHD: 'Australian Height Datum: heights above mean sea level, the national datum.',
    STATE: 'Queensland’s State datum, used before AHD. It differs from AHD by centimetres to decimetres from place to place.',
    ASSUM: 'An assumed datum: a level made up at the site (often 100.000 at one mark). It compares only with levels on the same assumption at this site.',
    UNKNOWN: 'The Bureau does not record which datum this level is in.',
    lgh: 'Local gauge height: the mark’s level on the gauge’s own scale — its level less the gauge zero. Flood-Net works it out only when both are AHD or both State datum.'
  };
  const KEY = st => (st ? (st.source === 'floodnet' && st.id ? `fn:${st.id}` : st.number ? `no:${st.number}` : '') : '');
  const m3 = v => (v == null || !isFinite(v) ? '' : Number(v).toFixed(3));
  const label = m => `B${m.ord + 1}`;

  let pending = null;     // { nonce, key } — the request this tab is waiting on

  function nonce() { return U().uuid().replace(/[^A-Za-z0-9]/g, '').slice(0, 24); }
  const b64url = text => S.github.b64encode(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = s => S.github.b64decode(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));

  // What came from Flood-Net, checked: it is another site's data.
  function clean(d) {
    if (!d || d.type !== 'floodnet:benchmarks' || d.v !== 1 || !Array.isArray(d.benchmarks) || !d.station) return null;
    const txt = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const marks = d.benchmarks.slice(0, 60).map((b, i) => ({
      ord: Number.isInteger(b && b.ord) && b.ord >= 0 ? b.ord : i,
      level: num(b && b.level_m), datum: DATUMS.includes(b && b.datum) ? b.datum : 'UNKNOWN',
      onGauge: num(b && b.on_gauge_m), description: txt(b && b.description, 1200), comment: txt(b && b.comment, 1200)
    })).filter(m => m.level != null);
    return { station: { id: txt(d.station.id, 120) || '', number: txt(d.station.number, 20) || '' },
      printedOn: /^\d{4}-\d{2}-\d{2}$/.test(d.printed_on || '') ? d.printed_on : null, nonce: txt(d.nonce, 64), marks };
  }
  const sameStation = (st, got) => !!st && ((st.source === 'floodnet' && st.id && got.station.id === st.id)
    || (st.number && got.station.number && String(+st.number) === String(+got.station.number)));

  function store(A, got, how) {
    const st = A.session.station;
    if (!sameStation(st, got)) { A.toast(`Those benchmarks are for another station (${got.station.number || got.station.id}), so they weren’t used.`); return false; }
    A.session.bureauBenchmarks = { key: KEY(st), at: Date.now(), printedOn: got.printedOn, marks: got.marks, via: how };
    pending = null;
    A.changed();
    A.toast(got.marks.length ? `${got.marks.length} Bureau benchmark${got.marks.length > 1 ? 's' : ''} from Flood-Net — Use one for the Local TBM.` : 'Flood-Net says HDB lists no benchmarks for this station.');
    return true;
  }
  function current(s) {
    const b = s.bureauBenchmarks, st = s.station;
    return b && st && b.key === KEY(st) ? b : null;
  }

  function request(A) {
    const st = A.session.station;
    if (!st || !(st.id || st.number)) { A.toast('Choose the station first — Flood-Net finds its benchmarks by its Flood-Net id or Bureau number.'); return; }
    pending = { nonce: nonce(), key: KEY(st) };
    const payload = { v: 1, source: 'sort', nonce: pending.nonce,
      station: { id: st.source === 'floodnet' ? st.id : '', number: st.number || '', name: st.name || '' } };
    // A named tab, opener kept: Flood-Net answers this tab through it.
    const w = G.open(`${FN}/#benchmarks-for-sort=${b64url(JSON.stringify(payload))}`, 'floodnet-sort-bridge');
    if (!w) A.toast('The browser stopped the Flood-Net tab opening — allow pop-ups for this page, or use Paste from Flood-Net.');
    A.changed({ light: true });
    S.form.render(document.getElementById('form'));
  }
  function paste(A) {
    const t = (G.prompt('Paste what Flood-Net’s Copy for SoRT gave you:') || '').trim();
    if (!t) return;
    let got = null;
    try { if (t.startsWith('floodnet-benchmarks:')) got = clean(JSON.parse(unb64url(t.slice('floodnet-benchmarks:'.length)))); } catch (_) { got = null; }
    if (!got) { A.toast('That isn’t what Flood-Net’s Copy for SoRT gives — copy it again there.'); return; }
    store(A, got, 'paste');
  }
  function listen(A) {
    G.addEventListener('message', ev => {
      if (ev.origin !== FN) return;
      const got = clean(ev.data);
      if (!got) return;
      if (!pending || got.nonce !== pending.nonce) return;   // not this tab's request
      store(A, got, 'floodnet');
    });
  }

  // Use a mark for the Local TBM: its AHD level, or else its height on the gauge.
  function useFor(m) {
    if (m.datum === 'AHD') return { option: 'ahd', value: m3(m.level) };
    if (m.onGauge != null) return { option: 'lgh', value: m3(m.onGauge) };
    return null;
  }
  function locationText(m, b) {
    const bits = [m.description || 'No description in HDB'];
    if (m.datum === 'AHD' && m.onGauge != null) bits.push(`${m3(m.onGauge)} m on the gauge (LGH)`);
    if (m.datum !== 'AHD') bits.push(`${m3(m.level)} m ${DATUM_TEXT[m.datum]}`);
    if (m.comment) bits.push(`HDB comment: ${m.comment}`);
    return `${bits.join(' — ')} (Bureau benchmark ${label(m)}, HDB Benchmark Details${b.printedOn ? ' ' + U().dmy(b.printedOn) : ''})`;
  }
  function use(A, m) {
    const b = current(A.session), u = useFor(m);
    if (!b || !u) return;
    const s = A.session, a = s.answers.localTbm = s.answers.localTbm || { value: null, fields: {} };
    a.fields = a.fields || {};
    a.value = u.option; a.fields.value = u.value; a.fields.location = locationText(m, b);
    A.changed();
    A.toast(`Local TBM: Bureau benchmark ${label(m)}, ${u.value} m ${u.option === 'ahd' ? 'AHD' : 'on the gauge (LGH)'}.`);
  }
  const inUse = (A, m) => { const a = A.session.answers.localTbm; return !!(a && a.fields && String(a.fields.location || '').includes(`(Bureau benchmark ${label(m)},`)); };

  // The block on the Local TBM question.
  function node(A) {
    const st = A.session.station, b = current(A.session);
    const term = (t, k) => h('span', { class: 'term', title: WORDS[k] }, t);
    const head = h('div', null, h('b', null, term('Bureau benchmarks (HDB)', 'bureau')), ' — the station’s own marks, from Flood-Net. ',
      h('span', { class: 'hint' }, 'Not the State survey marks on the map.'));
    const box = h('div', { class: 'q-note info q-hint bbm', 'data-hint': 'bureau.benchmarks' }, head);
    const acts = (...x) => h('div', { class: 'bbm-acts' }, ...x);
    const getBtn = again => h('button', { type: 'button', class: 'btn-mini', onclick: () => request(A),
      title: 'Opens Flood-Net: sign in there as an editor and press Send to SoRT. Its benchmarks come back to this tab only.' }, again ? 'Get them again ↗' : 'Get them from Flood-Net ↗');
    const pasteBtn = h('button', { type: 'button', class: 'link', onclick: () => paste(A), title: 'If Flood-Net couldn’t send them back (it says so), paste what its Copy for SoRT gave you' }, 'Paste from Flood-Net');
    if (!st || !(st.id || st.number)) { box.appendChild(h('div', { class: 'hint' }, 'Choose the station first.')); return box; }
    if (!b) {
      box.appendChild(h('div', null, pending && pending.key === KEY(st)
        ? 'Waiting for Flood-Net — press Send to SoRT in its tab (sign in there as an editor first).'
        : 'Flood-Net has HDB’s Benchmark Details for its editors. Get them, then Use one here.'));
      box.appendChild(acts(getBtn(false), pasteBtn));
      return box;
    }
    if (!b.marks.length) {
      box.appendChild(h('div', null, `HDB lists no benchmarks for this station${b.printedOn ? ` (Benchmark Details of ${U().dmy(b.printedOn)})` : ''}.`));
      box.appendChild(acts(getBtn(true)));
      return box;
    }
    const list = h('ul', { class: 'bbm-list' }, b.marks.map(m => {
      const u = useFor(m), on = inUse(A, m);
      return h('li', { class: on ? 'on' : '' },
        h('b', null, label(m)), ' ', `${m3(m.level)} m `, term(DATUM_TEXT[m.datum], m.datum),
        m.onGauge != null ? [' · ', `${m3(m.onGauge)} m on the gauge (`, term('LGH', 'lgh'), ')'] : null,
        m.description ? h('div', { class: 'bbm-desc' }, m.description) : null,
        m.comment ? h('div', { class: 'bbm-desc hint' }, `HDB comment: ${m.comment}`) : null,
        on ? h('span', { class: 'tag' }, 'in use') : u
          ? h('button', { type: 'button', class: 'btn-mini', onclick: () => use(A, m), title: `Fills the Local TBM with ${u.value} m ${u.option === 'ahd' ? 'AHD' : 'on the gauge (LGH)'} and where the mark is` }, 'Use')
          : h('span', { class: 'hint', title: 'Its level is on an assumed or unknown datum and Flood-Net can’t put it on the gauge, so it is neither AHD nor LGH here' }, 'not AHD or LGH'));
    }));
    box.appendChild(list);
    box.appendChild(acts(h('span', { class: 'hint' }, `From HDB’s Benchmark Details${b.printedOn ? ` of ${U().dmy(b.printedOn)}` : ''}, via Flood-Net ${U().fmtWhen(b.at)}. They go in the Word copy as their own table.`), getBtn(true)));
    return box;
  }

  // ---- the Word table (after the State survey marks) ----
  function forWord(s) { const b = current(s); return b && b.marks.length ? b : null; }

  function init(A) { listen(A); }
  S.bureauBM = { init, node, request, paste, use, forWord, clean, locationText, useFor, label, m3, DATUM_TEXT, WORDS, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
