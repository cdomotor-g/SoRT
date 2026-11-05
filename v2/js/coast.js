/* SoRT v2 — coast.js
   How far the site is from the sea, the corrosion category that suggests, and
   the corrosion guide behind the Infrastructure options card (Water Level
   table: q.suggest "coast", q.guide "corrosion" — definitions guides.corrosion
   holds the words and the distances).

   The distances. QSpatial's Queensland coastline (mean high water, the seaward
   edge of mangroves; river mouths closed by "Coastline Junction" lines, so a
   river bank upstream is not "the shore") is fetched live for 12 km round the
   site. The stretches of it that face open ocean surf are in
   data/surf-coast.json (made by tools/build-surf-coast.mjs). Each kind of shore
   gets its own nearest distance: surf from that file; the rest of the coast
   counts as tropical quiet north of the Tropic of Capricorn and temperate
   semi-sheltered south of it. The highest category any of them reaches
   (guides.corrosion.bands, most severe first) is the suggestion.

   The suggestion goes in as a Map suggestion (orange until ✓). It never covers
   an answer a person chose, or one from an earlier session; it follows the site
   when it moves (a relocation's new location wins), and goes when there is no
   position, the site is outside Queensland, or the coastline can't be reached
   (a surf-only figure could miss a bay 50 m away, so none is suggested then). */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules, sch = () => S.schema;
  const h = (...a) => U().h(...a);

  const CFG = {
    coastline: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Oceans/CoastalWaters/MapServer/17',
    surf: 'data/surf-coast.json',
    tropicLat: -23.44,                     // north of it: tropical quiet; south: temperate semi-sheltered
    pointDangerLat: -28.165,               // Queensland's coast ends here; south of it, east of 152.5°, is New South Wales
    marginM: 2000,                         // searched beyond the widest band (10 km for surf)
    surfTolM: 40,                          // a live piece of coast this close to a surf stretch is that surf beach
    timeoutMs: 15000, debounceMs: 600,
    shore: { surf: 'surf', south: 'temperate_semi', north: 'tropical_quiet' },
    credit: 'Coastline: QSpatial, © State of Queensland, CC BY 4.0.'
  };
  const V = ((G.document && document.currentScript && /[?&]v=([^&]+)/.exec(document.currentScript.src)) || [])[1] || '';

  const C = { key: '', res: null, cache: new Map(), surfP: null, timer: null, app: null };

  /* ---------------- where the site is ---------------- */
  function site(ctx) {
    const parse = s => { const p = U().parseCoord(String(s || '')); return p.ok ? p : null; };
    if (ctx.byCode.relocation && R().visible(ctx, ctx.byCode.relocation)) {
      const r = R().eff(ctx, 'relocation');
      if ([].concat(r.value || []).includes('yes')) {
        const p = parse(r.fields.newLocation);
        if (p) return { lat: p.lat, lon: p.lon, what: 'the new location', checked: true };
      }
    }
    if (ctx.byCode.coords) {
      const c = R().eff(ctx, 'coords'), p = parse(c.fields.existing);
      const st = ctx.session.station || {};
      if (p) return { lat: p.lat, lon: p.lon, what: 'the site', checked: c.fieldSrc.existing === 'user' || !!st.checked || c.fieldSrc.existing === 'map' };
    }
    const st = ctx.session.station;
    if (st && st.lat != null && st.lon != null) return { lat: st.lat, lon: st.lon, what: 'the station', checked: !!st.checked };
    return null;
  }
  const inQldCoast = p => U().inQld(p.lat, p.lon) && !(p.lat < CFG.pointDangerLat && p.lon > 152.5);

  /* ---------------- distances ---------------- */
  function frame(p) {
    const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110574;
    return { x: lon => (lon - p.lon) * kx, y: lat => (lat - p.lat) * ky, lon: x => x / kx + p.lon, lat: y => y / ky + p.lat };
  }
  // Nearest point of segment (ax,ay)-(bx,by) to (px,py): [distance², x, y].
  function nearSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    return [(px - x) * (px - x) + (py - y) * (py - y), x, y];
  }
  function loadSurf() {
    if (!C.surfP) C.surfP = U().fetchJson(`${CFG.surf}${V ? '?v=' + V : ''}`, { timeoutMs: CFG.timeoutMs })
      .then(d => { if (!d || !Array.isArray(d.lines)) throw new Error('the surf beaches file is unreadable'); return d.lines; })
      .catch(e => { C.surfP = null; throw e; });
    return C.surfP;
  }
  async function fetchCoast(p, radiusM) {
    const dLat = radiusM / 110574, dLon = radiusM / (111320 * Math.cos(p.lat * Math.PI / 180));
    const base = {
      f: 'json', where: "feature_type IN ('Coastline','Coastline Junction')", outFields: 'objectid',
      geometry: `${p.lon - dLon},${p.lat - dLat},${p.lon + dLon},${p.lat + dLat}`, geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.00005', geometryPrecision: '6'
    };
    const paths = [];
    let offset = 0;
    for (let page = 0; page < 6; page++) {
      const q = new URLSearchParams(Object.assign({}, base, offset ? { resultOffset: String(offset) } : {}));
      const j = await U().fetchJson(`${CFG.coastline}/query?${q}`, { timeoutMs: CFG.timeoutMs });
      if (!j || j.error) throw new Error((j && j.error && j.error.message) || 'the coastline service gave no answer');
      (j.features || []).forEach(f => ((f.geometry || {}).paths || []).forEach(pp => paths.push(pp)));
      if (!j.exceededTransferLimit) break;
      offset += (j.features || []).length;
    }
    return paths;
  }
  function searchM(guide) {
    let m = 0;
    (guide.bands || []).forEach(b => Object.values(b.within || {}).forEach(v => { if (v > m) m = v; }));
    return m + CFG.marginM;
  }
  // { surf:{m,lat,lon}, temperate_semi:…, tropical_quiet:… } — null where nothing is within reach.
  async function measure(p, guide) {
    const radius = searchM(guide);
    const [lines, paths] = await Promise.all([loadSurf(), fetchCoast(p, radius)]);
    const F = frame(p), px = 0, py = 0;
    const best = {};
    const keep = (type, d2, x, y) => { if (!best[type] || d2 < best[type].d2) best[type] = { d2, x, y }; };
    // Surf: the whole file (it is small), so a far beach still has a distance.
    const near = [], surfNear = new Set();
    lines.forEach((l, li) => {
      for (let i = 0; i < l.length - 1; i++) {
        const ax = F.x(l[i][0]), ay = F.y(l[i][1]), bx = F.x(l[i + 1][0]), by = F.y(l[i + 1][1]);
        const r = nearSeg(px, py, ax, ay, bx, by);
        keep(CFG.shore.surf, r[0], r[1], r[2]);
        if (r[0] < (radius + 1000) ** 2) { near.push([ax, ay, bx, by]); surfNear.add(li); }
      }
    });
    const onSurf = (x, y) => near.some(s => nearSeg(x, y, s[0], s[1], s[2], s[3])[0] <= CFG.surfTolM ** 2);
    paths.forEach(pp => {
      for (let i = 0; i < pp.length - 1; i++) {
        const ax = F.x(pp[i][0]), ay = F.y(pp[i][1]), bx = F.x(pp[i + 1][0]), by = F.y(pp[i + 1][1]);
        if (onSurf((ax + bx) / 2, (ay + by) / 2)) continue;            // that surf beach, counted as surf
        const type = (pp[i][1] + pp[i + 1][1]) / 2 > CFG.tropicLat ? CFG.shore.north : CFG.shore.south;
        const r = nearSeg(px, py, ax, ay, bx, by);
        keep(type, r[0], r[1], r[2]);
      }
    });
    const shores = {};
    Object.entries(best).forEach(([t, b]) => {
      const m = Math.sqrt(b.d2);
      if (t !== CFG.shore.surf && m > radius) return;
      shores[t] = { m, lat: F.lat(b.y), lon: F.lon(b.x) };
    });
    // What the distance map draws: the coastline fetched, and the surf stretches near the site.
    return { shores, radius, draw: { shore: paths, surf: [...surfNear].map(i => lines[i]) } };
  }
  // The highest band any shore reaches: { category, because:[{shore, m, within}] }.
  function suggest(guide, shores) {
    for (const b of guide.bands || []) {
      const because = Object.entries(b.within || {}).filter(([t, lim]) => shores[t] && shores[t].m < lim).map(([t, lim]) => ({ shore: t, m: shores[t].m, within: lim }));
      if (because.length) return { category: b.category, because };
    }
    return { category: (guide.otherwise || {}).category, because: [] };
  }

  /* ---------------- keeping it up to date ---------------- */
  const question = ctx => ctx.qs.find(q => q.suggest === 'coast' && R().visible(ctx, q)) || null;
  const guideOf = (A, q) => ((A.defs.guides || {})[q.guide]) || null;
  const posKey = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

  function sync(A) {
    C.app = A;
    const q = question(A.ctx);
    if (!q || !guideOf(A, q)) { if (C.key) { C.key = ''; C.res = null; } return; }
    const p = site(A.ctx);
    const key = `${A.session.id}|${q.code}|${p ? posKey(p) : ''}|${A.defs.version}`;
    const seen = `${key}|${p && p.checked}`;     // the same spot, now checked: the card's warning may go
    if (key === C.key) { if (seen !== C.seen) { C.seen = seen; paint(A, q); } return; }
    C.key = key; C.seen = seen;
    clearTimeout(C.timer);
    if (!p) { settle(A, q, { status: 'nopos' }); return; }
    if (!inQldCoast(p)) { settle(A, q, { status: 'outside', pos: p }); return; }
    const cached = C.cache.get(posKey(p) + '|' + A.defs.version);
    if (cached) { settle(A, q, Object.assign({}, cached, { pos: p })); return; }
    C.res = { status: 'busy', pos: p }; paint(A, q);
    C.timer = setTimeout(() => run(A, q, p, key), CFG.debounceMs);
  }
  async function run(A, q, p, key) {
    const guide = guideOf(A, q);
    let res;
    try {
      const m = await measure(p, guide);
      res = { status: 'ok', pos: p, shores: m.shores, radius: m.radius, draw: m.draw, sugg: suggest(guide, m.shores), at: Date.now() };
      C.cache.set(posKey(p) + '|' + A.defs.version, res);
    } catch (e) {
      let surf = null;
      try { const lines = await loadSurf(); surf = lines && (await measureSurfOnly(p, lines)); } catch (_) { /* nothing more to say */ }
      res = { status: 'failed', pos: p, error: e.message || String(e), surf };
    }
    if (key !== C.key) return;            // the site moved on while this was out
    settle(A, q, res);
  }
  async function measureSurfOnly(p, lines) {
    const F = frame(p); let d2 = Infinity;
    lines.forEach(l => { for (let i = 0; i < l.length - 1; i++) d2 = Math.min(d2, nearSeg(0, 0, F.x(l[i][0]), F.y(l[i][1]), F.x(l[i + 1][0]), F.y(l[i + 1][1]))[0]); });
    return isFinite(d2) ? Math.sqrt(d2) : null;
  }
  // Store the result, put (or take back) the Map suggestion, and redraw.
  function settle(A, q, res) {
    C.res = res;
    const s = A.session, pre = s.prefill[q.code];
    const ours = pre && pre.coast;
    let changed = false;
    if (res.status === 'ok') {
      const pf = sch().presetField(q), opt = pf && sch().flatOptions(pf.options).find(o => o.code === res.sugg.category);
      if (opt && (!pre || ours)) {
        const next = { src: 'map', from: fromText(A, q, res), value: (opt.ticks || []).slice(), fields: { [pf.code]: opt.code }, coast: posKey(res.pos) };
        if (!ours || pre.coast !== next.coast || pre.fields[pf.code] !== opt.code || pre.from !== next.from) { s.prefill[q.code] = next; changed = true; }
      }
    } else if (ours && !(res.status === 'failed' && pre.coast === posKey(res.pos))) { delete s.prefill[q.code]; changed = true; }   // measured here before: it stands
    if (changed) A.changed(); else paint(A, q);
  }

  /* ---------------- words ---------------- */
  const shoreDef = (guide, code) => (guide.shores || []).find(x => x.code === code) || { code, label: code, short: code };
  const catLabel = (q, code) => { const pf = sch().presetField(q); return pf ? sch().optionLabel(pf, code) : code; };
  const dist = m => m == null ? '' : m > 50000 ? 'more than 50 km' : U().fmtDist(m);
  const lim = m => m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${m} m`;       // a band's round distance: 100 m, 1 km, 10 km
  function fromText(A, q, res) {
    const g = guideOf(A, q), parts = [];
    Object.entries(res.shores).sort((a, b) => a[1].m - b[1].m).forEach(([t, v]) => parts.push(`${dist(v.m)} from ${shoreDef(g, t).short}`));
    return `the distance to the sea (${parts.join(', ') || `no shore within ${dist(res.radius)}`})`;
  }
  // "within 1 km of a surf beach or a tropical shore, or 100 m of a semi-sheltered bay"
  function withinText(guide, within) {
    const by = new Map();
    Object.entries(within || {}).forEach(([t, m]) => { if (!by.has(m)) by.set(m, []); by.get(m).push(shoreDef(guide, t).short); });
    const join = (xs, sep) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}${sep}${xs[xs.length - 1]}`;
    return join([...by.entries()].sort((a, b) => b[0] - a[0]).map(([m, xs]) => `${lim(m)} of ${join(xs, ' or ')}`), ', or ');
  }

  /* ---------------- on the card ---------------- */
  // The brief summary under the question, with the way into the full guide.
  function summary(A, q) {
    const g = guideOf(A, q);
    if (!g) return null;
    const rows = (g.bands || []).map(b => h('li', null, h('b', null, b.name), `: within ${withinText(g, b.within)}.`));
    if (g.otherwise) rows.push(h('li', null, h('b', null, g.otherwise.name), ': further away than that.'));
    return h('div', { class: 'q-note info guide-sum' },
      g.summary ? h('div', null, g.summary) : null,
      h('ul', null, rows),
      h('button', { type: 'button', class: 'btn-mini guide-btn', onclick: () => openGuide(A, q) }, '📖 More about corrosion'));
  }
  // The measured distances and what they suggest (a block of its own, redrawn in place).
  function node(A, q) {
    const box = h('div', { class: 'q-note info coast-note', id: `coast-${q.code}`, 'aria-live': 'polite' });
    fill(box, A, q);
    return box;
  }
  function paint(A, q) {
    const el = G.document && document.getElementById(`coast-${q.code}`);
    if (el) { el.innerHTML = ''; fill(el, A, q); }
  }
  function fill(box, A, q) {
    const r = C.res, g = guideOf(A, q);
    if (!r || !g) return;
    const head = t => h('div', { class: 'coast-head' }, '🌊 ', t);
    if (r.status === 'nopos') { box.appendChild(head('Give the site’s Instrumentation Coordinates (or place it on the map) and its distance to the sea is worked out here, with the category it suggests.')); return; }
    if (r.status === 'outside') { box.appendChild(head('This site is outside Queensland’s coast, which is all the coastline here covers: choose the category from the guide.')); return; }
    if (r.status === 'busy') { box.appendChild(head(`Measuring how far ${r.pos.what} is from the sea…`)); return; }
    if (r.status === 'failed') {
      const kept = (A.session.prefill[q.code] || {}).coast === posKey(r.pos);
      box.appendChild(head(kept ? `Couldn’t reach QSpatial’s coastline just now (${r.error}); the suggestion below was measured for this position before.`
        : `Couldn’t reach QSpatial’s coastline (${r.error}), so there is no suggestion: choose from the guide.`));
      if (r.surf != null) box.appendChild(h('div', null, `The nearest surf beach is ${dist(r.surf)} away; check the other shores yourself.`));
      box.appendChild(h('div', { class: 'coast-acts' }, h('button', { type: 'button', class: 'btn-mini', onclick: () => { C.key = ''; sync(A); } }, '↻ Try again')));
      return;
    }
    box.appendChild(head(`How far ${r.pos.what} (${U().formatCoord(r.pos.lat, r.pos.lon)}) is from the sea:`));
    const list = h('ul', { class: 'coast-list' });
    const kinds = [CFG.shore.surf].concat([CFG.shore.south, CFG.shore.north].filter(t => r.shores[t]));
    kinds.forEach(t => {
      const v = r.shores[t], d = shoreDef(g, t), hit = (r.sugg.because || []).some(b => b.shore === t);
      list.appendChild(h('li', { class: hit ? 'hit' : null }, `${d.label}${t === CFG.shore.surf ? ' beach' : ' shore'}: `, h('b', null, v ? dist(v.m) : `none within ${dist(r.radius)}`)));
    });
    if (kinds.length === 1) list.appendChild(h('li', null, `Other shores: none within ${dist(r.radius)}`));
    box.appendChild(list);
    const e = R().eff(A.ctx, q.code), pf = sch().presetField(q);
    const cur = String(e.fields[pf.code] || ''), mine = e.fieldSrc[pf.code] === 'user', sug = r.sugg.category;
    const line = h('div', { class: 'coast-sugg' }, 'Suggests ', h('b', null, catLabel(q, sug)), '. ');
    if (cur === sug && mine) line.appendChild(document.createTextNode('✓ The answer below matches.'));
    else if (cur === sug) line.appendChild(document.createTextNode('Filled in below — check it, then press ✓.'));
    else if (cur) line.appendChild(document.createTextNode(`The answer below is ${catLabel(q, cur)}${mine ? '' : ' (from an earlier session)'}: keep it if the forum knows better — strong onshore winds, a polluted river.`));
    box.appendChild(line);
    const acts = h('div', { class: 'coast-acts' });
    if (cur !== sug) acts.appendChild(h('button', { type: 'button', class: 'btn-mini', onclick: () => use(A, q, sug) }, `Use ${catLabel(q, sug).split(' — ')[0]}`));
    if (Object.values(r.shores).some(v => v.m <= r.radius)) acts.appendChild(h('button', { type: 'button', class: 'btn-mini', title: 'A map of the site and the shores these distances are measured to, in the corrosion guide', onclick: () => openGuide(A, q) }, '🗺 Map of these distances'));
    if (acts.childNodes.length) box.appendChild(acts);
    const w = roundingWarning(A, q, r);
    if (w) box.appendChild(h('div', { class: 'hint warn' }, w));
  }
  /* A rounded position (Flood-Net's are often to 2 or 3 decimal places) only
     matters when moving the site by that much could change the category: then
     say so, with the two it could be. Read afresh, so ✓ Position checked clears it. */
  function roundingWarning(A, q, r) {
    const p = site(A.ctx);
    if (!p || p.checked || posKey(p) !== posKey(r.pos)) return '';
    const prec = U().coordPrecision(p.lat, p.lon).metres;
    if (prec <= 60) return '';
    const g = guideOf(A, q), moved = d => Object.fromEntries(Object.entries(r.shores).map(([t, v]) => [t, { m: Math.max(0, v.m + d) }]));
    const nearer = suggest(g, moved(-prec)).category, further = suggest(g, moved(prec)).category;
    if (nearer === further) return '';
    const name = c => catLabel(q, c).split(' — ')[0];
    return `This position is rounded (good to about ±${U().fmtDist(prec)}), which is enough to make it ${name(further)} or ${name(nearer)}. On the map, move the pin onto the equipment and press ✓ Position checked: the distance is then measured from there.`;
  }
  function use(A, q, code) {
    const pf = sch().presetField(q), opt = sch().flatOptions(pf.options).find(o => o.code === code);
    if (!opt) return;
    const a = A.session.answers[q.code] = A.session.answers[q.code] || { value: null, fields: {} };
    a.fields = a.fields || {};
    a.fields[pf.code] = opt.code; a.value = (opt.ticks || []).slice();
    a.checked = { src: 'map', from: C.res && C.res.status === 'ok' ? fromText(A, q, C.res) : '', at: Date.now() };
    A.changed();
  }

  /* ---------------- the guide (the pop-up) ---------------- */
  function rangeCells(guide, code) {
    const cells = []; let lo = 0;
    (guide.bands || []).forEach(b => {
      const hi = (b.within || {})[code];
      if (hi == null) { cells.push({ cat: b.category, text: '—' }); return; }
      cells.push({ cat: b.category, text: lo ? `${lim(lo)} – ${lim(hi)}` : `under ${lim(hi)}`, lo, hi });
      lo = hi;
    });
    cells.push({ cat: (guide.otherwise || {}).category, text: lo ? `over ${lim(lo)}` : 'anywhere', lo, hi: Infinity });
    return cells;
  }
  /* AS 4312's own table (guide.standard) beside OTE's distances: for each kind
     of shore and each of the standard's distance bands, the standard's grade
     (as one of the three categories; a split grade at its higher one) and OTE's
     category there. cmp: 'stricter' | 'same' | 'looser', steps = how many
     categories apart. Worked out from the data, so it stays true if either changes. */
  function compare(guide) {
    const st = guide.standard;
    if (!st || !guide.otherwise) return null;
    const order = [guide.otherwise.category].concat((guide.bands || []).map(b => b.category).reverse());   // least severe first
    const rank = c => order.indexOf(c);
    const oteAt = (shore, m) => { for (const b of guide.bands || []) { const l = (b.within || {})[shore]; if (l != null && m < l) return b.category; } return guide.otherwise.category; };
    const rows = (st.rows || []).map(r => ({ shore: r.shore, cells: (st.bands || []).map((band, i) => {
      const grade = String(r.grades[i]);
      const stdCat = grade.split('/').map(t => (st.groups || {})[t.replace(/[^A-Za-z0-9]/g, '')]).sort((a, b) => rank(b) - rank(a))[0];
      const near = oteAt(r.shore, band.from), far = oteAt(r.shore, band.to - 1e-6);
      const ote = rank(near) >= rank(far) ? near : far;      // a band across one of OTE's distances: its stricter end
      const steps = rank(ote) - rank(stdCat);
      return { band, grade, stdCat, ote, steps, cmp: steps > 0 ? 'stricter' : steps < 0 ? 'looser' : 'same' };
    }) }));
    return { rows };
  }
  function openGuide(A, q) {
    const g = guideOf(A, q);
    if (!g) return;
    const old = document.getElementById('guideDlg'); if (old) old.remove();
    const r = C.res && C.res.status === 'ok' ? C.res : null;
    // Least severe first: C3 and below, C4, C5 and CX.
    const cats = [g.otherwise].concat((g.bands || []).slice().reverse()).filter(Boolean);
    const body = h('div', { class: 'dlg-body guide-body' });
    let mini = null;
    if (r) {
      // This site: its distances to the sea, on a map of its own.
      const box = h('div', { class: 'guide-map', id: 'guideMap', role: 'img', 'aria-label': 'Map of the site and the nearest shores' });
      const within = Object.entries(r.shores).filter(([, v]) => v.m <= r.radius);
      body.appendChild(h('h3', { class: 'guide-first' }, 'This site’s distance to the sea'));
      body.appendChild(h('p', { class: 'guide-site' }, `This site (${U().formatCoord(r.pos.lat, r.pos.lon)}): `, h('b', null, catLabel(q, r.sugg.category)),
        r.sugg.because.length ? ` — within ${r.sugg.because.map(b => `${lim(b.within)} of ${shoreDef(g, b.shore).short} (${dist(b.m)})`).join(', and ')}.` : ` — further from the sea than any of OTE’s distances${within.length ? '' : ` (no shore within ${dist(r.radius)})`}.`));
      if (!within.length) body.appendChild(h('p', null, `No shore is within ${dist(r.radius)} of the site, so there is nothing to map${r.shores[CFG.shore.surf] ? ` (the nearest surf beach is ${dist(r.shores[CFG.shore.surf].m)} away)` : ''}.`));
      else body.appendChild(box);
      if (within.length) body.appendChild(h('p', { class: 'muted guide-map-key' }, 'Red: the site. Dashed: the distance measured to the nearest shore of each kind — orange a surf beach, blue any other shore (bays, river mouths). Only on this map, never in the Word picture.',
        r.shores[CFG.shore.surf] && r.shores[CFG.shore.surf].m > r.radius ? ` The nearest surf beach is ${dist(r.shores[CFG.shore.surf].m)} away, off this map.` : ''));
      if (!within.length) { /* nothing to map */ } else if (S.mapView && S.mapView.miniMap) {
        box.appendChild(h('div', { class: 'guide-map-msg' }, 'Loading the map…'));
        mini = S.mapView.miniMap(box, { lat: r.pos.lat, lon: r.pos.lon, label: 'The site', shore: (r.draw || {}).shore, surf: (r.draw || {}).surf,
          lines: within.map(([t, v]) => ({ lat: v.lat, lon: v.lon, label: `${shoreDef(g, t).label} ${dist(v.m)}`, surf: t === CFG.shore.surf })) })
          .then(m => { const msg = box.querySelector('.guide-map-msg'); if (m) { if (msg) msg.remove(); } else if (msg) msg.textContent = 'The map couldn’t load here; the distances are listed on the card.'; return m; });
      } else box.appendChild(h('div', { class: 'guide-map-msg' }, 'The map isn’t available here; the distances are listed on the card.'));
    }
    body.appendChild(h('h3', null, 'About corrosion'));
    body.appendChild(h('p', null, g.intro || g.summary || ''));
    body.appendChild(h('h3', null, 'The three categories and their materials'));
    body.appendChild(h('table', { class: 'guide-tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Category'), h('th', null, 'AS 4312 grade'), h('th', null, 'Materials'))),
      h('tbody', null, cats.map(c => h('tr', { class: r && r.sugg.category === c.category ? 'hit' : null },
        h('th', null, c.name), h('td', null, c.grade || ''), h('td', null, c.materials || ''))))));
    body.appendChild(h('h3', null, 'How far from the shore — OTE’s instruction'));
    const shores = (g.shores || []);
    const siteCol = !!r;
    body.appendChild(h('div', { class: 'guide-scroll' }, h('table', { class: 'guide-tbl guide-matrix' },
      h('thead', null, h('tr', null, h('th', null, 'Shore'), h('th', null, 'For example'),
        (g.bands || []).map(b => h('th', null, b.name)), h('th', null, (g.otherwise || {}).name || ''),
        siteCol ? h('th', { class: 'site-col' }, 'This site') : null)),
      h('tbody', null, shores.map(s => {
        const v = r && r.shores[s.code];
        return h('tr', null, h('th', null, s.label), h('td', null, s.examples || ''),
          rangeCells(g, s.code).map(c => {
            // Where the site sits for this kind of shore; the cell that sets the category stands out.
            const hit = v && c.hi != null && v.m >= (c.lo || 0) && v.m < c.hi;
            return h('td', { class: hit ? (c.cat === r.sugg.category ? 'hit decides' : 'hit') : null }, c.text);
          }),
          siteCol ? h('td', { class: 'site-col' }, v ? dist(v.m) : '—') : null);
      })))));
    const cmp = compare(g);
    if (cmp) {
      const st = g.standard, nameOf = c => ((g.bands || []).find(b => b.category === c) || g.otherwise).name;
      const all = [].concat(...cmp.rows.map(r => r.cells.map(c => ({ r, c }))));
      const stricter = all.filter(x => x.c.cmp === 'stricter'), looser = all.filter(x => x.c.cmp === 'looser');
      const words = ({ r, c }) => `${shoreDef(g, r.shore).label}, ${c.band.label}: AS 4312 says ${c.grade}${nameOf(c.stdCat) !== c.grade ? ` (${nameOf(c.stdCat)})` : ''}; OTE says ${catLabel(q, c.ote)}${Math.abs(c.steps) > 1 ? ` — ${Math.abs(c.steps)} categories apart` : ''}.`;
      body.appendChild(h('h3', null, `${st.title || 'AS 4312'} and OTE’s instruction compared`));
      body.appendChild(h('p', null, `${st.about || ''} Each box gives the standard’s grade, then OTE’s category at that distance. The tool follows OTE. `,
        stricter.length ? h('span', { class: 'cmp-key cmp-stricter' }, 'Shaded') : null, stricter.length ? ` — OTE is stricter than the standard (${stricter.length} of ${all.length}).` : '',
        looser.length ? h('b', null, ` ⚠ In ${looser.length} OTE is less strict than the standard.`) : ' OTE is never less strict than the standard.'));
      body.appendChild(h('div', { class: 'guide-scroll' }, h('table', { class: 'guide-tbl guide-cmp' },
        h('thead', null, h('tr', null, h('th', null, 'Shore'), (st.bands || []).map(b => h('th', null, b.label)))),
        h('tbody', null, cmp.rows.map(r => h('tr', { dataset: { shore: r.shore } }, h('th', null, shoreDef(g, r.shore).label),
          r.cells.map(c => h('td', { class: `cmp-${c.cmp}`, title: words({ r, c }) },
            h('div', null, 'AS 4312: ', h('b', null, c.grade)), h('div', null, 'OTE: ', h('b', null, nameOf(c.ote)))))))))));
      if (stricter.length || looser.length) {
        body.appendChild(h('p', null, 'Where they differ:'));
        body.appendChild(h('ul', { class: 'cmp-list' }, looser.concat(stricter).map(x => h('li', { class: x.c.cmp === 'looser' ? 'warn' : null }, words(x)))));
      }
      if ((st.footnotes || []).length) body.appendChild(h('ul', { class: 'muted cmp-notes' }, st.footnotes.map(n => h('li', null, n))));
    }
    body.appendChild(h('h3', null, 'The kinds of shore'));
    body.appendChild(h('dl', { class: 'guide-dl' }, shores.map(s => [h('dt', null, s.label, s.examples ? h('span', { class: 'muted' }, ` — e.g. ${s.examples}`) : null), h('dd', null, s.about || '')])));
    if ((g.grades || []).length) {
      body.appendChild(h('h3', null, 'AS 4312’s corrosivity grades'));
      body.appendChild(h('dl', { class: 'guide-dl' }, g.grades.map(x => [h('dt', null, `${x.code} — ${x.name}`), h('dd', null, x.text)])));
    }
    if ((g.notes || []).length) { body.appendChild(h('h3', null, 'Good to know')); body.appendChild(h('ul', null, g.notes.map(n => h('li', null, n)))); }
    if (g.how) { body.appendChild(h('h3', null, 'How the suggestion is worked out')); body.appendChild(h('p', null, g.how, ' ', h('span', { class: 'muted' }, CFG.credit))); }
    if (g.source) body.appendChild(h('p', { class: 'muted guide-src' }, 'Source: ', g.source));
    const dlg = h('dialog', { class: 'guide-dlg', id: 'guideDlg', 'aria-labelledby': 'guideTitle' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'guideTitle' }, g.title || 'Guide'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
      body,
      h('div', { class: 'dlg-foot' }, h('span', { class: 'hint' }, 'The category you choose, and each part, go into Word.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Close')));
    dlg.addEventListener('close', () => { if (mini) mini.then(m => m && m.destroy()); dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  S.coast = { sync, summary, node, openGuide, site, measure, suggest, withinText, compare, CFG, _C: C };
})(typeof window !== 'undefined' ? window : globalThis);
