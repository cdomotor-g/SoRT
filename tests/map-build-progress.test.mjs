/*
 * Regression test for §A6.1 — the map build-progress bar finishing BEFORE the
 * contours had drawn.
 *
 * The bar's only completion signal used to be `view.updating`, which is false in
 * the gap between "the view is ready" and "the contour layer reaches the map"
 * (every layer loader resolves its service metadata over the network before it
 * adds anything). So the bar saw a quiet view, waited its 300 ms and ran to 100%
 * over a map whose slowest layer had not begun drawing. The same gap sat after a
 * pan, where the re-fetch for the new extent starts a beat after the view stops.
 *
 * Completion is now gated on outstanding WORK as well as on quiet. This test
 * drives the real page globals (mapBuildStart / mapBuildTrack / mapBuildTaskDone
 * / mapBuildTrackLoad / mapBuildWatchLayer / mapBuildStillDrawing) and asserts:
 *
 *   - a tracked layer that has not drawn HOLDS the bar, even though the view has
 *     gone quiet — the exact defect;
 *   - releasing it lets the bar complete and hide;
 *   - the bar follows the layer's LAYER VIEW, not its load: it is released only
 *     after `lv.updating` has been false for a beat, and re-arms if the layer
 *     starts fetching again (a contour layer arriving in batches);
 *   - a layer that never arrives (failed load, not on the map, no layer view)
 *     releases immediately, so a broken layer can never wedge the bar;
 *   - a pan (and a re-open, whose suspended view stopped drawing) registers the
 *     live layers via mapBuildTrackRedraw, so the bar waits for the redraw;
 *   - completing layers advance the bar, contours by the largest step;
 *   - restarting a cycle mid-load KEEPS the layer that hasn't drawn, and a load
 *     that has been superseded cannot release the one that replaced it;
 *   - the note names what is still drawing;
 *   - a view mid-animation / mid-interaction still counts as drawing.
 *
 * Hermetic: the central store, the Esri CDN and every QLD host are blocked; the
 * view and its layer views are stand-ins, so no WebGL and no network are needed.
 *
 * Run (same invocation as the other tests — see tests/README.md):
 *   PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
 *   PW_CHROMIUM=/opt/pw-browsers/chromium-*\/chrome-linux/chrome \
 *     node tests/map-build-progress.test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadPlaywright(){
  const candidates = [];
  if(process.env.PLAYWRIGHT_PKG) candidates.push(process.env.PLAYWRIGHT_PKG);
  candidates.push('playwright');
  for(const c of candidates){
    try{
      const spec = c.startsWith('/') ? pathToFileURL(path.join(c, 'index.js')).href : c;
      const mod = await import(spec);
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if(chromium) return chromium;
    }catch(_){ /* try next */ }
  }
  throw new Error('Could not load Playwright. Install it and pass PLAYWRIGHT_PKG=/path/to/node_modules/playwright');
}
const chromium = await loadPlaywright();

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.json':'application/json', '.js':'text/javascript', '.css':'text/css' };

