/*
 * Regression test for §7.5 — "capture what you can actually see".
 *
 * Every earlier route from the Site Map into the Word copy captured the map at a
 * moment nobody was looking at it: from the toolbar with the modal shut, on close,
 * or in a throwaway off-screen view. When one of those came back as pins-on-white
 * the user only found out after pasting into Word, with nothing on screen to
 * compare it against. The fix is a capture button IN the modal, the legend and
 * contour caption drawn ON the map (so the map area is the picture), and the
 * resulting PNG shown straight back as a thumbnail.
 *
 * This test drives the real code with a stand-in view (a canvas-backed
 * `takeScreenshot`), covering:
 *   - captureVisibleMap() on a rendering view → caches a PNG tagged source
 *     "capture", arms the Word-copy tick box, and shows the thumbnail;
 *   - captureVisibleMap() on a blank frame → refuses, caches NOTHING, and says
 *     what to do about it (the failure lands in the modal, not in Word);
 *   - the on-map legend lists every shown pin with its coordinate, and the
 *     contour caption tracks the contours toggle — on screen and in the export;
 *   - invalidating the picture (a pan, a pin edit) reports "you captured one and
 *     then moved the map", which is a different message from "none captured";
 *   - the toolbar chip mirrors all of that, and the old toolbar "Copy map image"
 *     button is gone;
 *   - the diagnostics name which picture the copy would use and how it was made.
 *
 * Hermetic: no WebGL, no Esri CDN, no QLD services. GitHub is blocked
 * so the bundled definitions.json loads. Same invocation as the other tests
 * (see tests/README.md).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.json':'application/json', '.js':'text/javascript', '.css':'text/css' };

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

function serve(root){
  const server = http.createServer((req, res)=>{
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
    if(!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', ()=> resolve(server)));
}

const results = [];
const check = (name, cond) => results.push({ name, ok: !!cond });

const chromium = await loadPlaywright();
const server = await serve(REPO_ROOT);
const base = `http://127.0.0.1:${server.address().port}/`;
const launchOpts = { args: ['--no-sandbox'] };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await context.route(/api\.github\.com|raw\.githubusercontent\.com/, r => r.abort());

try{
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  // The app is one plain <script>: function declarations land on `window`, but
  // `const siteMap` / `let includeMapCopy` are lexical globals, so they are only
  // reachable as bare identifiers from page context (not via `window.`).
  await page.waitForFunction(() => typeof captureVisibleMap === 'function' && typeof siteMap !== 'undefined', null, { timeout: 15000 });
  await page.waitForTimeout(600);   // definitions settle

  // ---- shared stand-in world -------------------------------------------------
  // A view that behaves like a settled, rendering MapView and hands back a raster
  // we control: `rich` = a full-coverage many-colour frame (a real map), `blank` =
  // pins-on-transparent (the failure signature the export must refuse).
  await page.evaluate(() => {
    window.__mkRaster = (kind) => {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 180;
      const x = c.getContext('2d');
      if(kind === 'rich'){
        for(let i=0;i<240;i+=6){ for(let j=0;j<180;j+=6){
          x.fillStyle = 'rgb(' + ((i*7)%256) + ',' + ((j*11)%256) + ',' + ((i*j)%256) + ')';
          x.fillRect(i, j, 6, 6);
        }}
      }else{
        x.clearRect(0,0,240,180);                    // transparent = never rendered
        x.fillStyle = '#d62828'; x.beginPath(); x.arc(120, 90, 5, 0, Math.PI*2); x.fill();
      }
      return c.toDataURL('image/png');
    };
    window.__mkView = (kind) => ({
      suspended: false, ready: true, updating: false, width: 240, height: 180,
      allLayerViews: { toArray: () => [{ updating:false }] },
      extent: null,
      takeScreenshot: () => Promise.resolve({ dataUrl: window.__mkRaster(kind), width:240, height:180 })
    });
    // reactiveUtils stand-in: whenCaptureReady only needs whenOnce.
    window.__esriStub = { reactiveUtils: { whenOnce: (pred) => new Promise(res => {
      const tick = () => { if(pred()) res(); else setTimeout(tick, 5); }; tick();
    }) }, Graphic: function(){ this.geometry = {}; } };
  });

  // ---- 1. a real capture, from the modal, with the map on screen --------------
  const good = await page.evaluate(async () => {
    buildSiteMapModal();
    siteMap.esri = window.__esriStub;
    siteMap.view = window.__mkView('rich');
    siteMap.renderedInterval = '5';
    siteMap.contoursOn = true;
    // two pins so the legend has something to list
    siteMap.pins = [
      { key:'a', rowId:'coords', label:'Current location', colour:'red',  ok:true, on:true, anchor:true,  lat:-28.318253, lon:152.921599, raw:'' },
      { key:'b', rowId:'relocation', label:'Relocation site', colour:'blue', ok:true, on:true, anchor:false, lat:-28.319, lon:152.922, raw:'' }
    ];
    renderSiteMapPanel();

    const chk = document.getElementById('includeMapChk');
    chk.checked = false; chk.dispatchEvent(new Event('change'));   // start unticked

    const btn = document.querySelector('.smap-capture');
    const url = await captureVisibleMap(btn);

    const thumb = document.querySelector('.smap-capture-thumb');
    return {
      returnedPng: typeof url === 'string' && url.startsWith('data:image/png'),
      cachedValid: siteMap.screenshot.valid === true,
      cachedSource: siteMap.screenshot.source,
      cachedAt: typeof siteMap.screenshot.at === 'number',
      cachedIsPng: typeof siteMap.screenshot.dataUrl === 'string' && siteMap.screenshot.dataUrl.startsWith('data:image/png'),
      armedFlag: includeMapCopy === true,
      armedBox: chk.checked === true,
      stateText: document.querySelector('.smap-capture-state').textContent,
      stateOk: document.querySelector('.smap-capture-state').classList.contains('smap-capture-state--ok'),
      thumbShown: !thumb.classList.contains('hidden') && (thumb.getAttribute('src')||'').startsWith('data:image/png'),
      btnRestored: btn.disabled === false && /Copy map image/.test(btn.textContent),
      diag: diagnosticsText()
    };
  });
  check('capture: returns a PNG data URL from the open map', good.returnedPng);
  check('capture: caches it for the Word copy, tagged as a user capture', good.cachedValid && good.cachedSource === 'capture' && good.cachedIsPng && good.cachedAt);
  check('capture: arms "Include site map in copied output" so the picture is actually used', good.armedFlag && good.armedBox);
  check('capture: the card confirms it and says where the picture went', good.stateOk && /Captured/i.test(good.stateText) && /Copy table for Word/.test(good.stateText));
  check('capture: the thumbnail shows the exact PNG (a blank one would be visible here)', good.thumbShown);
  check('capture: the button is re-enabled and relabelled afterwards', good.btnRestored);
  check('diagnostics: name the picture as captured by the user from the open map', /Picture for the Word copy: captured by the user/.test(good.diag));

  // ---- 2. the on-map furniture IS the export furniture ------------------------
  const furniture = await page.evaluate(() => {
    const legend = document.querySelector('.smap-onmap-legend');
    const stamp  = document.querySelector('.smap-onmap-stamp');
    const rows   = [...legend.querySelectorAll('.smap-legend-row')];
    const before = { stampText: stamp.textContent, stampHidden: stamp.hidden, exportText: contourStampText() };
    siteMap.contoursOn = false;
    updateIntervalStamp();
    const after = { stampText: stamp.textContent, stampHidden: stamp.hidden, exportText: contourStampText() };
    siteMap.contoursOn = true; updateIntervalStamp();
    return {
      rowCount: rows.length,
      labels: rows.map(r => r.querySelector('.smap-legend-label').textContent),
      coords: rows.map(r => r.querySelector('.smap-legend-coord').textContent),
      onMap: legend.closest('.smap-map') !== null,
      notInPanel: legend.closest('.smap-panel') === null,
      panelLegendGone: !document.querySelector('.smap-legend:not(.smap-onmap-legend)'),
      creditGone: !document.querySelector('.smap-credit'),
      before, after
    };
  });
  check('legend: lives on the map, not in the side panel', furniture.onMap && furniture.notInPanel);
  check('legend: the old side-panel legend and credit blocks are gone', furniture.panelLegendGone && furniture.creditGone);
  check('legend: one row per shown pin, with its label', furniture.rowCount === 2 && furniture.labels.join('|') === 'Current location|Relocation site');
  check('legend: each row carries the pin coordinate (B3)', furniture.coords.every(c => /-28\.\d+, 152\.\d+/.test(c)));
  check('contour caption: shown on the map while contours are on', furniture.before.stampHidden === false && /Contours: 5 m LiDAR/.test(furniture.before.stampText));
  check('contour caption: on screen AND in the export it disappears with the layer', furniture.after.stampHidden === true && furniture.after.exportText === '' && furniture.before.exportText === 'Contours: 5 m LiDAR');

  // ---- 3. moving the map after a capture is its own, named state --------------
  const stale = await page.evaluate(() => {
    invalidateScreenshot();                 // what a pan / pin edit does
    const chip = document.getElementById('mapStateChip');
    // §7.6: a stale picture is replaced in the background rather than left for the
    // user to notice. Record that it was re-armed, then cancel it so the pending
    // capture can't rewrite siteMap.screenshot underneath the rest of this test.
    const rearmed = autoCaptureTimer !== null;
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    return {
      rearmed,
      cacheDropped: siteMap.screenshot.valid === false && siteMap.screenshot.dataUrl === null,
      sourceKept: siteMap.screenshot.source === 'capture',
      cardText: document.querySelector('.smap-capture-state').textContent,
      cardStale: document.querySelector('.smap-capture-state').classList.contains('smap-capture-state--stale'),
      thumbHidden: document.querySelector('.smap-capture-thumb').classList.contains('hidden'),
      chipHidden: chip.hidden,
      chipText: chip.textContent,
      chipTodo: chip.classList.contains('map-state--todo'),
      diag: diagnosticsText()
    };
  });
  check('stale: the cached picture is dropped once the map changes', stale.cacheDropped);
  check('stale: the card says the map moved SINCE the capture (not "nothing captured")', stale.cardStale && stale.sourceKept && /changed since you captured/i.test(stale.cardText));
  check('stale: the thumbnail goes with it — no stale preview left on screen', stale.thumbHidden);
  check('stale: the toolbar chip says the same thing and offers the fix', !stale.chipHidden && stale.chipTodo && /Map moved/.test(stale.chipText) && /recapture now/.test(stale.chipText));
  check('stale: a replacement picture is armed automatically, not left to the user (§7.6)', stale.rearmed);
  check('stale: diagnostics distinguish "captured but the map has changed" from "none"', /one was captured but the map has changed since/.test(stale.diag));

  // ---- 4. a blank frame is refused, in the modal, before it reaches Word ------
  const blank = await page.evaluate(async () => {
    siteMap.view = window.__mkView('blank');       // pins on transparent
    siteMap.screenshot = { dataUrl:null, valid:false, meta:null, source:null, at:null };
    const btn = document.querySelector('.smap-capture');
    const url = await captureVisibleMap(btn);
    return {
      returned: url,
      cached: siteMap.screenshot.valid,
      stateText: document.querySelector('.smap-capture-state').textContent,
      stateErr: document.querySelector('.smap-capture-state').classList.contains('smap-capture-state--err'),
      thumbHidden: document.querySelector('.smap-capture-thumb').classList.contains('hidden'),
      btnUsable: btn.disabled === false,
      diagStatus: (siteMap.diag.screenshot || {}).status
    };
  });
  check('blank frame: nothing is returned and nothing is cached', blank.returned === null && blank.cached === false);
  check('blank frame: the modal explains it came out blank and what to wait for', blank.stateErr && /blank/i.test(blank.stateText) && /finish/i.test(blank.stateText));
  check('blank frame: no thumbnail is shown for a picture that does not exist', blank.thumbHidden);
  check('blank frame: the button stays usable so the user can retry', blank.btnUsable);
  check('blank frame: diagnostics record the failure', blank.diagStatus === 'failed');

  // ---- 5. capture is refused when there is nothing to capture ----------------
  const guards = await page.evaluate(async () => {
    const btn = document.querySelector('.smap-capture');
    const savedView = siteMap.view, savedPins = siteMap.pins;
    siteMap.view = null;
    const noView = await captureVisibleMap(btn);
    const noViewMsg = document.querySelector('.smap-capture-state').textContent;
    siteMap.view = window.__mkView('rich');
    siteMap.pins = [];
    const noPins = await captureVisibleMap(btn);
    const noPinsMsg = document.querySelector('.smap-capture-state').textContent;
    siteMap.view = savedView; siteMap.pins = savedPins;
    return { noView, noViewMsg, noPins, noPinsMsg };
  });
  check('guard: no map loaded yet → refused, with a plain-language reason', guards.noView === null && /hasn't loaded/i.test(guards.noViewMsg));
  check('guard: no pins showing → refused, with a plain-language reason', guards.noPins === null && /no pins/i.test(guards.noPinsMsg));

  // ---- 6. the tidied toolbar --------------------------------------------------
  const toolbar = await page.evaluate(() => {
    const chip = document.getElementById('mapStateChip');
    const chk = document.getElementById('includeMapChk');
    chk.checked = false; chk.dispatchEvent(new Event('change'));
    const offHidden = chip.hidden;
    siteMap.screenshot = { dataUrl:'data:image/png;base64,x', valid:true, meta:{}, source:'capture', at: Date.now() };
    chk.checked = true; chk.dispatchEvent(new Event('change'));
    return {
      offHidden,
      onShown: chip.hidden === false,
      readyText: chip.textContent,
      readyOk: chip.classList.contains('map-state--ok'),
      oldButtonGone: !document.getElementById('copyMapImgBtn'),
      captureBtnInModal: !!document.querySelector('.modal--map .smap-capture')
    };
  });
  check('toolbar: the chip is hidden while "Include site map" is off — the toolbar stays quiet', toolbar.offHidden);
  check('toolbar: ticking it reveals whether a picture is actually ready', toolbar.onShown && toolbar.readyOk && /Map picture ready/.test(toolbar.readyText));
  check('toolbar: the old "Copy map image" button is gone from the main screen', toolbar.oldButtonGone);
  check('toolbar: capturing now happens in the modal, where the map is on screen', toolbar.captureBtnInModal);

  // ---- 7. the warm-on-close capture must not slam a re-opened modal shut -----
  // Closing no longer BLOCKS on warming the picture cache — it hides the modal and
  // warms in the background — so the user can re-open the Site Map while a capture
  // still holds the overlay in `.smap-capturing`. Its restore must then stand down.
  const race = await page.evaluate(() => {
    const overlay = siteMap.overlay;
    overlay.classList.add('hidden');
    overlay.classList.remove('smap-capturing');
    const restore = beginCaptureVisibility();          // background capture starts
    const parked = overlay.classList.contains('smap-capturing') && !overlay.classList.contains('hidden');
    overlay.classList.remove('smap-capturing');        // what openSiteMap does
    overlay.classList.remove('hidden');
    restore();                                         // the in-flight capture finishes
    const stillOpen = !overlay.classList.contains('hidden') && !overlay.classList.contains('smap-capturing');
    overlay.classList.add('hidden');
    return { parked, stillOpen };
  });
  check('warm-on-close: the capture parks the overlay in the non-suspending state', race.parked);
  check('warm-on-close: a capture finishing after a re-open does NOT re-hide the modal', race.stillOpen);

  check('no uncaught page errors', pageErrors.length === 0);
}finally{
  await browser.close();
  server.close();
}

let failed = 0;
for(const r of results){
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name);
  if(!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if(pageErrors.length) console.log('Page errors:\n  ' + pageErrors.join('\n  '));
if(failed){ console.error('Map capture-button test: FAILED'); process.exit(1); }
console.log('Map capture-button test: OK');
