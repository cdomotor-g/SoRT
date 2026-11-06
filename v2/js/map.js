/* SoRT v2 — map.js
   The map, on the page (no pop-up): Queensland imagery, LiDAR contours, the road
   reserve and rail (v1's layers and their hard-won fixes, ported), the station's
   locations as pins, the location check, things drawn for the scope (vegetation
   clearance circle, trees, access track), survey marks and bridges near the
   station, Flood-Net's other stations nearby, and the picture for Word.

   Bridges: TMR's register of the bridges it manages and Queensland Roads and
   Tracks' bridges, merged (Flood-Net's map-road-owners.js, ported): a bridge on
   TMR's register is TMR's; any other goes with the road it carries, found in
   Roads and Tracks with its owner code; who to call is QLDTraffic's road lookup
   for the bridge's point. Only the bridges on the map — in the picture — are
   numbered (BR1, BR2… by distance), keyed and tabled; the rest within 1 km are
   counted in the list and left out.

   Because the map is always on the page and visible, the picture is simply the
   map you are looking at — v1's machinery for capturing a hidden modal (the
   off-screen rebuild, the suspended-view checks, the red rings) is not needed.
   The check that a capture actually rendered (rasterStats) is kept: a blank
   picture is refused, never pasted.

   Every external call is bounded, and nothing here can stop the rest of the
   page working: if the map can't load, coordinates are typed in the questions. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules;
  const h = (...a) => U().h(...a);

  const CFG = {
    esriBase: 'https://js.arcgis.com/4.31/',
    imagery: 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer',
    imageryLabels: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/QldImageryLabel/MapServer',
    contours: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Elevation/Contours/MapServer',
    contourSublayers: { 1: 30, 5: 20, 10: 10 },          // confirmed in v1's live diagnostics; probed by name too
    contourLine: { color: [214, 104, 26, 1], width: 1.1 },
    cadastre: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer',
    cadastreParcelsSublayer: 4,
    roadSublayerNames: ['road'],
    roadFieldCandidates: ['parcel_typ', 'parcel_type', 'tenure', 'feat_name', 'segpar_typ'],
    roadIntersectionPattern: '%INTER%', roadIntersectionMaxRatio: 3, roadProbeKm: 2,
    roadOutline: { color: [255, 0, 200, 1], width: 2 }, roadFill: [224, 196, 132, 0.5],
    otherTransport: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Transportation/OtherTransport/MapServer',
    railSublayersFallback: [155, 156, 157, 158],
    railInclude: /rail|railway|tram|monorail|siding|cane|light rail/i,
    railExclude: /aviat|aero|airport|airstrip|airfield|aerodrome|runway|helipad|heliport|\bport\b|wharf|jetty|marine/i,
    survey: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/SurveyControl/MapServer',
    surveyReportBase: 'https://qspatial.information.qld.gov.au/SurveyReport/',
    roadsAndTracks: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Transportation/RoadsAndTracks/MapServer',
    stateRoads: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Transportation/StateRoadInformation/MapServer',
    marks: { radiusM: 2000, max: 5 },               // the owner's call: on by default, 2 km, 5 marks
    bridges: { radiusM: 1000, max: 8, prefillWithinM: 150, mergeM: 60, roadM: 20 },
    // QLDTraffic's road lookup: for a point, the council, the TMR district and
    // TMR's state centre, each with a phone and an email. Keyless and open to
    // other sites, but not a published interface (Flood-Net's docs/road-owners.md).
    roadLookup: 'https://r8s97t2t19.execute-api.ap-southeast-2.amazonaws.com/prod/lookuproad',
    nearby: { radiusKm: 3, max: 30 },
    dynamicMinScale: 20000,                           // contours and road reserve stop at ~1:20,000
    siteZoom: 17,
    qld: { xmin: 137.6, ymin: -29.4, xmax: 154.0, ymax: -9.0 },   // the map's home: all of Queensland, Torres Strait included
    order: { imagery: 0, road: 1, contour: 2, rail: 3, labels: 4, nearby: 5, bridges: 6, marks: 7, draw: 8, ghost: 9, pins: 10 },
    timeouts: { esri: 20000, view: 20000, meta: 10000, layer: 10000, query: 12000 },
    attribution: '© State of Queensland (Department of Natural Resources and Mines; Department of Resources; Transport and Main Roads) — CC BY 4.0'
  };
  const PIN_RGB = { red: [214, 40, 40], orange: [224, 122, 10], blue: [30, 110, 200], purple: [130, 60, 200], green: [40, 150, 70], teal: [15, 150, 140] };
  const rgb = c => PIN_RGB[c] || (/^#[0-9a-f]{6}$/i.test(c || '') ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : PIN_RGB.red);
  const DRAW_RGB = [20, 160, 80];

  const M = {
    version: 0,
    app: null, root: null, els: {}, esri: null, esriP: null, view: null, map: null, layers: {}, gl: {},
    contour: '5', on: { road: true, rail: true, marks: true, bridges: true, nearby: true, ghost: false },   // Flood-Net's position: hidden unless ticked
    move: false, hover: null, drag: null, place: null, measure: null, sketch: null,
    pins: [], anchor: null, fetchedAt: null, marks: [], bridges: [], shown: [], shownSig: '', nearby: [], diag: {}, log: [],
    framedFor: null, ready: false, failed: null, contourIds: null, railIds: null,
    zoomLocked: true, homeNext: false   // the wheel scrolls the page until 🔒 is pressed; a new session goes home
  };

  /* ---------------- small plumbing ---------------- */
  const now = () => (G.performance ? performance.now() : Date.now());
  function withTimeout(p, ms, label) {
    let t; const to = new Promise((_, rej) => { t = setTimeout(() => { const e = new Error(`${label} timed out after ${Math.round(ms / 1000)} s`); e.isTimeout = true; rej(e); }, ms); });
    return Promise.race([p, to]).finally(() => clearTimeout(t));
  }
  async function getJson(url, label, ms) { return withTimeout(U().fetchJson(url, { timeoutMs: ms || CFG.timeouts.meta }), (ms || CFG.timeouts.meta) + 500, label); }
  function diag(key, status, note, ms) { M.diag[key] = { status, note: note || '', ms: ms == null ? null : Math.round(ms) }; renderDiag(); }
  function log(msg) { M.log.push(`${new Date().toLocaleTimeString()} ${msg}`); if (M.log.length > 80) M.log.shift(); renderDiag(); }
  function banner(msg, kind) { if (!M.els.banners) return; M.els.banners.appendChild(h('div', { class: `map-banner ${kind || 'warn'}` }, msg)); }

  function loadEsri() {
    if (M.esri) return Promise.resolve(M.esri);
    if (M.esriP) return M.esriP;
    const t0 = now();
    const p = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = CFG.esriBase + 'esri/themes/light/main.css';
      document.head.appendChild(css);
      const s = document.createElement('script'); s.src = CFG.esriBase; s.async = true;
      s.onload = () => {
        if (!G.require) { reject(new Error('the Esri loader did not start')); return; }
        G.require(['esri/Map', 'esri/views/MapView', 'esri/layers/ImageryLayer', 'esri/layers/ImageryTileLayer', 'esri/layers/MapImageLayer',
          'esri/layers/FeatureLayer', 'esri/layers/GroupLayer', 'esri/layers/GraphicsLayer', 'esri/Graphic', 'esri/core/reactiveUtils',
          'esri/geometry/geometryEngine', 'esri/geometry/support/webMercatorUtils', 'esri/widgets/Sketch/SketchViewModel', 'esri/widgets/DistanceMeasurement2D', 'esri/geometry/Extent'],
        (Map, MapView, ImageryLayer, ImageryTileLayer, MapImageLayer, FeatureLayer, GroupLayer, GraphicsLayer, Graphic, reactiveUtils, geometryEngine, webMercatorUtils, SketchViewModel, DistanceMeasurement2D, Extent) => {
          M.esri = { Map, MapView, ImageryLayer, ImageryTileLayer, MapImageLayer, FeatureLayer, GroupLayer, GraphicsLayer, Graphic, reactiveUtils, geometryEngine, webMercatorUtils, SketchViewModel, DistanceMeasurement2D, Extent };
          resolve(M.esri);
        }, reject);
      };
      s.onerror = () => reject(new Error('could not load the Esri map library (js.arcgis.com)'));
      document.head.appendChild(s);
    });
    M.esriP = withTimeout(p, CFG.timeouts.esri, 'The Esri map library')
      .then(e => { diag('esri', 'loaded', '', now() - t0); return e; })
      .catch(e => { M.esriP = null; diag('esri', e.isTimeout ? 'timed out' : 'failed', e.message, now() - t0); throw e; });
    return M.esriP;
  }
  function addOrdered(layer, kind) {
    layer.__z = CFG.order[kind] == null ? 99 : CFG.order[kind];
    let i = 0;
    M.map.layers.forEach(l => { if ((l.__z == null ? 99 : l.__z) <= layer.__z) i++; });
    M.map.add(layer, i);
  }

  /* ---------------- the pins: every location question the table asks ---------------- */
  function resolvePins() {
    const ctx = M.app.ctx, st = M.app.session.station || {};
    const pins = [];
    ctx.qs.forEach(q => {
      if (!q.pin) return;
      const e = R().eff(ctx, q.code);
      const raw = String(e.fields[q.pin.field] || '');
      const p = U().parseCoord(raw);
      const shown = R().visible(ctx, q) && R().test(ctx, q.pin.showIf);
      pins.push({ key: `${q.code}.${q.pin.field}`, code: q.code, field: q.pin.field, label: q.pin.label || q.label, qlabel: q.label,
        colour: q.pin.colour || 'red', anchor: !!q.pin.anchor, shown, gate: q.pin.showIf || null, ok: !!p.ok, lat: p.lat, lon: p.lon, raw, src: e.fieldSrc[q.pin.field] });
    });
    M.pins = pins;
    const a = pins.find(p => p.anchor && p.shown && p.ok);
    M.anchor = a ? { lat: a.lat, lon: a.lon } : (st.lat != null ? { lat: st.lat, lon: st.lon } : null);
    return pins;
  }
  const shownPins = () => M.pins.filter(p => p.shown && p.ok);

  function ans(code) {
    const s = M.app.session;
    if (!s.answers[code]) s.answers[code] = { value: null, fields: {} };
    s.answers[code].fields = s.answers[code].fields || {};
    return s.answers[code];
  }
  // Write a location into its question (and satisfy its gate, e.g. placing the
  // relocation site sets Relocation to Yes). Undoable from the toast.
  function writePin(pin, lat, lon, how) {
    const s = M.app.session;
    const before = U().clone({ a: s.answers[pin.code] || null, g: pin.gate && pin.gate.q ? s.answers[pin.gate.q] || null : null });
    ans(pin.code).fields[pin.field] = lat == null ? '' : U().formatCoord(lat, lon);
    if (lat != null && pin.gate && pin.gate.q && pin.gate.is != null) {
      const g = ans(pin.gate.q);
      if (g.value !== pin.gate.is) g.value = pin.gate.is;
    }
    M.app.changed();
    const moved = how === 'drag' && pin.ok ? ` (moved ${U().fmtDist(U().haversineM({ lat: pin.lat, lon: pin.lon }, { lat, lon }))})` : '';
    M.app.toast(lat == null ? `${pin.label} cleared.` : `${pin.label} set to ${U().formatCoord(lat, lon)}${moved}.`, { label: 'Undo', run: () => {
      if (before.a) s.answers[pin.code] = before.a; else delete s.answers[pin.code];
      if (pin.gate && pin.gate.q) { if (before.g) s.answers[pin.gate.q] = before.g; else delete s.answers[pin.gate.q]; }
      M.app.changed();
    } });
  }

  /* ---------------- mount + build ---------------- */
  function mount(el, app) {
    M.app = app; M.root = el;
    el.innerHTML = '';
    const contourSel = h('select', { 'aria-label': 'Contours', title: 'LiDAR contours (5 m draws much faster than 1 m)' },
      [['off', 'Contours off'], ['1', 'Contours 1 m'], ['5', 'Contours 5 m'], ['10', 'Contours 10 m']].map(([v, t]) => h('option', { value: v, selected: v === M.contour }, t)));
    contourSel.addEventListener('change', ev => setContours(ev.target.value));
    const tog = (key, label, title) => {
      const i = h('input', { type: 'checkbox', checked: M.on[key] });
      i.addEventListener('change', ev => { M.on[key] = ev.target.checked; applyToggles(); });
      return h('label', { class: 'inline-check', title }, i, ' ', label);
    };
    M.els.moveBtn = h('button', { type: 'button', class: 'btn-mini', 'aria-pressed': 'false', title: 'Drag a pin to move it; the coordinate is written into its question', onclick: () => setMove(!M.move) }, '✥ Move pins');
    M.els.measureBtn = h('button', { type: 'button', class: 'btn-mini', 'aria-pressed': 'false', title: 'Measure a distance on the map', onclick: () => setMeasure(!M.measure) }, '📏 Measure');
    const tools = h('div', { class: 'map-tools' },
      contourSel, tog('road', 'Road reserve', 'The cadastre’s road parcels, as on QLD Globe'), tog('rail', 'Rail'),
      tog('marks', 'State survey marks', 'Queensland’s permanent survey marks and benchmarks (QSpatial) within 2 km, nearest 5 — not the Bureau’s own station benchmarks, which are on the Local TBM question'),
      tog('bridges', 'Bridges', 'Road bridges within 1 km, and who manages them'),
      tog('nearby', 'Flood-Net stations', 'Other Flood-Net stations within 3 km — shown for the forum, left out of the Word picture'),
      tog('ghost', 'Flood-Net position', 'Tick to see where Flood-Net has the station, once its pin has been moved away from it — a working aid on this map only, never in the Word picture'),
      h('span', { class: 'map-tools-gap' }),
      M.els.moveBtn, M.els.measureBtn,
      h('button', { type: 'button', class: 'btn-mini', title: 'Frame every location on the map', onclick: () => frame(true) }, '⤢ Fit locations'));
    M.els.check = h('div', { class: 'map-check', id: 'mapCheck' });
    M.els.view = h('div', { class: 'map-view', id: 'mapView', role: 'region', 'aria-label': 'Map' });
    M.els.status = h('div', { class: 'map-status' }, 'Loading the map…');
    M.els.legend = h('div', { class: 'map-legend', title: 'The key, as it is under the map in the Word picture' });
    M.els.edges = h('div', { class: 'map-edges', 'aria-hidden': 'true' });
    M.els.progress = h('div', { class: 'map-progress', hidden: true }, h('div'));
    M.els.placeHint = h('div', { class: 'map-place', hidden: true });
    M.els.drawActs = h('div', { class: 'map-drawacts', hidden: true },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { if (M.sketch) M.sketch.complete(); } }, '✓ Finish route'),
      h('button', { type: 'button', class: 'btn', onclick: () => cancelPlace() }, 'Cancel'));
    M.els.lockBtn = h('button', { type: 'button', class: 'map-lock', id: 'zoomLock', 'aria-label': 'Zoom lock', onclick: () => setZoomLock(!M.zoomLocked) });
    M.els.lockHint = h('div', { class: 'map-lockhint', 'aria-hidden': 'true' }, 'Zoom is locked so the page scrolls — zoom with + / − or Ctrl + scroll, or press 🔒 to unlock');
    M.els.banners = h('div', { class: 'map-banners' });
    M.els.side = h('aside', { class: 'map-side' });
    M.els.diag = h('pre', { class: 'map-diag' });
    el.appendChild(h('div', { class: 'map-wrap' },
      M.els.check,
      h('div', { class: 'map-grid' },
        h('div', { class: 'map-main' }, tools,
          M.els.frame = h('div', { class: 'map-frame' }, M.els.view, M.els.edges, M.els.placeHint, M.els.drawActs, M.els.lockHint, M.els.status, M.els.progress),
          M.els.legend, M.els.banners),
        M.els.side),
      h('details', { class: 'map-details' }, h('summary', null, 'Map details (for troubleshooting)'),
        h('button', { type: 'button', class: 'btn-mini', onclick: () => { navigator.clipboard.writeText(M.els.diag.textContent).then(() => M.app.toast('Map details copied.')); } }, 'Copy map details'),
        M.els.diag)));
    // Zoom lock: while it's on, a wheel over the map never reaches the map (caught
    // on the way down), so the map doesn't zoom and the page scrolls past it as
    // usual. Ctrl + wheel (and a trackpad pinch, which arrives as one) still zooms.
    M.els.frame.addEventListener('wheel', ev => {
      if (!M.zoomLocked || ev.ctrlKey || ev.metaKey) return;
      ev.stopPropagation();
      lockHint();
    }, { capture: true, passive: true });
    paintLock();
    G.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && (M.place || M.drawing)) cancelPlace();
      else if (ev.key === 'Enter' && M.drawing && M.sketch) { ev.preventDefault(); M.sketch.complete(); }
    });
    build().catch(e => {
      M.failed = e.message;
      M.els.status.hidden = false;
      M.els.status.textContent = `The map couldn’t load (${e.message}). Everything else works — type coordinates into the questions.`;
      M.els.status.classList.add('error');
    });
  }

  async function build() {
    const E = await loadEsri();
    M.map = new E.Map({ layers: [] });
    // The imagery goes on before the view starts: a view needs a tiled layer to
    // know its zoom levels (and Web Mercator, the imagery's tiling), and without
    // one it never becomes ready. Its load is checked in loadImagery().
    const img = new E.ImageryTileLayer({ url: CFG.imagery });
    M.layers.imagery = img; addOrdered(img, 'imagery');
    ['nearby', 'bridges', 'marks', 'draw', 'ghost', 'pins'].forEach(k => { M.gl[k] = new E.GraphicsLayer({ title: k }); addOrdered(M.gl[k], k); });
    M.gl.ghost.visible = M.on.ghost;
    resolvePins();
    const c = M.anchor || { lat: -22.5, lon: 146.5 };
    M.view = new E.MapView({ container: M.els.view, map: M.map, center: [c.lon, c.lat], zoom: M.anchor ? CFG.siteZoom : 5, spatialReference: { wkid: 3857 },
      constraints: { rotationEnabled: false, snapToZoom: false }, ui: { components: ['zoom', 'attribution'] }, popupEnabled: false });
    const t0 = now();
    loadImagery(img);
    const ready = M.view.when();
    try { await withTimeout(ready, CFG.timeouts.view, 'The map view'); }
    catch (e) {
      if (!e.isTimeout) throw e;
      // Slow graphics (an old PC, a remote desktop): keep waiting, and say so.
      M.els.status.textContent = 'The map is slow to start on this computer — still trying…';
      log(`The map view took more than ${CFG.timeouts.view / 1000} s to start.`);
      await ready;
    }
    M.view.ui.move('zoom', 'bottom-right');
    M.view.ui.add(M.els.lockBtn, { position: 'bottom-right', index: 0 });
    applyZoomLock();
    diag('view', 'ready', '', now() - t0);
    M.ready = true;
    M.els.status.hidden = true;
    // A station chosen while the map library was still loading: frame it now
    // (the view started wherever the anchor was when it was built, maybe nowhere).
    resolvePins();
    M.framedFor = null; M.homeNext = false;
    if (M.anchor) { M.framedFor = key(M.anchor); frame(false); } else home();
    attachInteraction();
    E.reactiveUtils.watch(() => M.view.updating, u => { M.els.progress.hidden = !u; });
    E.reactiveUtils.watch(() => [M.view.extent, M.view.scale], () => { renderEdges(); renderStamp(); });
    E.reactiveUtils.watch(() => M.view.stationary, still => { if (still) { changedPicture(); refreshShown(); } });
    E.reactiveUtils.watch(() => M.view.updating, busy => { if (!busy) changedPicture(); });
    loadLabels(); loadContours(); loadRoad(); loadRail();
    sync(M.app);
    refreshNear(true);
  }

  /* ---------------- layers (ported from v1) ---------------- */
  async function loadImagery(l) {
    const E = M.esri, t0 = now();
    try {
      await withTimeout(l.load(), CFG.timeouts.layer, 'Imagery');
      diag('imagery', 'loaded', 'tiled', now() - t0);
    } catch (e) {
      // v1's last resort: the same service as a dynamic (non-tiled) layer.
      try {
        M.map.remove(l);
        const d = new E.ImageryLayer({ url: CFG.imagery });
        await withTimeout(d.load(), CFG.timeouts.layer, 'Imagery (dynamic)');
        M.layers.imagery = d; addOrdered(d, 'imagery');
        diag('imagery', 'loaded', 'dynamic fallback', now() - t0);
      } catch (e2) { diag('imagery', e.isTimeout ? 'timed out' : 'failed', e.message, now() - t0); banner(`Imagery didn’t load (${e.message}). The rest of the map still works.`, 'error'); }
    }
  }
  async function loadLabels() {
    const E = M.esri, t0 = now();
    try { const l = new E.MapImageLayer({ url: CFG.imageryLabels, opacity: 0.9 }); await withTimeout(l.load(), CFG.timeouts.layer, 'Labels'); M.layers.labels = l; addOrdered(l, 'labels'); diag('labels', 'loaded', '', now() - t0); }
    catch (e) { diag('labels', 'not loaded', e.message, now() - t0); }
  }
  async function resolveContourIds() {
    if (M.contourIds) return M.contourIds;
    const ids = Object.assign({}, CFG.contourSublayers);
    try {
      const j = await getJson(CFG.contours + '?f=json', 'Contours schema');
      (j.layers || []).forEach(l => {
        const n = String(l.name || '').toLowerCase();
        if (!/lidar|contour/.test(n)) return;
        const m = n.match(/(?:^|[^0-9])(10|5|1)\s*(?:m\b|met(?:re|er)s?\b)/);
        if (m) ids[m[1]] = l.id;
      });
    } catch (e) { log(`Contour ids not probed (${e.message}); using 1 m:${ids[1]} 5 m:${ids[5]} 10 m:${ids[10]}.`); }
    M.contourIds = ids;
    return ids;
  }
  async function loadContours() {
    const E = M.esri, t0 = now();
    if (M.layers.contour) { M.map.remove(M.layers.contour); M.layers.contour = null; }
    renderStamp();
    if (M.contour === 'off') { diag('contours', 'off'); return; }
    const want = M.contour;
    try {
      const ids = await resolveContourIds();
      const id = ids[want];
      const fl = new E.FeatureLayer({ url: `${CFG.contours}/${id}`, opacity: 0.95, minScale: CFG.dynamicMinScale, maxScale: 0,
        renderer: { type: 'simple', symbol: { type: 'simple-line', color: CFG.contourLine.color, width: CFG.contourLine.width } } });
      await withTimeout(fl.load(), CFG.timeouts.layer, 'Contours');
      const q = fl.capabilities && fl.capabilities.query;
      if (q && q.supportsQuantization === false) throw new Error('the server can’t simplify contours');
      const elev = (fl.fields || []).find(f => /small-integer|integer|single|double|long/.test(String(f.type)) && /elev|contour|height|^alt$|value|^z$/i.test(f.name));
      if (elev) { fl.labelingInfo = [{ labelExpressionInfo: { expression: `Text(Round($feature.${elev.name}, 1)) + ' m'` }, symbol: { type: 'text', color: [40, 30, 15], haloColor: [255, 255, 255, 0.9], haloSize: 1, font: { size: 9, weight: 'bold' } }, minScale: 8000, maxScale: 0, labelPlacement: 'center-along' }]; fl.labelsVisible = true; }
      if (want !== M.contour) return;
      M.layers.contour = fl; addOrdered(fl, 'contour');
      diag('contours', 'loaded', `${want} m, sublayer ${id}`, now() - t0);
    } catch (e) {
      try {
        const ids = await resolveContourIds();
        const subs = ['1', '5', '10'].filter(k => ids[k] != null).map(k => ({ id: ids[k], visible: k === want }));
        const l = new E.MapImageLayer({ url: CFG.contours, opacity: 0.7, minScale: CFG.dynamicMinScale, maxScale: 0, imageFormat: 'png8', dpi: 96, sublayers: subs });
        await withTimeout(l.load(), CFG.timeouts.layer, 'Contours (server-drawn)');
        if (want !== M.contour) return;
        M.layers.contour = l; addOrdered(l, 'contour');
        diag('contours', 'loaded', `${want} m, server-drawn (${e.message})`, now() - t0);
      } catch (e2) { diag('contours', e2.isTimeout ? 'timed out' : 'failed', e2.message, now() - t0); banner(`Contours didn’t load (${e2.message}).`, 'warn'); }
    }
  }
  function setContours(v) { M.contour = v; if (M.ready) loadContours(); }

  function envelopeKm(km) {
    if (!M.anchor) return null;
    const dLat = km / 111.32, dLon = km / (111.32 * Math.max(0.2, Math.cos(M.anchor.lat * Math.PI / 180)));
    return { xmin: M.anchor.lon - dLon, ymin: M.anchor.lat - dLat, xmax: M.anchor.lon + dLon, ymax: M.anchor.lat + dLat, spatialReference: { wkid: 4326 } };
  }
  async function countParcels(base, where, env) {
    let q = `${base}/query?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json`;
    if (env) q += `&geometry=${encodeURIComponent(JSON.stringify(env))}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;
    const j = await getJson(q, 'Cadastre count');
    return j && typeof j.count === 'number' ? j.count : null;
  }
  // v1's resolver: the cadastre's own road sublayer if it has one, else the
  // parcel layer filtered for road parcels — validated near the site, with the
  // intersection parcels added so the reserve reads continuous.
  async function resolveRoad() {
    try {
      const j = await getJson(CFG.cadastre + '?f=json', 'Cadastre layers');
      const env = envelopeKm(CFG.roadProbeKm);
      for (const l of (j.layers || []).filter(l => {
        const n = String(l.name || '').toLowerCase();
        return CFG.roadSublayerNames.some(k => n.includes(k)) && (!l.geometryType || l.geometryType === 'esriGeometryPolygon') && !/label|annotation|centre|center|\bline\b|text|rail/.test(n);
      })) {
        let c = null;
        try { c = await countParcels(`${CFG.cadastre}/${l.id}`, '1=1', env); } catch (_) { /* next */ }
        if (c > 0) return { sublayer: l.id, where: '1=1', source: `road sublayer "${l.name}"` };
      }
    } catch (e) { log(`Cadastre layer list: ${e.message}`); }
    const base = `${CFG.cadastre}/${CFG.cadastreParcelsSublayer}`;
    let fields = [];
    try { fields = ((await getJson(base + '?f=json', 'Cadastre schema')).fields || []).map(f => String(f.name)); }
    catch (e) { log(`Cadastre schema: ${e.message}`); return null; }
    const lower = fields.map(f => f.toLowerCase());
    const cands = CFG.roadFieldCandidates.filter(c => lower.includes(c)).map(c => fields[lower.indexOf(c)]);
    const env = envelopeKm(CFG.roadProbeKm);
    const countAll = async e => Promise.all(cands.map(async f => { const where = `UPPER(${f}) LIKE '%ROAD%'`; try { return { field: f, where, count: await countParcels(base, where, e) }; } catch (_) { return { field: f, where, count: null }; } }));
    let hit = null;
    if (env) hit = (await countAll(env)).find(r => r.count > 0) || null;
    if (!hit) (await countAll(null)).forEach(r => { if (r.count > 0 && (!hit || r.count > hit.count)) hit = r; });
    if (!hit) return null;
    const iw = `UPPER(${hit.field}) LIKE '${CFG.roadIntersectionPattern}'`;
    try {
      const n = await countParcels(base, iw, env);
      if (n > 0 && !(hit.count > 0 && n > hit.count * CFG.roadIntersectionMaxRatio)) hit.where = `(${hit.where}) OR (${iw})`;
    } catch (_) { /* intersections left out */ }
    return { sublayer: CFG.cadastreParcelsSublayer, where: hit.where, source: `parcel filter ${hit.where}` };
  }
  async function loadRoad() {
    const E = M.esri, t0 = now();
    try {
      const road = await resolveRoad();
      if (!road) { diag('road', 'withheld', 'road parcels could not be resolved'); banner('Road reserve hidden: the cadastre’s road parcels couldn’t be resolved here.', 'warn'); return; }
      const url = `${CFG.cadastre}/${road.sublayer}`, o = CFG.roadOutline;
      const fill = (color, outline) => ({ type: 'simple', symbol: { type: 'simple-fill', color, outline: outline || null } });
      const pass = (renderer, extra) => new E.FeatureLayer(Object.assign({ url, definitionExpression: road.where, minScale: CFG.dynamicMinScale, maxScale: 0, renderer }, extra || {}));
      // Three passes in a group outline the reserve as ONE shape (v1's A8): no
      // seams across the road at every intersection.
      const sandy = pass(fill(CFG.roadFill, null));
      await withTimeout(sandy.load(), CFG.timeouts.layer, 'Road reserve');
      const grp = new E.GroupLayer({ title: 'Road reserve', layers: [
        pass(fill(o.color, { color: o.color, width: o.width * 2 })),
        pass(fill([0, 0, 0, 1], null), { blendMode: 'destination-out' }),
        sandy] });
      grp.visible = M.on.road;
      M.layers.road = grp; addOrdered(grp, 'road');
      diag('road', 'loaded', road.source, now() - t0);
    } catch (e) { diag('road', e.isTimeout ? 'timed out' : 'failed', e.message, now() - t0); banner(`Road reserve didn’t load (${e.message}).`, 'warn'); }
  }
  async function loadRail() {
    const E = M.esri, t0 = now();
    try {
      let ids = null;
      try {
        const j = await getJson(CFG.otherTransport + '?f=json', 'Rail schema');
        ids = (j.layers || []).filter(l => !(Array.isArray(l.subLayerIds) && l.subLayerIds.length) && CFG.railInclude.test(l.name || '') && !CFG.railExclude.test(l.name || '')).map(l => l.id);
      } catch (_) { /* fallback ids */ }
      if (!ids || !ids.length) ids = CFG.railSublayersFallback.slice();
      const l = new E.MapImageLayer({ url: CFG.otherTransport, sublayers: ids.map(id => ({ id, visible: true })) });
      await withTimeout(l.load(), CFG.timeouts.layer, 'Rail');
      l.visible = M.on.rail;
      M.layers.rail = l; addOrdered(l, 'rail');
      diag('rail', 'loaded', `sublayers ${ids.join(', ')}`, now() - t0);
    } catch (e) { diag('rail', e.isTimeout ? 'timed out' : 'failed', e.message, now() - t0); }
  }
  function applyToggles() {
    if (M.layers.road) M.layers.road.visible = M.on.road;
    if (M.layers.rail) M.layers.rail.visible = M.on.rail;
    if (M.gl.ghost) M.gl.ghost.visible = M.on.ghost;
    updateShown();
    storeNear();
    drawMarks(); drawBridges(); drawNearby(); renderSide(); renderLegend(); renderEdges();
    if (M.app) M.app.changed({ light: true });
  }

  /* ---------------- things near the station: survey marks, bridges, stations ---------------- */
  const key = a => a ? `${a.lat.toFixed(4)},${a.lon.toFixed(4)}` : '';
  function boxM(a, m) {
    const dLat = m / 111320, dLon = m / (111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)));
    return { w: a.lon - dLon, s: a.lat - dLat, e: a.lon + dLon, n: a.lat + dLat };
  }
  const near = (a, b) => U().haversineM(a, b);
  const away = (a, b) => `${U().fmtDist(near(a, b))} ${U().compass(U().bearingDeg(a, b))}`;

  let surveyLayers = null;
  async function surveySublayers() {
    if (surveyLayers) return surveyLayers;
    const j = await getJson(CFG.survey + '/layers?f=json', 'Survey control layers', CFG.timeouts.query);
    const out = [];
    (j.layers || []).forEach(l => {
      const name = l.name || '';
      if (l.type && l.type !== 'Feature Layer') return;
      if (/destroyed|cadastral/i.test(name)) return;
      const cors = /cors/i.test(name);
      if (!cors && !/(gda|control mark|survey control|ahd)/i.test(name)) return;
      const names = (l.fields || []).map(f => f.name);
      const pick = re => names.find(n => re.test(n));
      const f = { id: pick(/(^|\.)mrk_id$/i), ahd: pick(/(^|\.)ahdheight$/i), cond: pick(/(^|\.)mrkcnd_de$/i), visit: pick(/(^|\.)lastvisit_dt$/i),
        report: pick(/(^|\.)report_url$/i), type: pick(/(^|\.)mrktype_de$/i) };
      if (!f.id) return;
      out.push({ id: l.id, cors, fields: f });
    });
    surveyLayers = out;
    return out;
  }
  async function fetchMarks(a) {
    const t0 = now();
    try {
      const subs = await surveySublayers();
      const b = boxM(a, CFG.marks.radiusM);
      const all = await Promise.all(subs.map(sl => {
        const f = sl.fields, outFields = Object.values(f).filter(Boolean).join(',');
        const params = new URLSearchParams({ where: '1=1', geometry: `${b.w},${b.s},${b.e},${b.n}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
          spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'true', f: 'json' });   // no resultRecordCount: this server answers it with nothing
        return getJson(`${CFG.survey}/${sl.id}/query?${params}`, 'Survey marks', CFG.timeouts.query)
          .then(j => (j.features || []).map(ft => ({ sl, a: ft.attributes || {}, g: ft.geometry || {} }))).catch(() => []);
      }));
      const byId = new Map();
      all.flat().forEach(({ sl, a: at, g }) => {
        const f = sl.fields, id = at[f.id];
        if (id == null || g.x == null) return;
        const ahd = f.ahd && at[f.ahd] != null && isFinite(at[f.ahd]) ? Number(at[f.ahd]) : null;
        const prev = byId.get(String(id));
        if (prev && (prev.ahd != null || ahd == null)) return;
        let report = f.report ? at[f.report] : null;
        if (!report || String(report).indexOf(CFG.surveyReportBase) !== 0) report = `${CFG.surveyReportBase}SCR${String(id).padStart(6, '0')}.pdf`;
        const v = f.visit ? at[f.visit] : null;
        let lastVisit = '';
        if (v) { const d = new Date(Number(v)); if (!isNaN(d)) lastVisit = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; }
        const cond = f.cond ? String(at[f.cond] || '').trim() : '';
        byId.set(String(id), { id: String(id), name: `${sl.cors ? 'CORS' : 'PSM'} ${id}`, lat: g.y, lon: g.x, ahd,
          condition: cond ? cond.charAt(0).toUpperCase() + cond.slice(1).toLowerCase() : '', lastVisit, report,
          type: f.type ? String(at[f.type] || '') : '' });
      });
      const list = [...byId.values()].map(m => Object.assign(m, { d: near(a, m) })).filter(m => m.d <= CFG.marks.radiusM)
        .sort((x, y) => x.d - y.d).slice(0, CFG.marks.max)
        .map((m, i) => Object.assign(m, { ref: `S${i + 1}`, away: away(a, m), good: !/not found|damaged|disturbed|destroyed/i.test(m.condition) }));
      diag('marks', 'loaded', `${list.length} within ${U().fmtDist(CFG.marks.radiusM)}`, now() - t0);
      return list;
    } catch (e) { diag('marks', e.isTimeout ? 'timed out' : 'failed', e.message, now() - t0); return null; }
  }
  const subCache = {};
  async function sublayerId(url, re, fallback) {
    if (subCache[url + re]) return subCache[url + re];
    try { const j = await getJson(url + '/layers?f=json', 'Layer list', CFG.timeouts.query); const l = (j.layers || []).find(x => re.test(x.name || '')); subCache[url + re] = l ? l.id : fallback; }
    catch (_) { subCache[url + re] = fallback; }
    return subCache[url + re];
  }
  async function fetchBridges(a) {
    const t0 = now();
    try {
      const b = boxM(a, CFG.bridges.radiusM);
      const [tid, qid] = await Promise.all([sublayerId(CFG.stateRoads, /^state controlled bridge$/i, 3), sublayerId(CFG.roadsAndTracks, /^bridges$/i, 22)]);
      const q = (url, id, where, fields) => getJson(`${url}/${id}/query?${new URLSearchParams({ where, geometry: `${b.w},${b.s},${b.e},${b.n}`, geometryType: 'esriGeometryEnvelope',
        inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: fields, returnGeometry: 'true', geometryPrecision: '6', f: 'geojson' })}`, 'Bridges', CFG.timeouts.query).catch(() => null);
      const [tj, qj] = await Promise.all([q(CFG.stateRoads, tid, '1=1', 'name,struc_id,struc_type,cons_type,cons_mtrl,rsect_name,road_code'),
        q(CFG.roadsAndTracks, qid, "operational_status NOT IN ('Dismantled','Proposed')", 'objectid,name,feature_type,operational_status,additional_names')]);
      if (!tj && !qj) throw new Error('the bridge registers didn’t answer');
      const str = v => (v == null ? '' : String(v).trim());
      // One per structure on TMR's register (its carriageway points averaged),
      // with the roads it carries (ON) or passes over (OVER).
      const tmr = new Map();
      ((tj || {}).features || []).forEach(f => {
        const g = f.geometry; if (!g || g.type !== 'Point') return;
        const [lon, lat] = g.coordinates, p = f.properties || {};
        const id = p.struc_id != null ? String(p.struc_id) : `${lat},${lon}`;
        const s = tmr.get(id) || { kind: 'tmr', key: `t${id}`, struc: p.struc_id != null ? String(p.struc_id) : '', name: str(p.name), type: str(p.struc_type),
          build: [str(p.cons_type), str(p.cons_mtrl).toLowerCase()].filter(Boolean).join(', '), roads: new Map(), pts: [] };
        s.pts.push({ lat, lon });
        const road = str(p.rsect_name);
        if (road) { const how = s.roads.get(road) || new Set(); how.add(str(p.road_code).toUpperCase() === 'OVER' ? 'over' : 'on'); s.roads.set(road, how); }
        tmr.set(id, s);
      });
      const list = [...tmr.values()].map(s => Object.assign(s, { roads: [...s.roads].map(([name, how]) => ({ name, on: how.has('on'), over: how.has('over') })),
        lat: s.pts.reduce((x, p) => x + p.lat, 0) / s.pts.length, lon: s.pts.reduce((x, p) => x + p.lon, 0) / s.pts.length }));
      // Then Roads and Tracks' bridges that aren't one of those: not TMR's.
      ((qj || {}).features || []).forEach(f => {
        const g = f.geometry; if (!g) return;
        const paths = (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).filter(l => l && l.length);
        const pts = paths.flat().map(([lon, lat]) => ({ lat, lon }));
        if (!pts.length) return;
        const p = f.properties || {};
        const name = str(p.name) || str(p.additional_names);
        const same = list.find(t => t.kind === 'tmr' && pts.some(x => near(x, t) <= CFG.bridges.mergeM));
        if (same) { if (!same.name && name) same.name = name; return; }   // the same bridge
        // Its marker halfway along it, by length.
        let total = 0, run = 0, mid = pts[0];
        for (let i = 1; i < pts.length; i++) total += near(pts[i - 1], pts[i]);
        for (let i = 1; i < pts.length; i++) {
          const d = near(pts[i - 1], pts[i]);
          if (d > 0 && run + d >= total / 2) { const t = (total / 2 - run) / d; mid = { lat: pts[i - 1].lat + t * (pts[i].lat - pts[i - 1].lat), lon: pts[i - 1].lon + t * (pts[i].lon - pts[i - 1].lon) }; break; }
          run += d;
        }
        list.push({ kind: 'qrt', key: `q${p.objectid != null ? p.objectid : `${mid.lat},${mid.lon}`}`, name, type: str(p.feature_type) || 'Road bridge', lat: mid.lat, lon: mid.lon, pts, paths, roads: [] });
      });
      // How far: to the nearest of a structure's points, or anywhere along a
      // bridge's line (a station at one end of a long bridge is at the bridge);
      // which way: to its marker.
      const dist = br => (br.paths ? Math.min(...br.paths.map(l => toLineM(a, l))) : Math.min(...br.pts.map(p => near(a, p))));
      const out = list.map(br => { const d = dist(br); return Object.assign(br, { d, away: `${U().fmtDist(d)} ${U().compass(U().bearingDeg(a, br))}`, road: null, contact: null, asked: false, ref: null }); })
        .filter(br => br.d <= CFG.bridges.radiusM).sort((x, y) => x.d - y.d).slice(0, CFG.bridges.max);
      diag('bridges', 'loaded', `${out.length} within ${U().fmtDist(CFG.bridges.radiusM)}`, now() - t0);
      return out;
    } catch (e) { diag('bridges', e.isTimeout ? 'timed out' : 'failed', e.message, now() - t0); return null; }
  }

  /* ---------------- who manages each bridge, and who to call ---------------- */
  // Queensland Roads and Tracks' road_owner codes, in Flood-Net's classes
  // (map-road-owners.js), so the two apps say it alike. A road declared
  // State-controlled (scr_indicator T) is TMR's whatever the owner code says.
  const ROAD_CLASS = { TMR: 'tmr', LG: 'council', QPWS: 'park', Forestry: 'park', Private: 'private', STATE: 'other', WA: 'other', PA: 'other', UP: 'other', Other: 'other', Unknown: 'unknown' };
  const OTHER_BODY = { STATE: 'another State authority', WA: 'a water authority', PA: 'a port authority', UP: 'a utility provider', Other: 'another body' };
  const ROAD_WHERE = "class NOT IN ('Walkway','Bikeway','Ferry') AND op_status_ind <> 'Proposed'";
  // Metres from a point to a line ([lon, lat] vertices), on a plane — fine over the tens of metres asked about.
  function toLineM(p, line) {
    const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110574;
    if (line.length === 1) return Math.hypot((line[0][0] - p.lon) * kx, (line[0][1] - p.lat) * ky);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - p.lon) * kx, ay = (line[i - 1][1] - p.lat) * ky, bx = (line[i][0] - p.lon) * kx, by = (line[i][1] - p.lat) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }
  // The road a Roads and Tracks bridge carries: of the road segments round it,
  // the one nearest, on average, to both its ends and its middle (a road
  // passing under it is near the middle only).
  async function roadCarried(br) {
    const lons = br.pts.map(p => p.lon), lats = br.pts.map(p => p.lat), pad = 0.0003;
    const id = await sublayerId(CFG.roadsAndTracks, /^roads and tracks$/i, 10);
    const j = await getJson(`${CFG.roadsAndTracks}/${id}/query?${new URLSearchParams({ where: ROAD_WHERE,
      geometry: `${Math.min(...lons) - pad},${Math.min(...lats) - pad},${Math.max(...lons) + pad},${Math.max(...lats) + pad}`, geometryType: 'esriGeometryEnvelope',
      inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', geometryPrecision: '6', f: 'geojson',
      outFields: 'road_name_full,class,road_owner,scr_indicator,lga_name_left,lga_name_right' })}`, 'Roads', CFG.timeouts.query);
    const probe = [br.pts[0], { lat: br.lat, lon: br.lon }, br.pts[br.pts.length - 1]];
    let best = null;
    ((j || {}).features || []).forEach(f => {
      const g = f.geometry; if (!g) return;
      const lines = (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []).filter(l => l && l.length);
      if (!lines.length) return;
      const mean = probe.reduce((x, p) => x + Math.min(...lines.map(l => toLineM(p, l))), 0) / probe.length;
      if (mean <= CFG.bridges.roadM && (!best || mean < best.mean)) best = { mean, p: f.properties || {} };
    });
    if (!best) return { none: true };
    const p = best.p, owner = String(p.road_owner || '').trim() || 'Unknown', scr = String(p.scr_indicator || '').trim().toUpperCase();
    const name = String(p.road_name_full || '').trim();
    return { name: !name || /^(road|track)$/i.test(name) ? '' : name, owner, cls: scr === 'T' || owner === 'TMR' ? 'tmr' : (ROAD_CLASS[owner] || 'unknown'),
      lga: String(p.lga_name_left || p.lga_name_right || '').trim() };
  }
  // QLDTraffic's road lookup, once per ~100 m; values off a third-party
  // service, so only a plain phone number and a plain address are kept.
  const lookups = new Map();
  function contactsAt(lat, lon) {
    const k = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!lookups.has(k)) {
      lookups.set(k, getJson(`${CFG.roadLookup}?lat=${lat.toFixed(6)}&lng=${lon.toFixed(6)}`, 'Road lookup', CFG.timeouts.query).then(list => {
        if (!Array.isArray(list)) throw new Error('the road lookup answered with something unreadable');
        const out = {};
        list.forEach(c => {
          if (!c || typeof c !== 'object') return;
          const type = String(c.contact_type || '').toLowerCase(), name = String(c.display_name || c.name || '').trim();
          const slot = type === 'local' ? 'local' : type === 'district' ? 'district' : type === 'state' ? 'state' : ['busway', 'transurban', 'private_owned'].includes(type) ? 'special' : null;
          if (!slot || !name || out[slot]) return;
          const phone = String(c.phone_number || '').trim(), email = String(c.email || '').trim();
          out[slot] = { name: name.slice(0, 120), phone: /^[0-9 ()+-]{3,24}$/.test(phone) ? phone : '', email: /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(email) ? email : '' };
        });
        return out;
      }).catch(e => { lookups.delete(k); log(`Road lookup: ${e.message}`); return null; }));
    }
    return lookups.get(k);
  }
  // Fill in each bridge's road and contacts; the list is redrawn as they land.
  async function enrichBridges(list) {
    await Promise.all(list.map(async br => {
      const [road, contact] = await Promise.all([br.kind === 'qrt' ? roadCarried(br).catch(() => null) : Promise.resolve(null), contactsAt(br.lat, br.lon)]);
      br.road = road; br.contact = contact; br.asked = true;
    }));
  }
  const cap = t => (t ? t[0].toUpperCase() + t.slice(1) : t);
  // Who manages a bridge, in a few words (who), and why (the basis for it).
  function ownerOf(b) {
    const r = b.road && !b.road.none ? b.road : null;
    const local = b.contact && b.contact.local ? b.contact.local.name : '';
    const council = local || (r && r.lga ? `${r.lga} Council` : 'the council');
    if (b.kind === 'tmr') return { cls: 'tmr', who: 'Transport and Main Roads', why: `On TMR’s register of State-controlled bridges${b.struc ? ` as structure ${b.struc}` : ''}` };
    const not = 'Not on TMR’s bridge register, so it goes with the road it carries';
    if (!r) return { cls: 'council', who: `Normally ${council}`, why: `${not}${!b.asked ? '' : b.road ? ' — which isn’t mapped here' : ' — the State’s road data didn’t answer'}` };
    const road = r.name || 'an unnamed road';
    switch (r.cls) {
      case 'tmr': return { cls: 'tmr', who: 'Transport and Main Roads', why: `${not}: ${road}, a State-controlled road` };
      case 'council': return { cls: 'council', who: council, why: `${not}: ${road}, the council’s as the State records it` };
      case 'unknown': return { cls: 'unknown', who: `${council}, or private`, why: `${not}: ${road}, not State-controlled — the State hasn’t recorded whether it’s the council’s or private` };
      case 'park': return { cls: 'park', who: 'Queensland Parks and Wildlife Service', why: `${not}: ${road}, in a national park or State forest` };
      case 'private': return { cls: 'private', who: 'Private — the owner of the land it crosses', why: `${not}: ${road}, a private road` };
      default: return { cls: 'other', who: cap(OTHER_BODY[r.owner] || 'another public body'), why: `${not}: ${road}` };
    }
  }
  // Who to call: the road's operator where QLDTraffic names one, the TMR
  // district for a State-controlled bridge, the council for any other.
  function contactOf(b) {
    const c = b.contact; if (!c) return null;
    const cls = ownerOf(b).cls;
    if (c.special) return c.special;
    if (cls === 'tmr') return c.district || c.state || null;
    if (cls === 'council' || cls === 'unknown') return c.local || null;
    return null;
  }
  // What it is: its kind, TMR's structure number and build, the roads at it.
  function bridgeTitle(b) {
    if (b.name) return b.name;
    if (b.kind === 'tmr') return b.struc ? `Structure ${b.struc}` : (b.type || 'Bridge');
    const r = b.road && !b.road.none && b.road.name ? b.road.name : '';
    const kind = cap(String(b.type || 'Road bridge').toLowerCase());
    return r ? `${kind} on ${r}` : kind;
  }
  function bridgeWhat(b) {
    if (b.kind === 'tmr') {
      const roads = b.roads.map(r => (r.on && r.over ? `on and over ${r.name}` : r.over ? `over ${r.name}` : `carries ${r.name}`));
      return [b.struc ? `Structure ${b.struc}` : '', b.build, ...roads].filter(Boolean).join(' · ');
    }
    const r = b.road && !b.road.none ? b.road : null;
    return [b.name ? cap(String(b.type || '').toLowerCase()) : '', r && r.name && b.name ? `carries ${r.name}` : ''].filter(Boolean).join(' · ');
  }
  // The bridges whose marker is on the map now, numbered BR1… by distance.
  // Markers close together on screen (a road bridge and its footbridges) share
  // one label, "BR2, BR3, BR4", so the numbers never print over each other.
  function updateShown() {
    let list = [];
    const at = new Map();
    if (M.on.bridges && M.ready && M.view && M.view.width) {
      const W = M.view.width, H = M.view.height, m = 6;
      list = M.bridges.filter(b => { const s = M.view.toScreen(G_(pt(b.lon, b.lat)).geometry); if (s) at.set(b, s); return s && s.x >= m && s.x <= W - m && s.y >= m && s.y <= H - m; });
    }
    M.bridges.forEach(b => { b.ref = null; b.label = null; });
    list.forEach((b, i) => { b.ref = `BR${i + 1}`; });
    const groups = [];
    list.forEach(b => {
      const s = at.get(b), g = groups.find(x => Math.hypot(x.s.x - s.x, x.s.y - s.y) < 26);
      if (g) g.list.push(b); else groups.push({ s, list: [b] });
    });
    // The group's label goes over its top-most marker, clear of the others.
    groups.forEach(g => { g.list.reduce((top, b) => (at.get(b).y < at.get(top).y ? b : top)).label = g.list.map(b => b.ref).join(', '); });
    const sig = list.map(b => `${b.key}:${b.label || ''}`).join('|'), changed = sig !== M.shownSig;
    M.shown = list; M.shownSig = sig;
    return changed;
  }
  // After the map moves: when other bridges are now on it, renumber and retable.
  function refreshShown() {
    if (!updateShown()) return;
    drawBridges(); renderSide(); renderLegend(); storeNear();
    if (M.app) M.app.changed({ light: true });
  }
  async function fetchNearby(a) {
    try {
      const r = await S.floodnet.near(a.lat, a.lon, CFG.nearby.radiusKm, CFG.nearby.max);
      const own = (M.app.session.station || {}).id;
      return (r.stations || []).filter(s => s.id !== own && s.lat != null).map(s => ({ id: s.id, name: s.name, number: s.station_number, lat: s.lat, lon: s.lon, kinds: s.kinds || [] }));
    } catch (e) { log(`Flood-Net stations nearby: ${e.message}`); return []; }
  }
  // Ask again when the location has moved far enough to matter.
  async function refreshNear(force) {
    resolvePins();
    const a = M.anchor;
    if (!a) { M.marks = []; M.bridges = []; M.nearby = []; updateShown(); storeNear(); drawMarks(); drawBridges(); drawNearby(); renderSide(); renderLegend(); return; }
    if (!force && M.fetchedAt && near(M.fetchedAt, a) < 100) return;
    M.fetchedAt = { lat: a.lat, lon: a.lon };
    M.looking = true; renderSide();
    const [marks, bridges, nearby] = await Promise.all([fetchMarks(a), fetchBridges(a), fetchNearby(a)]);
    M.looking = false;
    if (marks) M.marks = marks;
    if (bridges) M.bridges = bridges;
    M.nearby = nearby;
    updateShown();
    storeNear();
    drawMarks(); drawBridges(); drawNearby(); renderSide(); renderLegend(); renderEdges();
    M.app.changed({ light: true });
    if (M.app.ctx) S.form.render(document.getElementById('form'));   // the Benchmark hint
    S.form.renderPS(document.getElementById('ps'));
    // Then who manages each bridge and who to call — the list is up meanwhile.
    if (bridges && bridges.length) {
      await enrichBridges(bridges);
      if (M.bridges !== bridges) return;   // the station moved on meanwhile
      storeNear(); drawBridges(); renderSide(); renderLegend();
      M.app.changed({ light: true });
      S.form.renderPS(document.getElementById('ps'));
    }
  }
  // Keep what the Word copy and the playbook need in the session.
  function storeNear() {
    const s = M.app.session;
    s.map.marks = M.on.marks ? M.marks.map(m => ({ id: m.id, ref: m.ref, name: m.name, lat: m.lat, lon: m.lon, ahd: m.ahd, condition: m.condition, lastVisit: m.lastVisit, report: m.report, away: m.away })) : [];
    // Only the bridges on the map (BR1…), as the picture shows them.
    s.map.bridges = M.shown.map(b => { const o = ownerOf(b), c = contactOf(b); return { ref: b.ref, kind: b.kind, title: bridgeTitle(b), what: bridgeWhat(b),
      who: o.who, why: o.why, contact: c ? { name: c.name, phone: c.phone, email: c.email } : null, lat: b.lat, lon: b.lon, away: b.away }; });
    // The nearest bridge, close enough to be the one equipment might attach to,
    // fills Property Services' bridge detail (shown once that answer is Yes).
    const b = M.bridges.find(x => x.d <= CFG.bridges.prefillWithinM);
    s.prefill.__ps = s.prefill.__ps || {};
    if (b) {
      const o = ownerOf(b), c = contactOf(b);
      s.prefill.__ps['bridgeAttach.detail'] = `${bridgeTitle(b)}, ${b.away} of the station — managed by ${o.who}. ${o.why}.${c ? ` Contact: ${c.name}${c.phone ? ', ' + c.phone : ''}.` : ''}`;
    } else delete s.prefill.__ps['bridgeAttach.detail'];
  }

  // Anything that changes what the picture would show moves the version on, and
  // tells the page (which re-takes the preview's picture when it is in view).
  function changedPicture() { M.version++; if (M.app && M.app.mapChanged) M.app.mapChanged(); }

  /* ---------------- drawing on the map ---------------- */
  const G_ = (geometry, symbol, attributes) => new M.esri.Graphic({ geometry, symbol, attributes: attributes || {} });
  const pt = (lon, lat) => ({ type: 'point', longitude: lon, latitude: lat });
  const text = (t, color, yoff, size) => ({ type: 'text', text: t, color: color || [255, 255, 255], haloColor: [20, 20, 20, 0.85], haloSize: 1.5,
    yoffset: yoff == null ? 14 : yoff, font: { size: size || 11, weight: 'bold', family: 'Arial' } });

  function drawPins() {
    if (!M.ready) return;
    changedPicture();
    const L = M.gl.pins; L.removeAll(); M.gl.ghost.removeAll();
    const st = M.app.session.station;
    // Where Flood-Net has the station, once the position on the map differs from
    // it by enough to see. A working aid only: left out of the Word picture.
    const cur = M.pins.find(p => p.anchor && p.shown && p.ok);
    if (st && st.lat != null && (!cur || near(cur, st) >= 10)) {
      M.gl.ghost.add(G_(pt(st.lon, st.lat), { type: 'simple-marker', style: 'circle', size: 20, color: [0, 0, 0, 0], outline: { color: [214, 40, 40, 1], width: 2, style: 'dash' } }, { kind: 'fn' }));
      M.gl.ghost.add(G_(pt(st.lon, st.lat), text(`${st.source === 'manual' ? 'Position entered' : 'Flood-Net position'}${cur ? ' (' + U().fmtDist(near(cur, st)) + ' away)' : ''} — not in the Word picture`, [255, 220, 220], -20, 10)));
    }
    shownPins().forEach(p => {
      L.add(G_(pt(p.lon, p.lat), { type: 'simple-marker', style: 'circle', size: 15, color: rgb(p.colour).concat(1), outline: { color: [255, 255, 255, 1], width: 2 } }, { pin: p.key }));
      L.add(G_(pt(p.lon, p.lat), text(p.label), { pinLabel: p.key }));
    });
  }
  function drawMarks() {
    if (!M.ready) return;
    changedPicture();
    const L = M.gl.marks; L.removeAll();
    if (!M.on.marks) return;
    const hidden = new Set(M.app.session.map.hiddenMarks || []);
    M.marks.forEach(m => {
      if (hidden.has(m.id)) return;
      const col = m.good ? [27, 79, 114, 1] : [120, 120, 120, 1];
      L.add(G_(pt(m.lon, m.lat), { type: 'simple-marker', style: 'circle', size: 13, color: [255, 255, 255, 0.85], outline: { color: col, width: 2.5 } }, { mark: m.id }));
      if (m.ahd != null) L.add(G_(pt(m.lon, m.lat), { type: 'simple-marker', style: 'circle', size: 4, color: col, outline: null }));
      L.add(G_(pt(m.lon, m.lat), text(m.ref, [255, 255, 255], 12, 10)));
    });
  }
  function drawBridges() {
    if (!M.ready) return;
    changedPicture();
    const L = M.gl.bridges; L.removeAll();
    if (!M.on.bridges) return;
    const col = b => (b.kind === 'tmr' ? [128, 0, 32, 1] : [110, 76, 60, 1]);
    // A Roads and Tracks bridge is a line: its span is drawn, so the bridge
    // shows where the road reserve stops at a creek's banks.
    M.bridges.forEach(b => (b.paths || []).forEach(path => {
      const line = (color, width) => L.add(G_({ type: 'polyline', paths: [path], spatialReference: { wkid: 4326 } }, { type: 'simple-line', color, width, cap: 'round' }));
      line([255, 255, 255, 0.9], 6); line(col(b), 3.5);
    }));
    M.bridges.forEach(b => {
      L.add(G_(pt(b.lon, b.lat), { type: 'simple-marker', style: 'diamond', size: 13, color: col(b), outline: { color: [255, 255, 255, 1], width: 1.5 } }, { bridge: b.key }));
      if (b.label) L.add(G_(pt(b.lon, b.lat), text(b.label, [255, 240, 230], 12, 10)));
    });
  }
  function drawNearby() {
    if (!M.ready) return;
    changedPicture();
    const L = M.gl.nearby; L.removeAll();
    if (!M.on.nearby) return;
    M.nearby.forEach(s => {
      L.add(G_(pt(s.lon, s.lat), { type: 'simple-marker', style: 'circle', size: 8, color: [235, 235, 235, 0.9], outline: { color: [60, 60, 60, 0.9], width: 1 } }));
      L.add(G_(pt(s.lon, s.lat), text(s.name, [235, 235, 235], 10, 9)));
    });
  }
  function features() { return M.app.session.map.features = M.app.session.map.features || []; }
  function drawFeatures() {
    if (!M.ready) return;
    changedPicture();
    const L = M.gl.draw, E = M.esri; L.removeAll();
    const ctx = M.app.ctx;
    features().forEach(f => {
      const q = ctx.byCode[f.q];
      if (q && !R().visible(ctx, q)) return;
      if (f.kind === 'circle') {
        const r = Number(R().eff(ctx, f.q).fields[(q && q.mapDraw && q.mapDraw.field) || 'radius']) || f.radiusM || 0;
        if (!r) return;
        const poly = E.geometryEngine.geodesicBuffer(G_(pt(f.lon, f.lat)).geometry, r, 'meters');
        L.add(G_(poly, { type: 'simple-fill', color: DRAW_RGB.concat(0.18), outline: { color: DRAW_RGB.concat(1), width: 2, style: 'dash' } }, { feature: f.id }));
        L.add(G_(pt(f.lon, f.lat), text(`Clearance ${r} m`, [220, 255, 225], -18, 10)));
      } else if (f.kind === 'tree') {
        L.add(G_(pt(f.lon, f.lat), { type: 'simple-marker', style: 'triangle', size: 13, color: DRAW_RGB.concat(1), outline: { color: [255, 255, 255, 1], width: 1.5 } }, { feature: f.id }));
        L.add(G_(pt(f.lon, f.lat), text(f.ref, [220, 255, 225], 12, 10)));
      } else if (f.kind === 'line' && f.path && f.path.length > 1) {
        L.add(G_({ type: 'polyline', paths: [f.path], spatialReference: { wkid: 4326 } }, { type: 'simple-line', color: [255, 170, 0, 1], width: 3.5 }, { feature: f.id }));
        const mid = f.path[Math.floor(f.path.length / 2)];
        L.add(G_(pt(mid[0], mid[1]), text(`Access track ${Math.round(f.lengthM || 0)} m`, [255, 235, 200], 12, 10)));
      }
    });
  }
  function startDraw(code) {
    const q = M.app.ctx.byCode[code];
    if (!q || !q.mapDraw) return;
    if (!M.ready) { M.app.toast('The map hasn’t loaded yet.'); return; }
    if (q.mapDraw.kind === 'circle') {
      startPlace({ kind: 'circle', q: code, label: 'Click the centre of the clearance (usually the station)' });
    } else if (q.mapDraw.kind === 'line') {
      cancelPlace();
      if (!M.sketch) M.sketch = new M.esri.SketchViewModel({ view: M.view, layer: M.gl.draw, updateOnGraphicClick: false });
      M.drawing = true;
      showMap();
      setPlaceHint('Click along the route — double-click, press Enter or ✓ Finish route when done');
      M.els.drawActs.hidden = false;
      M.sketch.create('polyline');
      const hnd = M.sketch.on('create', ev => {
        if (ev.state !== 'active') log(`Drawing: ${ev.state}${ev.toolEventInfo ? ' (' + ev.toolEventInfo.type + ')' : ''}${ev.graphic && ev.graphic.geometry ? `, ${(ev.graphic.geometry.paths[0] || []).length} points` : ''}`);
        else if (ev.toolEventInfo && ev.toolEventInfo.type === 'vertex-add') log('Drawing: point added');
        if (ev.state === 'cancel') { hnd.remove(); M.drawing = false; M.els.drawActs.hidden = true; setPlaceHint(null); drawFeatures(); return; }
        if (ev.state !== 'complete') return;
        hnd.remove(); M.drawing = false; M.els.drawActs.hidden = true; setPlaceHint(null);
        if (!ev.graphic || !ev.graphic.geometry || !(ev.graphic.geometry.paths[0] || []).length || ev.graphic.geometry.paths[0].length < 2) { drawFeatures(); M.app.toast('A route needs at least two points.'); return; }
        const g = ev.graphic.geometry;
        const lengthM = M.esri.geometryEngine.geodesicLength(g, 'meters');
        const merc = g.spatialReference && g.spatialReference.isWebMercator;
        const path = (g.paths[0] || []).map(([x, y]) => (merc ? M.esri.webMercatorUtils.xyToLngLat(x, y) : [x, y]).map(n => Math.round(n * 1e6) / 1e6));
        const fs = features().filter(f => !(f.kind === 'line' && f.q === code));
        fs.push({ id: U().uuid(), kind: 'line', q: code, path, lengthM: Math.round(lengthM) });
        M.app.session.map.features = fs;
        // The length fills the question's length field (as a suggestion from the map).
        const pre = M.app.session.prefill[code] = Object.assign({ src: 'map', fields: {} }, M.app.session.prefill[code] || {});
        pre.src = 'map'; pre.fields[q.mapDraw.field] = String(Math.round(lengthM));
        M.app.changed();
        drawFeatures();
        M.app.toast(`Access track drawn: ${Math.round(lengthM)} m.`);
      });
    }
  }
  function addTree(lat, lon) {
    const fs = features();
    const n = fs.filter(f => f.kind === 'tree').length + 1;
    fs.push({ id: U().uuid(), kind: 'tree', q: 'vegetation', ref: `T${n}`, lat, lon });
    const pre = M.app.session.prefill.vegetation = Object.assign({ src: 'map', fields: {} }, M.app.session.prefill.vegetation || {});
    pre.src = 'map';
    pre.fields.detail = `Trees to remove marked on the site map (T1${n > 1 ? '–T' + n : ''})`;
    M.app.changed(); drawFeatures();
  }

  /* ---------------- interaction: place, drag, click ---------------- */
  function setPlaceHint(t) { M.els.placeHint.hidden = !t; M.els.placeHint.textContent = t || ''; M.els.view.classList.toggle('placing', !!t); }
  // Bring the map into view for a click on it (the button may be below it, in a scrolled card).
  function showMap() { const f = M.els.view && M.els.view.closest('.map-frame'); if (f) f.scrollIntoView({ block: 'nearest' }); }
  function startPlace(p) { if (!M.ready) { M.app.toast('The map hasn’t loaded yet.'); return; } setMove(false); M.place = p; setPlaceHint(`${p.label} — Esc to cancel`); showMap(); }
  function cancelPlace() { M.place = null; if (M.drawing && M.sketch) M.sketch.cancel(); M.drawing = false; if (M.els.drawActs) M.els.drawActs.hidden = true; setPlaceHint(null); }
  function findPin(hit) {
    for (const r of (hit && hit.results) || []) { const a = r.graphic && r.graphic.attributes; if (a && a.pin) return r.graphic; }
    return null;
  }
  function attachInteraction() {
    const v = M.view;
    v.on('click', ev => {
      if (M.place) {
        const p = M.place; const mp = ev.mapPoint; cancelPlace();
        if (!mp) return;
        if (p.kind === 'pin') { const pin = M.pins.find(x => x.key === p.key); if (pin) writePin(pin, mp.latitude, mp.longitude, 'place'); }
        else if (p.kind === 'circle') {
          const fs = features().filter(f => !(f.kind === 'circle' && f.q === p.q));
          fs.push({ id: U().uuid(), kind: 'circle', q: p.q, lat: mp.latitude, lon: mp.longitude });
          M.app.session.map.features = fs;
          const q = M.app.ctx.byCode[p.q];
          if (!Number(R().eff(M.app.ctx, p.q).fields[q.mapDraw.field])) { ans(p.q).fields[q.mapDraw.field] = '10'; M.app.toast('Clearance circle placed at 10 m — change the radius in the Vegetation Management question.'); }
          M.app.changed(); drawFeatures();
        } else if (p.kind === 'tree') addTree(mp.latitude, mp.longitude);
        ev.stopPropagation();
        return;
      }
      v.hitTest(ev).then(hit => {
        for (const r of hit.results || []) {
          const a = r.graphic && r.graphic.attributes || {};
          if (a.mark || a.bridge) { const el = M.els.side.querySelector(`[data-ref="${a.mark ? 'm-' + a.mark : 'b-' + a.bridge}"]`); if (el) { el.scrollIntoView({ block: 'nearest' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); } return; }
        }
      }).catch(() => {});
    });
    v.on('pointer-move', ev => {
      if (!M.move || M.drag) return;
      v.hitTest(ev).then(hit => { M.hover = findPin(hit); M.els.view.classList.toggle('grab', !!M.hover); }).catch(() => {});
    });
    v.on('drag', ev => {
      if (!M.move) return;
      if (ev.action === 'start') {
        if (M.hover) { M.drag = M.hover; M.els.view.classList.add('grabbing'); ev.stopPropagation(); }
      } else if (ev.action === 'update' && M.drag) {
        const p = v.toMap({ x: ev.x, y: ev.y });
        if (p) { M.drag.geometry = pt(p.longitude, p.latitude); const lab = M.gl.pins.graphics.find(g => g.attributes && g.attributes.pinLabel === M.drag.attributes.pin); if (lab) lab.geometry = pt(p.longitude, p.latitude); }
        ev.stopPropagation();
      } else if (ev.action === 'end' && M.drag) {
        const g = M.drag; M.drag = null; M.els.view.classList.remove('grabbing');
        const pin = M.pins.find(x => x.key === g.attributes.pin);
        if (pin) writePin(pin, Math.round(g.geometry.latitude * 1e6) / 1e6, Math.round(g.geometry.longitude * 1e6) / 1e6, 'drag');
        ev.stopPropagation();
      }
    });
  }
  function setMove(on) {
    M.move = !!on;
    if (M.move && M.measure) setMeasure(false);
    M.els.moveBtn.setAttribute('aria-pressed', String(M.move));
    M.els.moveBtn.classList.toggle('on', M.move);
    if (!M.move) { M.hover = null; M.drag = null; M.els.view.classList.remove('grab', 'grabbing'); }
    applyZoomLock();
  }
  /* Zoom lock (🔒, above + / −): on when the page opens. */
  function setZoomLock(on) {
    M.zoomLocked = !!on;
    if (!M.zoomLocked) M.els.lockHint.classList.remove('show');
    applyZoomLock();
  }
  function paintLock() {
    const b = M.els.lockBtn; if (!b) return;
    b.textContent = M.zoomLocked ? '🔒' : '🔓';
    b.setAttribute('aria-pressed', String(M.zoomLocked));
    b.classList.toggle('off', !M.zoomLocked);
    b.title = M.zoomLocked
      ? 'Zoom locked: the mouse wheel scrolls the page past the map. Zoom with + / − or Ctrl + scroll (on a touch screen, one finger scrolls the page and two move the map). Click to unlock.'
      : 'Zoom unlocked: the mouse wheel zooms the map. Click to lock it again, so the wheel scrolls the page.';
  }
  function applyZoomLock() {
    paintLock();
    // Touch screens: while locked, one finger scrolls the page and two move the
    // map — except while moving pins, which needs a one-finger drag.
    const nav = M.view && M.view.navigation;
    if (nav && 'browserTouchPanEnabled' in nav) nav.browserTouchPanEnabled = !M.zoomLocked || M.move;
  }
  let lockHintTimer = null;
  function lockHint() {
    if (!M.ready) return;
    M.els.lockHint.classList.add('show');
    clearTimeout(lockHintTimer);
    lockHintTimer = setTimeout(() => M.els.lockHint.classList.remove('show'), 1800);
  }
  function setMeasure(on) {
    if (!M.ready) return;
    if (on && !M.measure) {
      setMove(false);
      M.measure = new M.esri.DistanceMeasurement2D({ view: M.view, unit: 'metric' });
      M.view.ui.add(M.measure, 'top-right');
      try { M.measure.viewModel.start(); } catch (_) { /* older API */ }
    } else if (!on && M.measure) { M.view.ui.remove(M.measure); M.measure.destroy(); M.measure = null; }
    M.els.measureBtn.setAttribute('aria-pressed', String(!!M.measure));
    M.els.measureBtn.classList.toggle('on', !!M.measure);
  }

  /* ---------------- framing ---------------- */
  // Home: the whole of Queensland (a new session, or no station yet).
  function home() {
    if (!M.ready) return;
    const q = CFG.qld, W = M.esri.webMercatorUtils;
    const [x0, y0] = W.lngLatToXY(q.xmin, q.ymin), [x1, y1] = W.lngLatToXY(q.xmax, q.ymax);
    M.view.goTo(new M.esri.Extent({ xmin: x0, ymin: y0, xmax: x1, ymax: y1, spatialReference: { wkid: 3857 } }), { animate: false })
      .catch(e => log(`Going back to Queensland didn’t finish: ${e && (e.name || e.message)}`));
  }
  async function frame(all) {
    if (!M.ready) return;
    const pts = shownPins();
    try {
      if (pts.length > 1 && all) await M.view.goTo(pts.map(p => G_(pt(p.lon, p.lat))), { animate: false }).then(() => { if (M.view.zoom > 18) M.view.zoom = 18; else M.view.zoom = M.view.zoom - 0.6; });
      else if (M.anchor) await M.view.goTo({ center: [M.anchor.lon, M.anchor.lat], zoom: CFG.siteZoom }, { animate: false });
    } catch (e) { log(`Framing didn’t finish: ${e && (e.name || e.message)}`); }
  }

  /* ---------------- the location check ---------------- */
  function renderCheck() {
    const el = M.els.check; if (!el) return;
    el.innerHTML = '';
    const st = M.app.session.station;
    const cur = M.pins.find(p => p.anchor && p.shown && p.ok);
    if (!st) { el.appendChild(h('p', { class: 'hint' }, 'Choose a station above — or place its location on the map from the list beside it.')); return; }
    const byHand = st.source === 'manual', rec = byHand ? 'the position entered' : 'Flood-Net’s record';
    if (st.lat == null) { el.appendChild(h('p', { class: 'hint' }, `${byHand ? 'No position entered for this station yet' : 'Flood-Net has no position for this station'}. Place it on the map from the list beside it.`)); return; }
    if (st.checked) {
      el.appendChild(h('div', { class: 'check-ok' }, `✓ Position checked ${U().fmtWhen(st.checked.at)} — ${st.checked.movedM >= 1 ? `moved ${U().fmtDist(st.checked.movedM)} from ${rec}` : `${rec.charAt(0).toUpperCase() + rec.slice(1)} was right`}.`, ' ',
        h('button', { type: 'button', class: 'link', onclick: () => { st.checked = null; M.app.changed(); } }, 'Check again')));
      return;
    }
    const p = st.precision || U().coordPrecision(st.lat, st.lon);
    const coarse = p.places <= 4;
    el.appendChild(h('div', { class: 'check-todo' + (coarse ? ' coarse' : '') },
      h('div', null, h('b', null, 'Check the station’s position. '),
        `${byHand ? 'You entered' : 'Flood-Net has it at'} ${U().formatCoord(st.lat, st.lon)} — ${p.places} decimal places (${p.metres < 1 ? 'under 1 m' : '±' + U().fmtDist(p.metres)}). `,
        coarse && !byHand ? 'Older records are often rounded like this. ' : '',
        'Turn on ', h('b', null, '✥ Move pins'), ' and drag the red pin onto the equipment in the imagery, or type the position in the list — then:'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: confirmPosition }, '✓ Position checked')));
  }
  function confirmPosition() {
    const st = M.app.session.station; if (!st) return;
    resolvePins();
    const cur = M.pins.find(p => p.anchor && p.shown && p.ok);
    const pos = cur ? { lat: cur.lat, lon: cur.lon } : { lat: st.lat, lon: st.lon };
    const moved = st.lat != null ? near(st, pos) : 0;
    if (moved > 500 && !G.confirm(`The position you’ve set is ${U().fmtDist(moved)} from ${st.source === 'manual' ? 'the position entered for' : 'where Flood-Net has'} ${st.name}. Is that right? (A move this big is usually the wrong station or a typo.)`)) return;
    st.checked = { lat: pos.lat, lon: pos.lon, movedM: st.lat != null ? Math.round(near(st, pos) * 10) / 10 : 0, at: Date.now() };
    if (cur) ans(cur.code).fields[cur.field] = U().formatCoord(pos.lat, pos.lon);
    M.app.changed();
    refreshNear(false);
  }

  /* ---------------- side panel ---------------- */
  function renderSide() {
    const el = M.els.side; if (!el || !M.app || !M.app.ctx) return;
    const keep = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    el.innerHTML = '';
    el.appendChild(h('h4', null, 'Locations'));
    M.pins.forEach(p => {
      const input = h('input', { type: 'text', value: p.raw, 'data-fk': `map::${p.key}`, placeholder: 'lat, lon — or Place', 'aria-label': `${p.label} coordinates` });
      const commit = () => {
        const v = input.value.trim();
        if (v === p.raw.trim()) return;
        if (!v) { writePin(p, null); return; }
        const r = U().parseCoord(v);
        if (!r.ok) { M.app.toast(r.error || 'That doesn’t read as coordinates.'); return; }
        writePin(p, r.lat, r.lon, 'typed');
        if (M.ready) M.view.goTo({ center: [r.lon, r.lat] }, { animate: false }).catch(() => {});
      };
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') input.value = p.raw; });
      input.addEventListener('blur', commit);
      const gateNote = !p.shown && p.gate && p.gate.q ? `Placing it sets ${((M.app.ctx.byCode[p.gate.q] || {}).label) || p.gate.q} to ${p.gate.is === 'yes' ? 'Yes' : p.gate.is}` : '';
      el.appendChild(h('div', { class: 'loc' + (p.shown && p.ok ? '' : ' empty'), dataset: { pin: p.key } },
        h('div', { class: 'loc-head' }, h('span', { class: 'dot', style: { background: `rgb(${rgb(p.colour).join(',')})` } }), h('span', { class: 'loc-label' }, p.label),
          p.src && p.src !== 'user' && p.ok ? h('span', { class: `src src-${p.src}` }, p.src === 'floodnet' ? 'Flood-Net' : p.src === 'map' ? 'Map' : p.src) : null),
        h('div', { class: 'fld-line' }, input,
          h('button', { type: 'button', class: 'btn-mini', title: 'Click on the map to set it', onclick: () => startPlace({ kind: 'pin', key: p.key, label: `Click where the ${p.label.toLowerCase()} is` }) }, 'Place')),
        gateNote ? h('div', { class: 'hint' }, gateNote) : null));
    });
    if (!M.pins.length) el.appendChild(h('p', { class: 'hint' }, 'This table has no locations.'));
    // Things drawn for the scope.
    const ctx = M.app.ctx, drawQs = ctx.qs.filter(q => q.mapDraw && R().visible(ctx, q));
    if (drawQs.length) {
      el.appendChild(h('h4', null, 'Drawn for the scope'));
      drawQs.forEach(q => {
        const fs = features().filter(f => f.q === q.code);
        const row = h('div', { class: 'loc' }, h('div', { class: 'loc-label' }, q.mapDraw.label));
        if (q.mapDraw.kind === 'circle') {
          row.appendChild(h('div', { class: 'fld-line' },
            h('button', { type: 'button', class: 'btn-mini', onclick: () => startDraw(q.code) }, fs.some(f => f.kind === 'circle') ? '◯ Move circle' : '◯ Place circle'),
            h('button', { type: 'button', class: 'btn-mini', onclick: () => startPlace({ kind: 'tree', label: 'Click a tree to remove' }) }, '▲ Mark a tree'),
            fs.length ? h('button', { type: 'button', class: 'link', onclick: () => { M.app.session.map.features = features().filter(f => f.q !== q.code); delete (M.app.session.prefill[q.code] || { fields: {} }).fields.detail; M.app.changed(); drawFeatures(); } }, 'Clear') : null));
          const trees = fs.filter(f => f.kind === 'tree');
          if (trees.length) row.appendChild(h('div', { class: 'hint' }, `${trees.length} tree${trees.length > 1 ? 's' : ''} marked (${trees.map(t => t.ref).join(', ')})`));
        } else {
          const line = fs.find(f => f.kind === 'line');
          row.appendChild(h('div', { class: 'fld-line' },
            h('button', { type: 'button', class: 'btn-mini', onclick: () => startDraw(q.code) }, line ? '〰 Redraw route' : '〰 Draw route'),
            line ? h('span', { class: 'hint' }, `${line.lengthM} m`) : null,
            line ? h('button', { type: 'button', class: 'link', onclick: () => { M.app.session.map.features = features().filter(f => f.id !== line.id); M.app.changed(); drawFeatures(); } }, 'Clear') : null));
        }
        el.appendChild(row);
      });
    }
    // Survey marks.
    el.appendChild(h('h4', null, 'State survey marks ', h('span', { class: 'hint', title: 'Queensland’s survey control (QSpatial). The station’s own Bureau benchmarks are on the Local TBM question.' }, `QSpatial, within ${U().fmtDist(CFG.marks.radiusM)}, nearest ${CFG.marks.max}`)));
    if (!M.on.marks) el.appendChild(h('p', { class: 'hint' }, 'Switched off.'));
    else if (!M.anchor) el.appendChild(h('p', { class: 'hint' }, 'Shown once the station has a location.'));
    else if (M.looking && !M.marks.length) el.appendChild(h('p', { class: 'hint' }, 'Asking the State’s survey register…'));
    else if (!M.marks.length) el.appendChild(h('p', { class: 'hint' }, M.diag.marks && M.diag.marks.status !== 'loaded' ? `Couldn’t ask the survey register (${M.diag.marks.note}).` : 'None registered within 2 km.'));
    const hidden = new Set(M.app.session.map.hiddenMarks || []);
    M.on.marks && M.marks.forEach(m => {
      const tick = h('input', { type: 'checkbox', checked: !hidden.has(m.id), title: 'Show on the map and list in the Word copy' });
      tick.addEventListener('change', ev => {
        const hm = new Set(M.app.session.map.hiddenMarks || []);
        if (ev.target.checked) hm.delete(m.id); else hm.add(m.id);
        M.app.session.map.hiddenMarks = [...hm];
        drawMarks(); renderLegend(); renderEdges(); M.app.changed({ light: true });
      });
      el.appendChild(h('div', { class: 'mark' + (m.good ? '' : ' poor'), dataset: { ref: `m-${m.id}` } },
        h('label', { class: 'mark-tick' }, tick, h('b', null, m.ref)),
        h('div', null, h('a', { href: m.report, target: '_blank', rel: 'noopener', title: 'Survey Control Mark Report (PDF)' }, m.name), ' · ',
          m.ahd != null ? `benchmark ${m.ahd} m AHD` : 'no AHD height', h('br'),
          h('span', { class: 'hint' }, [m.condition, m.lastVisit && `last visited ${m.lastVisit}`, m.away].filter(Boolean).join(' · ')))));
    });
    // Bridges: the ones on the map, and who manages each.
    el.appendChild(h('h4', { title: 'Road bridges on the map (from those within 1 km), numbered BR1… by distance, and who manages each: Transport and Main Roads for a bridge on its register of State-controlled bridges, otherwise whoever manages the road it carries. A bridge over a creek often sits outside the road reserve — the creek’s bed is a parcel of its own, so the reserve stops at each bank — but it is still the road’s.' },
      'Bridges ', h('span', { class: 'hint' }, 'on the map — who manages them')));
    if (!M.on.bridges) el.appendChild(h('p', { class: 'hint' }, 'Switched off.'));
    else if (!M.anchor) el.appendChild(h('p', { class: 'hint' }, 'Shown once the station has a location.'));
    else if (M.looking && !M.bridges.length) el.appendChild(h('p', { class: 'hint' }, 'Asking the bridge registers…'));
    else if (!M.bridges.length) el.appendChild(h('p', { class: 'hint' }, M.diag.bridges && M.diag.bridges.status !== 'loaded' ? `Couldn’t ask the bridge registers (${M.diag.bridges.note}).` : `None within ${U().fmtDist(CFG.bridges.radiusM)}.`));
    if (M.on.bridges) {
      M.shown.forEach(b => {
        const o = ownerOf(b), c = contactOf(b), what = bridgeWhat(b);
        el.appendChild(h('div', { class: 'mark', dataset: { ref: `b-${b.key}` } }, h('b', null, b.ref),
          h('div', null, bridgeTitle(b), what ? [h('br'), h('span', { class: 'hint' }, what)] : null, h('br'),
            'Managed by ', h('b', null, o.who), h('br'), h('span', { class: 'hint' }, o.why),
            c ? [h('br'), 'Contact: ', c.name, c.phone ? [' · ', h('a', { href: `tel:${c.phone.replace(/[^0-9+]/g, '')}` }, c.phone)] : null,
              c.email ? [' · ', h('a', { href: `mailto:${c.email}` }, c.email)] : null] : !b.asked ? [h('br'), h('span', { class: 'hint' }, 'Contact: asking QLDTraffic’s road lookup…')] : null,
            h('br'), h('span', { class: 'hint' }, b.away))));
      });
      const off = M.bridges.length - M.shown.length;
      if (off > 0) el.appendChild(h('p', { class: 'hint' }, `${M.shown.length ? `${off} more` : off} within ${U().fmtDist(CFG.bridges.radiusM)} ${off > 1 ? 'are' : 'is'} off the map, so left out of the key and the Word copy — zoom out to bring ${off > 1 ? 'them' : 'it'} in.`));
    }
    if (keep) { const k = el.querySelector(`[data-fk="${CSS.escape(keep)}"]`); if (k) k.focus(); }
  }

  /* ---------------- legend, contour stamp, edge pointers (on screen; the picture repeats them) ---------------- */
  function legendItems() {
    const items = [];
    const st = S.word && S.word.stationLine(M.app.session);
    if (st) items.push({ kind: 'title', colour: [21, 37, 49], label: st });
    shownPins().forEach(p => items.push({ kind: 'pin', colour: rgb(p.colour), label: p.label, sub: U().formatCoord(p.lat, p.lon) }));
    const ctx = M.app.ctx, fs = features();
    if (fs.some(f => f.kind === 'circle')) { const f = fs.find(x => x.kind === 'circle'); const r = Number(R().eff(ctx, f.q).fields.radius) || 0; if (r) items.push({ kind: 'circle', colour: DRAW_RGB, label: `Vegetation clearance (${r} m radius)` }); }
    const trees = fs.filter(f => f.kind === 'tree');
    if (trees.length) items.push({ kind: 'tree', colour: DRAW_RGB, label: `Trees to remove (${trees.map(t => t.ref).join(', ')})` });
    const line = fs.find(f => f.kind === 'line');
    if (line) items.push({ kind: 'line', colour: [255, 170, 0], label: `Access track (${line.lengthM} m)` });
    const hidden = new Set(M.app.session.map.hiddenMarks || []);
    const marks = M.on.marks ? M.marks.filter(m => !hidden.has(m.id)) : [];
    if (marks.length) items.push({ kind: 'mark', colour: [27, 79, 114], label: `State survey marks ${marks.map(m => m.ref).join(', ')} — table below the map` });
    if (M.on.bridges && M.shown.length) items.push({ kind: 'bridge', colour: M.shown.some(b => b.kind === 'tmr') ? [128, 0, 32] : [110, 76, 60],
      label: `${M.shown.length > 1 ? 'Bridges' : 'Bridge'} ${M.shown.map(b => b.ref).join(', ')} — who manages ${M.shown.length > 1 ? 'them' : 'it'}: table below the map` });
    const stamp = stampText();
    if (stamp) items.push({ kind: 'contour', colour: CFG.contourLine.color.slice(0, 3), label: stamp });
    return items;
  }
  function renderLegend() {
    const el = M.els.legend; if (!el) return;
    el.innerHTML = '';
    const items = legendItems();
    el.hidden = !items.length;
    items.forEach(i => el.appendChild(i.kind === 'title' ? h('div', { class: 'lg-title' }, i.label) : h('div', { class: 'lg' }, h('span', { class: `lg-sym lg-${i.kind}`, style: { '--c': `rgb(${i.colour.join(',')})` } }),
      h('span', null, h('b', null, i.label), i.sub ? h('span', { class: 'lg-sub' }, i.sub) : null))));
  }
  function stampText() { return M.contour === 'off' ? '' : `Contours: ${M.contour} m LiDAR${M.view && M.view.scale > CFG.dynamicMinScale ? ' (zoom in to see them)' : ''}`; }
  // The contour caption is in the key (below the map): redrawn when it changes.
  let lastStamp = null;
  function renderStamp() { const t = stampText(); if (t !== lastStamp) { lastStamp = t; renderLegend(); } }
  // Survey marks outside the current view: an arrow at the edge, pointing at them.
  function offscreenMarks() {
    if (!M.ready || !M.on.marks) return [];
    const hidden = new Set(M.app.session.map.hiddenMarks || []);
    const W = M.view.width, H = M.view.height, out = [];
    M.marks.forEach(m => {
      if (hidden.has(m.id)) return;
      const s = M.view.toScreen(G_(pt(m.lon, m.lat)).geometry);
      if (!s || (s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H)) return;
      const cx = W / 2, cy = H / 2, dx = s.x - cx, dy = s.y - cy;
      const k = Math.min((W / 2 - 22) / Math.abs(dx || 1e-9), (H / 2 - 22) / Math.abs(dy || 1e-9));
      out.push({ m, x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx), label: `${m.ref} ${U().fmtDist(m.d)}` });
    });
    // Labels on the same edge are spread apart along it so none overlap (the
    // key and the contour caption are below the map, so nothing else is in the way).
    const edgeOf = o => (o.y <= 23 ? 't' : o.y >= H - 23 ? 'b' : o.x <= 23 ? 'l' : 'r');
    const LW = o => o.label.length * 7 + 22, LH = 22;
    const frame = M.els.view.getBoundingClientRect();
    const boxOf = el => { if (!el || el.hidden || !el.offsetWidth) return null; const r = el.getBoundingClientRect(); return { l: r.left - frame.left, t: r.top - frame.top, r: r.right - frame.left, b: r.bottom - frame.top }; };
    const ui = boxOf(M.els.view.querySelector('.esri-ui-bottom-right'));
    out.forEach(o => {
      // Whole label inside the map.
      o.x = Math.min(W - LW(o) / 2 - 4, Math.max(LW(o) / 2 + 4, o.x));
      o.y = Math.min(H - LH / 2 - 4, Math.max(LH / 2 + 4, o.y));
    });
    ['t', 'b', 'l', 'r'].forEach(e => {
      const on = out.filter(o => edgeOf(o) === e);
      const horiz = e === 't' || e === 'b';
      on.sort((a, b) => horiz ? a.x - b.x : a.y - b.y);
      for (let i = 1; i < on.length; i++) {
        const prev = on[i - 1], o = on[i];
        if (horiz) { const min = prev.x + (LW(prev) + LW(o)) / 2 + 4; if (o.x < min) o.x = min; }
        else { const min = prev.y + LH + 4; if (o.y < min) o.y = min; }
      }
      // Keep the last ones on the map.
      for (let i = on.length - 1; i >= 0; i--) {
        const o = on[i];
        // The last on the bottom or right edge also stops short of the zoom buttons.
        if (horiz) { const max = (i === on.length - 1 ? (e === 'b' && ui && ui.b > H - LH - 8 ? ui.l - 4 : W - 4) - LW(o) / 2 : on[i + 1].x - (LW(o) + LW(on[i + 1])) / 2 - 4); if (o.x > max) o.x = max; }
        else { const max = (i === on.length - 1 ? (e === 'r' && ui ? ui.t - 4 - LH / 2 : H - LH) : on[i + 1].y - LH - 4); if (o.y > max) o.y = max; }
      }
    });
    return out;
  }
  function renderEdges() {
    const el = M.els.edges; if (!el) return;
    el.innerHTML = '';
    offscreenMarks().forEach(o => el.appendChild(h('div', { class: 'edge', style: { left: `${o.x}px`, top: `${o.y}px` } },
      h('span', { class: 'edge-arrow', style: { transform: `rotate(${o.angle}rad)` } }, '➤'), h('span', null, o.label))));
  }

  /* ---------------- diagnostics ---------------- */
  function renderDiag() {
    if (!M.els.diag) return;
    const lines = ['SoRT v2 map — ' + new Date().toISOString()];
    Object.entries(M.diag).forEach(([k, d]) => lines.push(`${k}: ${d.status}${d.ms != null ? ` (${(d.ms / 1000).toFixed(1)} s)` : ''}${d.note ? ' — ' + d.note : ''}`));
    if (M.view) lines.push(`view: centre ${M.view.center ? U().formatCoord(M.view.center.latitude, M.view.center.longitude) : '?'}, scale 1:${Math.round(M.view.scale || 0)}, ${M.view.width}×${M.view.height}`);
    if (M.anchor) lines.push(`anchor: ${U().formatCoord(M.anchor.lat, M.anchor.lon)}`);
    lines.push('', ...M.log);
    M.els.diag.textContent = lines.join('\n');
  }

  /* ---------------- the picture for Word ---------------- */
  function rasterStats(ctx, W, H) {
    try {
      const d = ctx.getImageData(0, 0, W, H).data, N = 48; let cov = 0, tot = 0; const b = new Set();
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = Math.min(W - 1, Math.floor((i + 0.5) * W / N)), y = Math.min(H - 1, Math.floor((j + 0.5) * H / N)), o = (y * W + x) * 4;
        tot++; if (d[o + 3] > 8) { cov++; b.add((d[o] >> 3) + ',' + (d[o + 1] >> 3) + ',' + (d[o + 2] >> 3)); }
      }
      return { coverage: tot ? cov / tot : 0, distinct: b.size };
    } catch (_) { return null; }
  }
  function roundRect(c, x, y, w, hh, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  async function whenReady() {
    const E = M.esri, v = M.view, budget = CFG.timeouts.layer;
    const settle = pred => Promise.race([E.reactiveUtils.whenOnce(pred), new Promise(r => setTimeout(r, budget))]).catch(() => {});
    await settle(() => !v.suspended && v.ready && v.width > 0 && v.height > 0);
    await new Promise(r => setTimeout(r, 60));
    await settle(() => !v.updating && (!v.allLayerViews || v.allLayerViews.toArray().every(lv => !lv.updating)));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  async function picture() {
    if (M.failed) throw new Error('the map didn’t load');
    if (!M.ready) throw new Error('the map is still loading');
    resolvePins();
    if (!shownPins().length && !M.anchor) return null;
    // Working aids (Flood-Net's recorded position, its other stations) stay off
    // the report's picture: the picture is taken of the other layers only, so
    // the live map never blinks while the preview refreshes.
    const aids = [M.gl.ghost, M.gl.nearby];
    let shot;
    await whenReady();
    try { shot = await M.view.takeScreenshot({ layers: M.map.layers.toArray().filter(l => !aids.includes(l)) }); }
    catch (_) {
      const was = aids.map(l => l.visible);
      aids.forEach(l => { l.visible = false; });
      try { await whenReady(); shot = await M.view.takeScreenshot(); }
      finally { aids.forEach((l, i) => { l.visible = was[i]; }); }
    }
    const img = new Image(); img.src = shot.dataUrl;
    await (img.decode ? img.decode().catch(() => new Promise(r => { img.onload = r; })) : new Promise(r => { img.onload = r; }));
    const W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) throw new Error('the map picture came back empty');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, W, H);
    const st = rasterStats(x, W, H);
    if (st && (st.coverage < 0.5 || st.distinct <= 4)) throw new Error('the map hadn’t finished drawing — wait a moment and copy again');
    x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
    const sc = W / M.view.width;                               // device pixels per CSS pixel
    const pad = Math.round(10 * sc), fs = Math.round(13 * sc), fs2 = Math.round(11 * sc);
    const font = (bold, size) => `${bold ? 'bold ' : ''}${size}px Segoe UI, Arial, sans-serif`;
    x.textBaseline = 'top';
    // Survey marks off the picture: an arrow at the edge with the distance.
    offscreenMarks().forEach(o => {
      x.font = font(true, fs2);
      const tw = x.measureText(o.label).width, bw = tw + 22 * sc, bh = fs2 + 6 * sc;
      const bx = Math.min(W - bw - 2 * sc, Math.max(2 * sc, o.x * sc - bw / 2)), by = Math.min(H - bh - fs2 - pad * 1.5, Math.max(2 * sc, o.y * sc - bh / 2));
      x.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(x, bx, by, bw, bh, 3 * sc); x.fill();
      x.save(); x.translate(bx + 9 * sc, by + bh / 2); x.rotate(o.angle);
      x.fillStyle = '#1b4f72'; x.beginPath(); x.moveTo(6 * sc, 0); x.lineTo(-4 * sc, -4.5 * sc); x.lineTo(-4 * sc, 4.5 * sc); x.closePath(); x.fill(); x.restore();
      x.fillStyle = '#1b4f72'; x.fillText(o.label, bx + 18 * sc, by + 3 * sc);
    });
    // Attribution band, along the bottom of the map.
    const band = fs2 + pad;
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, H - band, W, band);
    // Smaller type where the whole line wouldn't otherwise fit across.
    x.font = font(false, fs2);
    const aw = x.measureText(CFG.attribution).width, afs = aw > W - pad * 2 ? Math.max(Math.round(8 * sc), Math.floor(fs2 * (W - pad * 2) / aw)) : fs2;
    x.fillStyle = '#fff'; x.font = font(false, afs); x.fillText(CFG.attribution, pad, H - band + (band - afs) / 2);
    // The key, below the map and its attribution: part of the picture, but
    // covering none of the map. The station on its own line, then the rest in
    // as many columns as fit, a long label wrapping inside its column.
    const items = legendItems();
    let out = c;
    if (items.length) {
      const m = document.createElement('canvas').getContext('2d');
      const sym = Math.round(24 * sc), gap = Math.round(20 * sc), inner = W - pad * 2, lineH = fs + 3 * sc;
      const title = items.find(i => i.kind === 'title'), rest = items.filter(i => i.kind !== 'title');
      const textW = (t, f) => { m.font = f; return m.measureText(t).width; };
      const wrap = (t, f, max) => {
        const lines = []; let line = '';
        String(t).split(' ').forEach(w => { const next = line ? `${line} ${w}` : w; if (line && textW(next, f) > max) { lines.push(line); line = w; } else line = next; });
        if (line) lines.push(line);
        return lines;
      };
      const widest = rest.reduce((a, i) => Math.max(a, sym + Math.max(textW(i.label, font(true, fs)), i.sub ? textW(i.sub, font(false, fs2)) : 0)), 0);
      const ncol = Math.max(1, Math.min(rest.length || 1, Math.floor((inner + gap) / (widest + gap))));
      const cw = (inner + gap) / ncol - gap;
      const lay = rest.map(i => { const lines = wrap(i.label, font(true, fs), cw - sym); return { i, lines, h: lines.length * lineH + (i.sub ? fs2 + 3 * sc : 0) }; });
      const rows = [];
      for (let r = 0; r < lay.length; r += ncol) rows.push(lay.slice(r, r + ncol));
      const rowH = row => Math.max(...row.map(t => t.h)) + 7 * sc;
      const titleH = title ? fs + 10 * sc : 0;
      const KH = Math.round(pad * 1.2 + titleH + rows.reduce((a, r) => a + rowH(r), 0) + pad * 0.5);
      out = document.createElement('canvas'); out.width = W; out.height = H + KH;
      const k = out.getContext('2d');
      k.fillStyle = '#fff'; k.fillRect(0, 0, W, H + KH);
      k.drawImage(c, 0, 0);
      k.textBaseline = 'top';
      let y = H + pad * 1.2;
      if (title) { k.fillStyle = '#152531'; k.font = font(true, fs); k.fillText(title.label, pad, y); y += titleH; }
      rows.forEach(row => {
        row.forEach((t, col) => {
          const i = t.i, x0 = pad + col * (cw + gap), cx = x0 + 9 * sc, cy = y + fs * 0.55, colour = `rgb(${i.colour.join(',')})`;
          k.fillStyle = colour; k.strokeStyle = colour; k.lineWidth = 2 * sc;
          if (i.kind === 'pin') { k.beginPath(); k.arc(cx, cy, fs * 0.42, 0, Math.PI * 2); k.fill(); }
          else if (i.kind === 'mark') { k.beginPath(); k.arc(cx, cy, fs * 0.38, 0, Math.PI * 2); k.stroke(); }
          else if (i.kind === 'bridge') { k.beginPath(); k.moveTo(cx, cy - fs * .45); k.lineTo(cx + fs * .45, cy); k.lineTo(cx, cy + fs * .45); k.lineTo(cx - fs * .45, cy); k.closePath(); k.fill(); }
          else if (i.kind === 'tree') { k.beginPath(); k.moveTo(cx, cy - fs * .45); k.lineTo(cx + fs * .45, cy + fs * .4); k.lineTo(cx - fs * .45, cy + fs * .4); k.closePath(); k.fill(); }
          else if (i.kind === 'line') { k.beginPath(); k.moveTo(cx - fs * .5, cy); k.lineTo(cx + fs * .5, cy); k.lineWidth = 3.5 * sc; k.stroke(); }
          else if (i.kind === 'contour') { k.beginPath(); k.moveTo(cx - fs * .5, cy); k.lineTo(cx + fs * .5, cy); k.lineWidth = 1.6 * sc; k.stroke(); }
          else if (i.kind === 'circle') { k.setLineDash([3 * sc, 2 * sc]); k.beginPath(); k.arc(cx, cy, fs * 0.42, 0, Math.PI * 2); k.stroke(); k.setLineDash([]); }
          k.fillStyle = '#152531'; k.font = font(true, fs);
          t.lines.forEach((l, n) => k.fillText(l, x0 + sym, y + n * lineH));
          if (i.sub) { k.fillStyle = '#3a4a56'; k.font = font(false, fs2); k.fillText(i.sub, x0 + sym, y + t.lines.length * lineH); }
        });
        y += rowH(row);
      });
    }
    const ext = M.view.extent;
    const outside = shownPins().filter(p => ext && !ext.contains(G_(pt(p.lon, p.lat)).geometry)).length;
    return { dataUrl: out.toDataURL('image/png'), outside, mapHeight: H, at: Date.now() };
  }

  /* ---------------- what app.js calls ---------------- */
  let lastAnchor = '';
  // The relocation's distance, measured between its pin and the current location
  // — a suggestion (marked Map) until accepted; a typed distance always wins.
  function suggestDistances() {
    const s = M.app.session, cur = M.pins.find(p => p.anchor && p.shown && p.ok);
    let changed = false;
    M.pins.forEach(p => {
      if (p.anchor || p.code !== 'relocation') return;
      const q = M.app.ctx.byCode[p.code], f = q && (q.fields || []).find(x => x.code === 'distance');
      if (!f) return;
      const want = cur && p.shown && p.ok ? String(Math.round(near(cur, p))) : null;
      const pre = s.prefill[p.code] && s.prefill[p.code].src === 'map' ? s.prefill[p.code] : null;
      const have = pre && pre.fields ? pre.fields.distance : null;
      if (want === (have || null)) return;
      if (want) s.prefill[p.code] = { src: 'map', fields: Object.assign({}, pre ? pre.fields : {}, { distance: want }) };
      else if (pre) delete s.prefill[p.code];
      changed = true;
    });
    return changed;
  }
  function sync(app) {
    M.app = app;
    resolvePins();
    if (suggestDistances()) { M.app.changed(); return; }
    renderCheck(); renderSide(); renderLegend();
    const k = key(M.anchor);
    if (k && k !== lastAnchor) { lastAnchor = k; refreshNearSoon(); }
    if (!M.ready) return;
    // Straight after a new (or another) session: start from its station, or from
    // the whole of Queensland when it has none yet.
    if (M.homeNext) { M.homeNext = false; if (M.anchor) { M.framedFor = key(M.anchor); frame(false); } else home(); }
    if (M.anchor && M.view.center && near(M.anchor, { lat: M.view.center.latitude, lon: M.view.center.longitude }) > 5000 && M.framedFor !== key(M.anchor)) { M.framedFor = key(M.anchor); frame(false); }
    drawPins(); drawMarks(); drawBridges(); drawFeatures(); renderEdges();
    refreshShown();
  }
  const refreshNearSoon = (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(() => refreshNear(false), 600); }; })();
  // A (new) station: frame it, and fetch what is near it.
  function station(app) {
    M.app = app;
    resolvePins();
    renderCheck();
    lastAnchor = key(M.anchor);
    refreshNear(true);
    if (!M.ready) return;
    const k = key(M.anchor);
    if (k && M.framedFor !== k) { M.framedFor = k; M.homeNext = false; frame(false); }
  }
  function reset() { M.marks = []; M.bridges = []; M.shown = []; M.shownSig = ''; M.nearby = []; M.fetchedAt = null; M.framedFor = null; M.homeNext = true; lastAnchor = ''; cancelPlace(); setMove(false); }
  /* A small map of its own, in the corrosion guide (js/coast.js): the imagery and
     its place names, the shoreline the distances were measured to (surf beaches
     orange, other shore blue), and a dashed line from the site to each nearest
     shore. Nothing here touches the main map, and it is never in the Word
     picture. The wheel scrolls the guide unless Ctrl is held (as the main map's
     zoom lock). Resolves to { destroy }, or null when the map library can't load. */
  async function miniMap(container, spec) {
    let E;
    try { E = await loadEsri(); } catch (_) { return null; }
    const map = new E.Map({ layers: [new E.ImageryTileLayer({ url: CFG.imagery })] });
    try { map.add(new E.MapImageLayer({ url: CFG.imageryLabels })); } catch (_) { /* place names are a nicety */ }
    const L = new E.GraphicsLayer(); map.add(L);
    const line = (paths, color, width, style) => L.add(G_({ type: 'polyline', paths, spatialReference: { wkid: 4326 } }, { type: 'simple-line', color, width, style: style || 'solid' }));
    (spec.shore || []).forEach(p => line([p], [90, 190, 255, 1], 1.6));
    (spec.surf || []).forEach(p => line([p], [255, 140, 40, 1], 2.6));
    const pts = [pt(spec.lon, spec.lat)];
    (spec.lines || []).forEach(l => {
      const col = l.surf ? [255, 140, 40, 1] : [90, 190, 255, 1];
      line([[[spec.lon, spec.lat], [l.lon, l.lat]]], [255, 255, 255, 1], 2.5, 'dash');
      L.add(G_(pt(l.lon, l.lat), { type: 'simple-marker', style: 'circle', size: 10, color: col, outline: { color: [255, 255, 255, 1], width: 1.5 } }));
      L.add(G_(pt(l.lon, l.lat), text(l.label, [255, 255, 255], l.surf ? 12 : -20, 10)));   // surf above its point, other shores below: two near-together shores stay legible
      pts.push(pt(l.lon, l.lat));
    });
    L.add(G_(pt(spec.lon, spec.lat), { type: 'simple-marker', style: 'circle', size: 14, color: [214, 40, 40, 1], outline: { color: [255, 255, 255, 1], width: 2 } }));
    L.add(G_(pt(spec.lon, spec.lat), text(spec.label || 'The site', [255, 255, 255], 14, 11)));
    container.addEventListener('wheel', ev => { if (!(ev.ctrlKey || ev.metaKey)) ev.stopPropagation(); }, { capture: true, passive: true });
    const view = new E.MapView({ container, map, center: [spec.lon, spec.lat], zoom: 13, spatialReference: { wkid: 3857 },
      constraints: { rotationEnabled: false, snapToZoom: false }, ui: { components: ['zoom', 'attribution'] }, popupEnabled: false });
    try {
      await withTimeout(view.when(), CFG.timeouts.view, 'the distance map');
      // Frame the site and the shores: at least ~1.2 km across, so a site on the shore isn't a blur.
      const ext = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
      pts.forEach(p => { ext.xmin = Math.min(ext.xmin, p.longitude); ext.xmax = Math.max(ext.xmax, p.longitude); ext.ymin = Math.min(ext.ymin, p.latitude); ext.ymax = Math.max(ext.ymax, p.latitude); });
      const minHalf = 0.006, cx = (ext.xmin + ext.xmax) / 2, cy = (ext.ymin + ext.ymax) / 2;
      const hx = Math.max(minHalf, (ext.xmax - ext.xmin) * 0.85), hy = Math.max(minHalf, (ext.ymax - ext.ymin) * 0.85);
      await view.goTo(new E.Extent({ xmin: cx - hx, ymin: cy - hy, xmax: cx + hx, ymax: cy + hy, spatialReference: { wkid: 4326 } }), { animate: false });
    } catch (_) { /* the view still shows what it can */ }
    return { view, graphics: L, destroy: () => { try { view.destroy(); } catch (_) { /* gone already */ } } };
  }
  function focusPin(code, field) {
    resolvePins();
    const p = M.pins.find(x => x.code === code && x.field === field);
    if (!p) return;
    if (p.shown && p.ok && M.ready) M.view.goTo({ center: [p.lon, p.lat], zoom: Math.max(M.view.zoom, CFG.siteZoom) }, { animate: true }).catch(() => {});
    else startPlace({ kind: 'pin', key: p.key, label: `Click where the ${p.label.toLowerCase()} is` });
  }
  function hint(k) {
    if (k === 'map.nearestBenchmark') {
      const b = M.marks.find(m => m.ahd != null);
      if (!M.anchor) return null;
      if (!b) return M.marks.length || M.fetchedAt ? `No State survey mark with an AHD height within ${U().fmtDist(CFG.marks.radiusM)} of the station.` : null;
      return `Nearest State survey mark with an AHD height: ${b.name} (${b.ref}), ${b.away}, ${b.ahd} m AHD${b.condition ? ', ' + b.condition.toLowerCase() : ''}${b.lastVisit ? ', last visited ' + b.lastVisit : ''}.`;
    }
    return null;
  }

  S.mapView = { mount, sync, station, reset, focusPin, startDraw, hint, picture, miniMap, CFG, _M: M,
    ready: () => M.ready && !M.failed, version: () => M.version };
})(window);