function serve(root){
  const server = http.createServer((req, res)=>{
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.join(root, rel);
    if(!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', ()=> resolve(server)));
}

const results = [];
function check(name, cond, extra){ results.push({ name, ok: !!cond, extra: extra || '' }); }

const server = await serve(REPO_ROOT);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/index.html`;

const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

const pageErrors = [];
try {
  const ctx = await browser.newContext();
  await ctx.route('**://*.supabase.co/**', r => r.abort());            // bundled definitions.json
  await ctx.route(/js\.arcgis\.com|information\.qld\.gov\.au/, r => r.abort());  // no external map calls
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer', { timeout: 15000 });

  // Stand-in view + Esri reactiveUtils, so the real progress code can be driven
  // without WebGL. Layer views are plain objects whose `updating` the test flips;
  // watchers registered by the page are invoked exactly as reactiveUtils would.
  await page.evaluate(()=>{
    buildSiteMapModal();
    const handles = [];
    window.__lvs = {};                       // key -> stand-in layer view
    window.__layers = {};                    // key -> stand-in layer
    const fire = ()=> handles.slice().forEach(h=>{ try{ h.cb(h.getter()); }catch(_){} });
    window.__setLayerUpdating = (key, v)=>{ if(window.__lvs[key]) window.__lvs[key].updating = v; fire(); };
    window.__makeLayer = (key, opts)=>{
      opts = opts || {};
      const layer = { __key: key, loadStatus: opts.loadStatus || 'loaded', onMap: opts.onMap !== false };
      window.__layers[key] = layer;
      if(opts.noLayerView !== true) window.__lvs[key] = { updating: opts.updating !== false };
      return layer;
    };
    window.__resetStubs = ()=>{ handles.length = 0; window.__lvs = {}; window.__layers = {}; };

    siteMap.esri = {
      reactiveUtils: {
        watch: (getter, cb)=>{
          const h = { getter, cb, remove(){ const i = handles.indexOf(h); if(i >= 0) handles.splice(i, 1); } };
          handles.push(h);
          return h;
        }
      }
    };
    siteMap.esriMap = { layers: { includes: (l)=> !!(l && l.onMap) } };
    siteMap.view = {
      ready: true, updating: false, interacting: false, stationary: true,
      allLayerViews: { toArray: ()=> Object.keys(window.__lvs).map(k=> window.__lvs[k]) },
      whenLayerView: (layer)=>{
        const lv = window.__lvs[layer && layer.__key];
        return lv ? Promise.resolve(lv) : new Promise(()=>{});   // never resolves, as Esri does
      }
    };
  });

  const barWidth = ()=> page.evaluate(()=>{ const b = document.querySelector('.smap-progress-bar'); return parseFloat(b.style.width) || 0; });
  const progHidden = ()=> page.evaluate(()=> document.querySelector('.smap-progress').hidden);
  const noteText = ()=> page.evaluate(()=> document.querySelector('.smap-progress-note').textContent);
  const pending = ()=> page.evaluate(()=> mapBuildPending());

  // ---- THE DEFECT: a quiet view must not complete a bar with work outstanding --
  await page.evaluate(()=>{
    mapBuildReset();
    mapBuildStart();
    mapBuildFloor(0.35);          // the view is ready — where the old bar took off
    mapBuildTrack('contours');    // ...but the contours haven't reached the map yet
    mapBuildSetBusy(true);
    mapBuildSetBusy(false);       // view goes quiet in the gap before the contours load
  });
  await page.waitForTimeout(1400);            // comfortably past the old 300 ms finish
  const heldWidth = await barWidth();
  check('contours outstanding: the bar does NOT complete when the view goes quiet',
    await progHidden() === false && heldWidth < 100, heldWidth + '%');
  check('contours outstanding: the note says what is being waited on',
    /contour/i.test(await noteText()), await noteText());
  check('contours outstanding: still counted as drawing',
    await page.evaluate(()=> mapBuildStillDrawing()) === true);

  // ...and releasing the contours lets it complete and hide.
  await page.evaluate(()=> mapBuildTaskDone('contours'));
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === true, null, { timeout: 6000 });
  check('contours drawn: the bar completes and hides', await progHidden() === true);
  check('note returns to its resting text once hidden', (await noteText()) === 'Building map…', await noteText());

  // ---- the bar follows the LAYER VIEW, not the load ---------------------------
  await page.evaluate(()=>{
    window.__resetStubs();
    mapBuildReset(); mapBuildStart();
    const layer = window.__makeLayer('contours', { updating: true });   // drawing
    mapBuildTrackLoad('contours', Promise.resolve(), ()=> layer);
    mapBuildSetBusy(false);
  });
  await page.waitForTimeout(900);
  check('layer loaded but still drawing: task held', await pending() === 1 && await progHidden() === false);

  // A pause mid-fetch (between contour batches) must not release it early: the
  // quiet window re-arms the moment the layer starts fetching again.
  await page.evaluate(()=> window.__setLayerUpdating('contours', false));
  await page.waitForTimeout(250);
  await page.evaluate(()=> window.__setLayerUpdating('contours', true));
  await page.waitForTimeout(900);
  check('layer view flips back to updating: task re-armed, not released',
    await pending() === 1 && await progHidden() === false);

  // Final batch drawn — released after the quiet beat, and the bar completes.
  await page.evaluate(()=> window.__setLayerUpdating('contours', false));
  await page.waitForFunction(()=> mapBuildPending() === 0, null, { timeout: 6000 });
  check('layer view settles: task released', await pending() === 0);
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === true, null, { timeout: 6000 });
  check('layer view settles: the bar then completes and hides', await progHidden() === true);

  // ---- a layer that never arrives can never wedge the bar ---------------------
  await page.evaluate(()=>{
    window.__resetStubs();
    mapBuildReset(); mapBuildStart();
    mapBuildTrackLoad('contours', Promise.resolve(), ()=> null);                                  // load failed outright
    mapBuildTrackLoad('road',     Promise.resolve(), ()=> window.__makeLayer('road', { loadStatus:'failed' }));
    mapBuildTrackLoad('rail',     Promise.resolve(), ()=> window.__makeLayer('rail', { onMap:false }));       // pulled from the map
    mapBuildTrackLoad('labels',   Promise.resolve(), ()=> window.__makeLayer('labels', { noLayerView:true })); // layer view never materialises
    mapBuildSetBusy(false);
  });
  await page.waitForFunction(()=> mapBuildPending() <= 1, null, { timeout: 6000 });
  check('failed / removed / never-loaded layers release their tasks',
    await pending() <= 1, 'pending=' + await pending());
  check('a layer view that never materialises is the only thing left waiting (and is bounded)',
    await page.evaluate(()=> MAP_BUILD_MAX_MS > 0 && MAP_BUILD_MAX_MS <= 120000), 'cap=' + await page.evaluate(()=> MAP_BUILD_MAX_MS));

  // ---- finishing layers advance the bar, contours by the biggest step ---------
  const steps = await page.evaluate(async ()=>{
    window.__resetStubs();
    mapBuildReset(); mapBuildStart(); mapBuildFloor(0.35);
    ['imagery','contours','road','rail','labels'].forEach(k=> mapBuildTrack(k));
    const out = { start: mapBuild.target };
    mapBuildTaskDone('imagery');  out.afterImagery = mapBuild.target;
    mapBuildTaskDone('contours'); out.afterContours = mapBuild.target;
    mapBuildTaskDone('road');     out.afterRoad = mapBuild.target;
    mapBuildTaskDone('rail');     mapBuildTaskDone('labels');
    out.afterAll = mapBuild.target;
    out.pending = mapBuildPending();
    return out;
  });
  check('each layer that finishes advances the bar',
    steps.afterImagery > steps.start && steps.afterContours > steps.afterImagery &&
    steps.afterRoad > steps.afterContours && steps.afterAll > steps.afterRoad,
    JSON.stringify(steps));
  check('contours carry the largest share of the bar',
    (steps.afterContours - steps.afterImagery) > (steps.afterImagery - steps.start) &&
    (steps.afterContours - steps.afterImagery) > (steps.afterRoad - steps.afterContours),
    JSON.stringify(steps));
  check('all layers drawn ⇒ the bar is at the top of its pre-completion range',
    steps.pending === 0 && steps.afterAll > 0.85 && steps.afterAll <= 0.92, String(steps.afterAll));
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === true, null, { timeout: 6000 });

  // ---- a pan waits for the redraw, not just for the view to stop moving -------
  await page.evaluate(()=>{
    window.__resetStubs();
    mapBuildReset();
    siteMap.layers.contour = window.__makeLayer('contours', { updating: true });
    siteMap.layers.road    = window.__makeLayer('road',     { updating: true });
    mapBuildStart();            // interacting → true (the user grabs the map)
    mapBuildTrackRedraw();      // interacting → false (they let go)
  });
  await page.waitForTimeout(900);
  check('after a pan the live layers are tracked so the bar waits for the redraw',
    await pending() === 2 && await progHidden() === false, 'pending=' + await pending());
  await page.evaluate(()=>{ window.__setLayerUpdating('contours', false); window.__setLayerUpdating('road', false); });
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === true, null, { timeout: 6000 });
  check('pan redraw finished: the bar completes', await progHidden() === true);

  // ---- a mid-flight view is "still drawing" even with no tasks ----------------
  const viewSignals = await page.evaluate(()=>{
    const v = siteMap.view;
    const read = (patch)=>{ Object.assign(v, patch); return mapBuildStillDrawing(); };
    const base = { updating:false, interacting:false, stationary:true };
    const out = {
      idle:        read(base),
      updating:    read({ ...base, updating:true }),
      interacting: read({ ...base, interacting:true }),
      animating:   read({ ...base, stationary:false })
    };
    Object.assign(v, base);
    return out;
  });
  check('view.updating / interacting / mid-animation all count as still drawing',
    viewSignals.idle === false && viewSignals.updating && viewSignals.interacting && viewSignals.animating,
    JSON.stringify(viewSignals));

  // ---- an abandoned load cannot complete the work that replaced it -----------
  const stale = await page.evaluate(async ()=>{
    window.__resetStubs();
    mapBuildReset(); mapBuildStart();
    const abandoned = mapBuildClaim('contours');   // the 5 m load
    mapBuildClaim('contours');                     // ...superseded by a 1 m load
    mapBuildTaskDone('contours', abandoned);       // the 5 m load finally reports in
    return { pending: mapBuildPending() };
  });
  check('a superseded load cannot release the load that replaced it',
    stale.pending === 1, JSON.stringify(stale));

  // ---- restarting a cycle keeps work that has NOT drawn ----------------------
  // A pan while the contours are still loading used to hand the bar a clean
  // slate over a half-drawn map: the restart dropped the outstanding task and
  // nothing was left to stop it completing.
  const carried = await page.evaluate(async ()=>{
    window.__resetStubs();
    mapBuildReset(); mapBuildStart();
    const layer = window.__makeLayer('contours', { updating: true });
    mapBuildTrackLoad('contours', Promise.resolve(), ()=> layer);   // still loading
    mapBuildTaskDone('imagery');                                    // (not tracked — no-op)
    await new Promise(r=> setTimeout(r, 50));
    const before = mapBuildPending();
    mapBuildStart();                       // the user grabs the map mid-load
    return { before, after: mapBuildPending(), stillDrawing: mapBuildStillDrawing() };
  });
  check('a restart mid-load keeps the undrawn layer outstanding',
    carried.before === 1 && carried.after === 1 && carried.stillDrawing === true, JSON.stringify(carried));

  // ...and the still-live load releases it once that layer finally draws.
  await page.evaluate(()=> window.__setLayerUpdating('contours', false));
  await page.waitForFunction(()=> mapBuildPending() === 0, null, { timeout: 6000 });
  check('the carried-over load still releases its task when the layer draws', await pending() === 0);
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === true, null, { timeout: 6000 });

  // ---- the wiring: buildView registers every layer BEFORE its load starts ----
  // This is the change that fixes the reported symptom. Driving the real
  // buildView with a stand-in Esri, all five operational layers must be
  // outstanding the instant it returns — the moment the old bar was left with
  // nothing to wait for. (The QLD hosts are blocked, so the loads fail and
  // release straight afterwards; the count is read synchronously.)
  const wiring = await page.evaluate(async ()=>{
    window.__resetStubs();
    mapBuildReset();
    const handles = [];
    const layer = (extra)=> Object.assign({ load: ()=> new Promise(()=>{}) , __zorder: 0 }, extra);
    const collection = (arr)=>({
      includes: (l)=> arr.indexOf(l) !== -1,
      forEach: (fn)=> arr.forEach(fn),
      toArray: ()=> arr.slice()
    });
    const layers = [];
    siteMap.esri = {
      Map: function(){ this.layers = collection(layers);
                       this.add = (l, i)=> layers.splice(i == null ? layers.length : i, 0, l);
                       this.remove = (l)=>{ const i = layers.indexOf(l); if(i >= 0) layers.splice(i, 1); }; },
      ImageryTileLayer: function(){ return layer({ type:'imagery' }); },
      MapView: function(opts){
        return {
          ...opts, ready:true, updating:true, interacting:false, stationary:true, scale:5000,
          when: ()=> Promise.resolve(),
          on: ()=>({ remove(){} }),
          ui: { move(){}, add(){}, remove(){} },
          graphics: { removeAll(){}, add(){} },
          allLayerViews: collection([]),
          whenLayerView: ()=> new Promise(()=>{})     // no layer view in a stand-in view
        };
      },
      reactiveUtils: {
        when: (getter, cb)=>{ const h = { getter, cb, remove(){} }; handles.push(h); return h; },
        watch: (getter, cb)=>{ const h = { getter, cb, remove(){} }; handles.push(h); return h; }
      }
    };
    mapBuildStart();
    await buildView(siteMap.mapHost);
    const tracked = [...mapBuild.tasks].map(([k, t])=> k + ':' + (t.done ? 'done' : 'pending'));
    return { tracked, pending: mapBuildPending(), stillDrawing: mapBuildStillDrawing() };
  });
  check('buildView registers all five operational layers with the progress bar',
    wiring.pending === 5 &&
    ['imagery','contours','road','rail','labels'].every(k=> wiring.tracked.indexOf(k + ':pending') !== -1),
    JSON.stringify(wiring.tracked));
  check('so the bar counts the map as still drawing the moment the view is ready',
    wiring.stillDrawing === true);

  await page.evaluate(()=> mapBuildReset());
  check('reset(): bar cleared', await progHidden() === true);
  check('reset(): outstanding work dropped', await pending() === 0);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

let pass = 0;
for(const r of results){ console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.extra ? ('  [' + r.extra + ']') : '')); if(r.ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed`);
if(pass === results.length){ console.log('Map build-progress test: OK'); process.exit(0); }
else { console.log('Map build-progress test: FAILED'); process.exit(1); }
