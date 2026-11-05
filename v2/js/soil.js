/* SoRT v2 — soil.js
   Acid sulfate soil at the site, for the "Acid sulfate soil" question (Water
   Level and Rainfall tables: q.suggest "soil", q.guide "ass" — the words are
   definitions guides.ass). The forum flags a susceptible site; the contractor
   tests the soil and manages it (OTE's advice, November 2026), so the
   question's follow-up is a contractor task that stays in the Word scope.

   What is read: Queensland's acid sulfate soil maps at the site, the finest
   that says something first (1:25 000, 1:50 000, 1:100 000 — quoted in their
   own words), the national atlas where none does, and the nearest tested soil
   core within 2 km — the same layers Flood-Net's Site exposure reads
   (cdomotor-g/MegaNet site-exposure.js, whose reading of the map codes is
   copied here). Where nothing is mapped, the station's recorded ground height
   decides: at or below 5 m AHD councils assume acid sulfate soil may be there.

   The suggestion goes in as a Map suggestion (orange until ✓), never over a
   person's answer or an earlier session's; it follows the site when it moves
   (a relocation's new location wins), and goes when the maps can't be read. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules, sch = () => S.schema;
  const h = (...a) => U().h(...a);

  const CFG = {
    host: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/SoilsAndLandResource/MapServer',
    maps: [{ id: 1902, scale: '1:25 000' }, { id: 1952, scale: '1:50 000' }, { id: 2002, scale: '1:100 000' }],
    atlas: 2052, sites: 1850, sitesM: 2000,
    lowAhd: 5,                         // councils assume acid sulfate soil may be present at or below 5 m AHD
    timeoutMs: 15000, debounceMs: 600
  };
  const C = { key: '', res: null, cache: new Map(), timer: null };

  /* ---------------- reading the maps ---------------- */
  // Flood-Net's assLevel(): what a map code's words say, coarsely. The card
  // always quotes the words themselves.
  function mapLevel(meaning) {
    const t = String(meaning || '').toLowerCase();
    if (!t) return null;
    if (/not assessed|not applicable/.test(t)) return 'unassessed';
    if (/dam or lake or water reservoir/.test(t)) return 'water';
    if (/^not at risk|low probability/.test(t)) return 'unlikely';
    if (/possibly at risk/.test(t)) return 'possible';
    if (/\bactual\b/.test(t)) return 'likely';
    if (/potential ass|potential acid sulfate|\bpass\b|\bass present\b|probability of ass/.test(t)) return 'likely';
    return 'possible';                 // words this doesn't know: the cautious reading
  }
  const NATIONAL = { A: 'likely', B: 'possible', C: 'unlikely' };

  async function ask(layer, p, fields, extra) {
    const q = new URLSearchParams(Object.assign({
      f: 'json', geometry: `${p.lon},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: fields, returnGeometry: 'false'
    }, extra || {}));
    const j = await U().fetchJson(`${CFG.host}/${layer}/query?${q}`, { timeoutMs: CFG.timeoutMs });
    if (!j || j.error || !Array.isArray(j.features)) throw new Error((j && j.error && j.error.message) || 'the soil map service gave no usable answer');
    return j.features;
  }
  async function read(p) {
    const ASS = 'map_code,map_code_meaning,project_code';
    const [maps, atlas, sites] = await Promise.all([
      Promise.all(CFG.maps.map(m => ask(m.id, p, ASS))),
      ask(CFG.atlas, p, 'probclass,probclass_def,mapscale'),
      ask(CFG.sites, p, 'project_code,site_id,core_depth_m,laboratory_data_available,field_ph_available,site_report_url',
        { distance: String(CFG.sitesM), units: 'esriSRUnit_Meter', returnGeometry: 'true', outSR: '4326', geometryPrecision: '5' }).catch(() => null)
    ]);
    // The finest map that says something; what finer ones said instead.
    let map = null; const finer = [];
    for (let i = 0; i < CFG.maps.length && !map; i++) {
      const f = maps[i][0];
      if (!f) continue;
      const a = f.attributes || {}, level = mapLevel(a.map_code_meaning);
      if (level === 'unassessed') { finer.push(`the ${CFG.maps[i].scale} map leaves it unassessed`); continue; }
      map = { meaning: a.map_code_meaning || a.map_code || '', code: a.map_code || '', project: a.project_code || '', scale: CFG.maps[i].scale, level };
    }
    const at = atlas[0] ? atlas[0].attributes || {} : null;
    const nat = at ? { cls: at.probclass, def: at.probclass_def || at.probclass || '', scale: at.mapscale || '1:2M', level: NATIONAL[at.probclass] || null } : null;
    let site = null, n = 0;
    if (sites) {
      const list = sites.map(f => {
        const g = f.geometry || {}, a = f.attributes || {};
        return isFinite(g.x) && isFinite(g.y) ? Object.assign({ m: U().haversineM(p, { lat: g.y, lon: g.x }) }, a) : null;
      }).filter(Boolean).sort((x, y) => x.m - y.m);
      n = list.length; site = list[0] || null;
    }
    return { map, finer, nat, site, n, sitesRead: !!sites };
  }
  // What the readings suggest: 'likely' | 'possible' | 'unlikely' | null, and why.
  function suggest(r, elev) {
    if (r.map && r.map.level !== 'water') return { level: r.map.level, by: 'map' };
    if (r.nat && r.nat.level) return { level: r.nat.level, by: 'atlas' };
    if (elev != null) return { level: elev <= CFG.lowAhd ? 'possible' : 'unlikely', by: 'height' };
    return { level: null, by: null };
  }

  /* ---------------- keeping it up to date ---------------- */
  const question = ctx => ctx.qs.find(q => q.suggest === 'soil' && R().visible(ctx, q)) || null;
  const guideOf = (A, q) => ((A.defs.guides || {})[q.guide]) || null;
  const posKey = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  // The station's recorded ground height, for its own position only (not a relocation's).
  function elevation(A, p) {
    const st = A.session.station || {};
    return p && p.what !== 'the new location' && st.elevation && isFinite(st.elevation.m) ? Number(st.elevation.m) : null;
  }

  function sync(A) {
    const q = question(A.ctx);
    if (!q || !guideOf(A, q) || !S.coast) { if (C.key) { C.key = ''; C.res = null; } return; }
    const p = S.coast.site(A.ctx);
    const elev = elevation(A, p);
    const key = `${A.session.id}|${q.code}|${p ? posKey(p) : ''}|${elev}|${A.defs.version}`;
    if (key === C.key) return;
    C.key = key;
    clearTimeout(C.timer);
    if (!p) { settle(A, q, { status: 'nopos' }); return; }
    if (!U().inQld(p.lat, p.lon)) { settle(A, q, { status: 'outside', pos: p }); return; }
    const cached = C.cache.get(posKey(p));
    if (cached) { settle(A, q, finish(cached, p, elev)); return; }
    C.res = { status: 'busy', pos: p }; paint(A, q);
    C.timer = setTimeout(async () => {
      let res;
      try { const r = await read(p); C.cache.set(posKey(p), r); res = finish(r, p, elev); }
      catch (e) { res = { status: 'failed', pos: p, error: e.message || String(e) }; }
      if (key === C.key) settle(A, q, res);
    }, CFG.debounceMs);
  }
  const finish = (r, p, elev) => Object.assign({ status: 'ok', pos: p, elev }, r, { sugg: suggest(r, elev) });

  // Store the result, put (or take back) the Map suggestion, and redraw.
  function settle(A, q, res) {
    C.res = res;
    const s = A.session, pre = s.prefill[q.code], ours = pre && pre.soil;
    const pf = sch().presetField(q), g = guideOf(A, q);
    let changed = false;
    if (res.status === 'ok' && pf && (!pre || ours)) {
      const code = res.sugg.level ? (g.suggests || {})[res.sugg.level] : null;
      const opt = code ? sch().flatOptions(pf.options).find(o => o.code === code) : null;
      const next = { src: 'map', from: 'Queensland’s acid sulfate soil maps', value: opt ? (opt.ticks || []).slice() : [],
        fields: Object.assign({ mapped: mappedText(res) }, opt ? { [pf.code]: opt.code } : {}), soil: posKey(res.pos) };
      if (!ours || JSON.stringify([pre.value, pre.fields, pre.soil]) !== JSON.stringify([next.value, next.fields, next.soil])) { s.prefill[q.code] = next; changed = true; }
    } else if (res.status !== 'ok' && res.status !== 'busy' && ours && !(res.status === 'failed' && pre.soil === posKey(res.pos))) {
      delete s.prefill[q.code]; changed = true;       // measured here before, and the maps are down: it stands
    }
    if (changed) A.changed(); else paint(A, q);
  }

  /* ---------------- words ---------------- */
  const dist = m => U().fmtDist(Math.max(10, Math.round(m / 10) * 10));
  const ahd = m => `${(Math.round(m * 10) / 10).toFixed(1)} m AHD`;
  // One sentence for the Word table (the "What the maps say" field).
  function mappedText(r) {
    const parts = [];
    if (r.map) parts.push(`${r.map.meaning} (Queensland ${r.map.scale} map)`);
    else if (r.nat) parts.push(`${r.nat.def} (national atlas, ${r.nat.scale}, inferred)`);
    else parts.push('Not mapped by Queensland’s acid sulfate soil maps');
    if (!r.map && !r.nat && r.elev != null) parts.push(`ground ${ahd(r.elev)}, ${r.elev <= CFG.lowAhd ? 'at or below' : 'above'} 5 m AHD`);
    if (r.site) parts.push(`nearest tested core ${dist(r.site.m)} away${/^y/i.test(r.site.laboratory_data_available || '') ? ', with lab results' : ''}`);
    return parts.join('; ') + '.';
  }
  const levelLabel = (A, q, code) => { const pf = sch().presetField(q); return pf ? sch().optionLabel(pf, code) : code; };

  /* ---------------- on the card ---------------- */
  function summary(A, q) {
    const g = guideOf(A, q);
    if (!g) return null;
    return h('div', { class: 'q-note info guide-sum' },
      g.summary ? h('div', null, g.summary) : null,
      (g.points || []).length ? h('ul', null, g.points.map(([k, t]) => h('li', null, h('b', null, k), `: ${t}`))) : null,
      h('button', { type: 'button', class: 'btn-mini guide-btn', onclick: () => openGuide(A, q) }, g.button || '📖 More'));
  }
  function node(A, q) {
    const box = h('div', { class: 'q-note info coast-note soil-note', id: `soil-${q.code}`, 'aria-live': 'polite' });
    fill(box, A, q);
    return box;
  }
  function paint(A, q) {
    const el = G.document && document.getElementById(`soil-${q.code}`);
    if (el) { el.innerHTML = ''; fill(el, A, q); }
  }
  // The readings, as list items (the card's box and the guide's first section).
  function lines(r) {
    const out = [];
    if (r.map) out.push(h('li', null, `Queensland ${r.map.scale} map: `, h('b', null, r.map.meaning), r.finer.length ? ` (${r.finer.join('; ')})` : ''));
    if (r.nat && !r.map) out.push(h('li', null, `National atlas (${r.nat.scale}, inferred, not checked on the ground): `, h('b', null, r.nat.def)));
    if (!r.map && !r.nat) out.push(h('li', null, 'Not mapped here — Queensland maps acid sulfate soil on coastal land, and not mapped is not the same as absent'));
    if (r.site) {
      const bits = [r.site.core_depth_m != null ? `cored to ${Number(r.site.core_depth_m)} m` : '',
        /^y/i.test(r.site.laboratory_data_available || '') ? 'lab results' : /^y/i.test(r.site.field_ph_available || '') ? 'field pH' : '',
        r.n > 1 ? `${r.n} within ${CFG.sitesM / 1000} km` : ''].filter(Boolean).join(', ');
      const url = /^https:\/\//i.test(r.site.site_report_url || '') ? r.site.site_report_url : null;
      out.push(h('li', null, 'Nearest tested core: ', h('b', null, dist(r.site.m)), bits ? ` — ${bits}` : '',
        url ? [' · ', h('a', { href: url, target: '_blank', rel: 'noopener', 'aria-label': 'The soil core’s site report — Queensland Government, in a new tab' }, 'site report ↗')] : null));
    } else if (r.sitesRead) out.push(h('li', null, `No tested core within ${CFG.sitesM / 1000} km`));
    if (r.elev != null) out.push(h('li', null, 'Ground at the station: ', h('b', null, ahd(r.elev)),
      r.elev <= CFG.lowAhd ? ' — at or below 5 m AHD, where councils assume acid sulfate soil may be present' : ' — above 5 m AHD'));
    return out;
  }
  function fill(box, A, q) {
    const r = C.res;
    if (!r) return;
    const head = t => h('div', { class: 'coast-head' }, '🧪 ', t);
    if (r.status === 'nopos') { box.appendChild(head('Give the site’s Instrumentation Coordinates (or place it on the map) and what Queensland’s acid sulfate soil maps say about it shows here.')); return; }
    if (r.status === 'outside') { box.appendChild(head('This site is outside Queensland, whose soil maps these are: choose from what is known of the site.')); return; }
    if (r.status === 'busy') { box.appendChild(head(`Reading the soil maps at ${r.pos.what}…`)); return; }
    if (r.status === 'failed') {
      const kept = (A.session.prefill[q.code] || {}).soil === posKey(r.pos);
      box.appendChild(head(kept ? `Couldn’t reach Queensland’s soil maps just now (${r.error}); the suggestion below was read for this position before.`
        : `Couldn’t reach Queensland’s soil maps (${r.error}), so there is no suggestion: choose from what is known of the site.`));
      box.appendChild(h('div', { class: 'coast-acts' }, h('button', { type: 'button', class: 'btn-mini', onclick: () => { C.key = ''; sync(A); } }, '↻ Try again')));
      return;
    }
    box.appendChild(head(`What the soil maps say at ${r.pos.what} (${U().formatCoord(r.pos.lat, r.pos.lon)}):`));
    box.appendChild(h('ul', { class: 'coast-list' }, lines(r)));
    const g = guideOf(A, q), pf = sch().presetField(q), e = R().eff(A.ctx, q.code);
    const sug = r.sugg.level ? (g.suggests || {})[r.sugg.level] : null;
    if (!sug) { box.appendChild(h('div', { class: 'coast-sugg' }, 'Nothing here to suggest from: choose from what is known of the site.')); return; }
    const cur = String(e.fields[pf.code] || ''), mine = e.fieldSrc[pf.code] === 'user';
    const line = h('div', { class: 'coast-sugg' }, 'Suggests ', h('b', null, levelLabel(A, q, sug)), '. ');
    if (cur === sug && mine) line.appendChild(document.createTextNode('✓ The answer below matches.'));
    else if (cur === sug) line.appendChild(document.createTextNode('Filled in below — check it, then press ✓.'));
    else if (cur) line.appendChild(document.createTextNode(`The answer below is ${levelLabel(A, q, cur).split(' — ')[0]}${mine ? '' : ' (from an earlier session)'}: keep it if the forum knows the ground better.`));
    box.appendChild(line);
    if (cur !== sug) box.appendChild(h('div', { class: 'coast-acts' }, h('button', { type: 'button', class: 'btn-mini', onclick: () => use(A, q, sug) }, `Use ${levelLabel(A, q, sug).split(' — ')[0]}`)));
  }
  function use(A, q, code) {
    const pf = sch().presetField(q), opt = sch().flatOptions(pf.options).find(o => o.code === code);
    if (!opt) return;
    const a = A.session.answers[q.code] = A.session.answers[q.code] || { value: null, fields: {} };
    a.fields = a.fields || {};
    a.fields[pf.code] = opt.code; a.value = (opt.ticks || []).slice();
    a.checked = { src: 'map', from: 'Queensland’s acid sulfate soil maps', at: Date.now() };
    A.changed();
  }

  /* ---------------- the guide (the pop-up) ---------------- */
  function openGuide(A, q) {
    const g = guideOf(A, q);
    if (!g) return;
    const old = document.getElementById('guideDlg'); if (old) old.remove();
    const r = C.res && C.res.status === 'ok' ? C.res : null;
    const body = h('div', { class: 'dlg-body guide-body' });
    if (r) {
      body.appendChild(h('h3', { class: 'guide-first' }, 'This site'));
      body.appendChild(h('ul', null, lines(r)));
      const sug = r.sugg.level ? (g.suggests || {})[r.sugg.level] : null;
      if (sug) body.appendChild(h('p', { class: 'guide-site' }, 'Suggests ', h('b', null, levelLabel(A, q, sug)), '.'));
    }
    if (g.summary) body.appendChild(h('p', null, g.summary));
    (g.sections || []).forEach(sec => {
      body.appendChild(h('h3', null, sec.title));
      if (sec.text) body.appendChild(h('p', null, sec.text));
      if ((sec.items || []).length) body.appendChild(h('ul', null, sec.items.map(t => h('li', null, t))));
    });
    if ((g.links || []).length) {
      body.appendChild(h('h3', null, 'Read more'));
      body.appendChild(h('ul', null, g.links.map(l => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener', 'aria-label': `${l.title} — in a new tab` }, `${l.title} ↗`)))));
    }
    if (g.source) body.appendChild(h('p', { class: 'muted guide-src' }, 'Source: ', g.source));
    const dlg = h('dialog', { class: 'guide-dlg', id: 'guideDlg', 'aria-labelledby': 'guideTitle' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'guideTitle' }, g.title || 'Guide'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
      body,
      h('div', { class: 'dlg-foot' }, h('span', { class: 'hint' }, 'The risk, the steps ticked and what the maps say go into Word; the contractor task goes in its Follow-up Actions row.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Close')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  S.soil = { sync, summary, node, openGuide, read, suggest, mapLevel, CFG, _C: C };
  S.suggesters = Object.assign(S.suggesters || {}, { soil: S.soil });
})(typeof window !== 'undefined' ? window : globalThis);
