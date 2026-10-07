/*
 * Regression test for the "capture the map" nudge — the red rings on
 * 🗺 Site Map (toolbar) and 📸 Capture Map (Site Map header).
 *
 *   - both are ringed from the start while the table has locations to map;
 *   - pressing 📸 Capture Map takes its ring off at once, and a successful capture
 *     takes the ring off 🗺 Site Map too;
 *   - panning, or editing a field that is NOT a coordinate, leaves them off;
 *   - changing ANY coordinate — the builder field or a pin written back from the
 *     map — puts both rings back, and changing it back again does not clear them
 *     (the captured picture was dropped on the first change);
 *   - a capture that fails puts the ring back on 📸 Capture Map and leaves
 *     🗺 Site Map ringed;
 *   - the button reads "Capture Map" (it used to read "Copy map image").
 *
 * Hermetic: a stand-in view with a canvas-backed `takeScreenshot` (the recipe
 * from map-capture-button.test.mjs), no WebGL, no Esri CDN, no QLD services.
 * GitHub is blocked so the bundled definitions.json loads. Same invocation as
 * the other tests (see tests/README.md).
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

const A = '-27.471, 153.0234';
const B = '-28.318301, 152.92164';

try{
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });
  await page.waitForTimeout(400);   // definitions settle

  // Type into the anchor row's coordinate field exactly as a user would.
  const setCoord = (value) => page.evaluate((val)=>{
    const card = document.querySelector('#rowsContainer [data-preview-for="coords"]').closest('.row');
    const input = card && card.querySelector('input[type="text"], textarea');
    if(!input) throw new Error('anchor coordinate input not found');
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

  // Which buttons carry the ring right now.
  const rings = () => page.evaluate(() => {
    const cap = document.querySelector('.modal--map .smap-capture');
    return {
      siteMap: document.getElementById('siteMapBtn').classList.contains('needs-capture'),
      capture: cap ? cap.classList.contains('needs-capture') : null,
      siteMapTitle: document.getElementById('siteMapBtn').title
    };
  });

  // ---- 1. before anything has been captured ---------------------------------
  const start = await rings();
  check('start: 🗺 Site Map is ringed red before any capture', start.siteMap === true);
  check('start: its tooltip says why', /press 📸 Capture Map/.test(start.siteMapTitle));

  await setCoord(A);
  await page.evaluate(() => {
    buildSiteMapModal();
    // Stand-in for a settled, rendering MapView (map-capture-button.test.mjs).
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
      graphics: { removeAll(){}, add(){}, toArray: () => [] },   // drawPins draws here
      extent: null,
      takeScreenshot: () => Promise.resolve({ dataUrl: window.__mkRaster(kind), width:240, height:180 })
    });
    siteMap.esri = { reactiveUtils: { whenOnce: (pred) => new Promise(res => {
      const tick = () => { if(pred()) res(); else setTimeout(tick, 5); }; tick();
    }) }, Graphic: function(){ this.geometry = {}; } };
    siteMap.view = window.__mkView('rich');
    siteMap.renderedInterval = '5';
    refreshPins(activeTable());
  });
  const opened = await rings();
  check('modal: the button reads "📸 Capture Map"', await page.evaluate(() => /^📸 Capture Map$/.test(document.querySelector('.smap-capture').textContent.trim())));
  check('modal: the old "Copy map image" wording is gone from the modal', await page.evaluate(() => !/Copy map image/.test(document.querySelector('.modal--map').textContent)));
  check('modal: 📸 Capture Map is ringed red before it is pressed', opened.capture === true);
  check('modal: 🗺 Site Map still ringed', opened.siteMap === true);

  // ---- 2. press 📸 Capture Map → its ring goes at once; success clears both --
  const pressed = await page.evaluate(async () => {
    const btn = document.querySelector('.smap-capture');
    const run = captureVisibleMap(btn);
    const during = {
      capture: btn.classList.contains('needs-capture'),
      siteMap: document.getElementById('siteMapBtn').classList.contains('needs-capture')
    };
    const url = await run;
    return { during, url: !!url, source: siteMap.screenshot.source };
  });
  const afterCapture = await rings();
  check('press: 📸 Capture Map loses its ring the moment it is pressed', pressed.during.capture === false);
  check('press: 🗺 Site Map keeps its ring until the capture has succeeded', pressed.during.siteMap === true);
  check('press: the capture succeeded', pressed.url && pressed.source === 'capture');
  check('captured: 📸 Capture Map is not ringed', afterCapture.capture === false);
  check('captured: 🗺 Site Map is not ringed', afterCapture.siteMap === false);
  check('captured: the tooltip no longer nags', !/press 📸 Capture Map/.test(afterCapture.siteMapTitle));

  // ---- 3. things that are NOT a coordinate change leave the rings off --------
  await page.evaluate(() => invalidateScreenshot());     // a pan/zoom does exactly this
  const panned = await rings();
  check('pan: a pan/zoom does not bring the rings back', panned.siteMap === false && panned.capture === false);

  const otherEdit = await page.evaluate(() => {
    const pinRows = new Set(resolveMapPins(activeTable()).map(p => p.rowId));
    const prev = [...document.querySelectorAll('#rowsContainer [data-preview-for]')]
      .find(el => !pinRows.has(el.dataset.previewFor) && el.closest('.row').querySelector('input[type="text"], textarea'));
    if(!prev) return null;
    const input = prev.closest('.row').querySelector('input[type="text"], textarea');
    input.value = 'not a coordinate';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return prev.dataset.previewFor;
  });
  const edited = await rings();
  check('edit: found a non-coordinate field to edit', !!otherEdit);
  check('edit: editing a non-coordinate field does not bring the rings back', edited.siteMap === false && edited.capture === false);

  // ---- 4. a coordinate change brings both back — and changing it back doesn't clear them
  await setCoord(B);
  const moved = await rings();
  check('coords: changing a coordinate re-rings 🗺 Site Map', moved.siteMap === true);
  check('coords: ...and 📸 Capture Map', moved.capture === true);
  await setCoord(A);
  const movedBack = await rings();
  check('coords: changing it back still owes a capture (both stay ringed)', movedBack.siteMap === true && movedBack.capture === true);

  // ---- 5. a pin written back from the map counts as a coordinate change -------
  await page.evaluate(async () => { await captureVisibleMap(document.querySelector('.smap-capture')); });
  const recaptured = await rings();
  check('recapture: a second capture clears both again', recaptured.siteMap === false && recaptured.capture === false);
  await page.evaluate(() => {
    const table = activeTable();
    const pin = siteMap.pins.find(p => p.rowId === 'coords');
    writePinCoord(table, pin, '-27.472, 153.0235', null);   // what a pin drag / the side panel's Set does
  });
  const dragged = await rings();
  check('map edit: a pin moved on the map re-rings both buttons', dragged.siteMap === true && dragged.capture === true);

  // ---- 6. a failed capture puts the ring back on the button --------------------
  const failed = await page.evaluate(async () => {
    siteMap.view = window.__mkView('blank');     // the map hasn't drawn: export refuses it
    const btn = document.querySelector('.smap-capture');
    const url = await captureVisibleMap(btn);
    return { url };
  });
  const afterFail = await rings();
  check('fail: the blank capture was refused', failed.url === null);
  check('fail: 📸 Capture Map is ringed again — it still needs pressing', afterFail.capture === true);
  check('fail: 🗺 Site Map stays ringed', afterFail.siteMap === true);

  // ---- 7. a press the guards refuse leaves the ring on --------------------------
  const refused = await page.evaluate(async () => {
    const keep = siteMap.view;
    siteMap.view = null;                          // the map hasn't loaded
    await captureVisibleMap(document.querySelector('.smap-capture'));
    siteMap.view = keep;
    return document.querySelector('.smap-capture').classList.contains('needs-capture');
  });
  check('guard: a press refused before capturing (no map yet) keeps the ring', refused === true);

  // ---- 8. an automatic picture does not count as capturing ---------------------
  const auto = await page.evaluate(() => {
    siteMap.screenshot = { dataUrl:'data:image/png;base64,x', valid:true, meta:{}, source:'auto', at: Date.now() };
    renderCaptureNudge();
    return document.getElementById('siteMapBtn').classList.contains('needs-capture');
  });
  check('auto: a picture the app made by itself leaves 🗺 Site Map ringed', auto === true);

  check('no page errors', pageErrors.length === 0);
}catch(err){
  results.push({ name: 'test threw: ' + (err && err.stack || err), ok: false });
}finally{
  await browser.close();
  server.close();
}

let failedCount = 0;
for(const r of results){
  console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name);
  if(!r.ok) failedCount++;
}
if(pageErrors.length) console.log('page errors:\n  ' + pageErrors.join('\n  '));
if(failedCount){ console.log(`\nCapture-nudge test: ${failedCount} FAILED`); process.exit(1); }
console.log('\nCapture-nudge test: OK');
