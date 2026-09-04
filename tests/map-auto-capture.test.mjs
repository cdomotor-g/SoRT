/*
 * Regression test for §7.6 — "the tick box is enough".
 *
 * §7.5 gave the user a capture button so the picture that reaches Word is one
 * they have actually looked at. That is the *best* picture, not the required one:
 * a user who ticks "Include site map in copied output" has already said what they
 * want, and should not also have to find a modal and press a button inside it to
 * get it. So the tick box alone now arms the map: the app makes the picture
 * itself, and 📸 becomes the way to CHOOSE the framing and check the result.
 *
 * Drives the real code with a stand-in view (a canvas-backed `takeScreenshot`)
 * and real pins typed into the coordinate field, covering:
 *   - ticking the box with no capture → a picture is made straight away, tagged
 *     source "auto", and the toolbar chip says so rather than issuing an order;
 *   - "Copy table for Word" with the box ticked and nothing captured → an <img>
 *     lands in the copied HTML, without the user pressing 📸 at all;
 *   - one capture at a time: a Copy pressed while a warm-up is running waits for
 *     THAT capture instead of starting a second one on the same view;
 *   - a live view that comes back blank falls back to a fresh off-screen view
 *     rather than giving up on the picture;
 *   - a picture going stale while the box is ticked re-arms itself (debounced);
 *   - a capture the user made by hand is never overwritten by an automatic one;
 *   - the box UNTICKED changes nothing: no captures, no scheduling, and the copy
 *     is byte-identical to the map-free output (§7.4, §8);
 *   - no coordinates is not a failure — the chip must not cry about a map when
 *     the table simply has nothing to map;
 *   - a genuinely failed automatic attempt IS reported, and points at 📸.
 *
 * Hermetic: no WebGL, no Esri CDN, no QLD services. The central store is blocked
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
await context.route('**://*.supabase.co/**', r => r.abort());

try{
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  // The app is one plain <script>: function declarations land on `window`, but
  // `const siteMap` / `let includeMapCopy` / `let autoCaptureTimer` are lexical
  // globals, reachable as bare identifiers from page context (not via `window.`).
  await page.waitForFunction(() => typeof ensureMapPicture === 'function' && typeof siteMap !== 'undefined', null, { timeout: 15000 });
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });
  await page.waitForTimeout(600);   // definitions settle

  // ---- the stand-in world ----------------------------------------------------
  // A view that behaves like a settled, rendering MapView handing back a raster we
  // control: `rich` = a full-coverage many-colour frame (a real map), `blank` =
  // pins-on-transparent (the signature compositeScreenshot refuses). The Esri CDN
  // is never loaded: `loadEsri` is replaced by a resolved promise, and
  // whenCaptureReady only needs reactiveUtils.whenOnce.
  await page.evaluate(() => {
    window.__shots = 0;                       // how many rasters were actually taken
    window.__offscreenCalls = 0;              // how many off-screen rebuilds happened
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
      takeScreenshot: () => { window.__shots++; return new Promise(res => setTimeout(()=> res({ dataUrl: window.__mkRaster(kind), width:240, height:180 }), 30)); }
    });
    window.__esriStub = { reactiveUtils: { whenOnce: (pred) => new Promise(res => {
      const tick = () => { if(pred()) res(); else setTimeout(tick, 5); }; tick();
    }) }, Graphic: function(){ this.geometry = {}; } };
    window.loadEsri = () => Promise.resolve(window.__esriStub);   // never touch the CDN

    // Record what the copy actually put on the clipboard, and keep the real
    // ClipboardItem out of it — the point is the HTML, not the browser plumbing.
    window.__copied = null;
    navigator.clipboard.write = (items) => {
      const it = items && items[0];
      return it.getType('text/html').then(b => b.text()).then(html => { window.__copied = html; });
    };

    window.__armWorld = (kind) => {
      buildSiteMapModal();
      siteMap.esri = window.__esriStub;
      siteMap.view = window.__mkView(kind || 'rich');
      siteMap.renderedInterval = '5';
      siteMap.contoursOn = true;
      siteMap.screenshot = { dataUrl:null, valid:false, meta:null, source:null, at:null };
      siteMap.captureBusy = 0;
      autoCaptureFailed = false;
      if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
      window.__shots = 0; window.__offscreenCalls = 0; window.__copied = null;
    };
    window.__setTick = (on) => {
      const chk = document.getElementById('includeMapChk');
      chk.checked = !!on;
      chk.dispatchEvent(new Event('change'));
      return chk;
    };
  });

  // Real pins, typed into the anchor row's coordinate field exactly as a user
  // would — the automatic capture resolves pins from app state, not from a stub.
  async function setCoord(value){
    await page.evaluate((val)=>{
      const prev = document.querySelector('#rowsContainer [data-preview-for="coords"]');
      const card = prev && prev.closest('.row');
      const input = card && card.querySelector('input[type="text"], textarea');
      if(!input) throw new Error('anchor coordinate input not found');
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await setCoord('-27.4710, 153.0234');
  const pinsReady = await page.evaluate(()=>{ refreshPins(activeTable()); return activeSitePins().length; });
  check('setup: a real pin resolves from the typed coordinate', pinsReady === 1);

  // ---- 1. ticking the box is enough: the picture makes itself ----------------
  const ticked = await page.evaluate(async () => {
    window.__armWorld('rich');
    window.__setTick(false);
    const chip = document.getElementById('mapStateChip');
    window.__setTick(true);
    const armedText = chip.textContent;                 // before the capture lands
    await new Promise(r => setTimeout(r, 20));
    const busyText = chip.textContent, busyClass = chip.className;
    await ensureMapPicture();                           // join the run in flight
    await new Promise(r => setTimeout(r, 20));
    return {
      armedText,
      busyText, busyBusy: /map-state--busy/.test(busyClass),
      shots: window.__shots,
      valid: siteMap.screenshot.valid,
      source: siteMap.screenshot.source,
      isPng: typeof siteMap.screenshot.dataUrl === 'string' && siteMap.screenshot.dataUrl.startsWith('data:image/png'),
      chipText: chip.textContent,
      chipOk: chip.classList.contains('map-state--ok'),
      cardText: document.querySelector('.smap-capture-state').textContent,
      diag: diagnosticsText()
    };
  });
  check('tick: a picture is made without the capture button being pressed', ticked.shots === 1 && ticked.valid && ticked.isPng);
  check('tick: it is tagged "auto", so an unattended picture is never mistaken for a checked one', ticked.source === 'auto');
  check('tick: the chip says the picture is coming, not that the user must go and make it', /made automatically/i.test(ticked.armedText) && !/No map picture captured yet/i.test(ticked.armedText));
  check('tick: while it runs the chip says so', ticked.busyBusy && /Making the map picture/i.test(ticked.busyText));
  check('tick: when it lands the chip reports a ready picture, made automatically', ticked.chipOk && /Map picture ready/.test(ticked.chipText) && /made automatically/i.test(ticked.chipText));
  check('tick: the modal card says the same, and still offers a framed capture', /Made automatically/i.test(ticked.cardText) && /Copy map image/.test(ticked.cardText));
  check('tick: diagnostics record that nobody has looked at it', /Picture for the Word copy: made automatically/.test(ticked.diag));

  // ---- 2. the copy carries the map, with 📸 never pressed --------------------
  const copied = await page.evaluate(async () => {
    window.__armWorld('rich');
    window.__setTick(true);
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }   // no warm-up: make Copy do the work
    await copyTable();
    const html = window.__copied || '';
    return {
      shots: window.__shots,
      hasImg: /<img src="data:image\/png/.test(html),
      hasTable: /<table/i.test(html),
      source: siteMap.screenshot.source,
      status: document.getElementById('statusMsg').textContent
    };
  });
  check('copy: the map picture is built during the copy when none was captured', copied.shots === 1 && copied.hasImg);
  check('copy: the scope table is still there — the map is an addition, not a replacement', copied.hasTable);
  check('copy: the status line says the picture was made automatically, and where to frame one', /made automatically/i.test(copied.status) && /Site Map/.test(copied.status));

  // ---- 3. one capture at a time ---------------------------------------------
  // A Copy pressed while the capture-on-close warm-up is still running must wait
  // for THAT capture, not start a second one fighting it over the same view.
  const singleFlight = await page.evaluate(async () => {
    window.__armWorld('rich');
    window.__setTick(true);
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    const a = ensureMapPicture();
    const b = ensureMapPicture();
    const same = a === b;
    const [ra, rb] = await Promise.all([a, b]);
    return { same, shots: window.__shots, sameResult: !!ra && !!rb && ra.dataUrl === rb.dataUrl };
  });
  check('single-flight: two callers share one capture', singleFlight.same && singleFlight.shots === 1 && singleFlight.sameResult);

  // ---- 4. a blank live view falls back to a fresh off-screen one -------------
  // The live view is the fragile path — it has just come back from being
  // suspended, so a base layer can still be mid-fetch when the settle budget runs
  // out and the frame is refused as blank. Giving up there would put no map in the
  // document; a throwaway off-screen view is laid out, never suspended and drawn
  // from scratch, so it is the retry with a reason to succeed.
  const fallback = await page.evaluate(async () => {
    window.__armWorld('blank');                       // live view renders nothing
    const realOffscreen = window.captureOffscreen;
    window.captureOffscreen = async () => {
      window.__offscreenCalls++;
      const dataUrl = window.__mkRaster('rich');
      const meta = { interval:'5', pinsTotal:1, pinsInView:1 };
      siteMap.screenshot = { dataUrl, valid:true, meta, source:'auto', at: Date.now() };
      return { dataUrl, meta };
    };
    window.__setTick(true);
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    const res = await ensureMapPicture();
    window.captureOffscreen = realOffscreen;
    return {
      offscreenCalls: window.__offscreenCalls,
      got: !!(res && res.dataUrl),
      valid: siteMap.screenshot.valid,
      failed: autoCaptureFailed,
      diag: diagnosticsText()
    };
  });
  check('fallback: a blank live-view frame is retried off-screen rather than abandoned', fallback.offscreenCalls === 1 && fallback.got && fallback.valid);
  check('fallback: with a picture in hand nothing is reported as failed', fallback.failed === false);
  check('fallback: the off-screen rebuild is logged for the diagnostics', /rebuilding it off-screen/i.test(fallback.diag));

  // ---- 5. a stale picture replaces itself, debounced -------------------------
  const rearm = await page.evaluate(async () => {
    window.__armWorld('rich');
    window.__setTick(true);
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    await ensureMapPicture();
    const madeFirst = window.__shots;
    invalidateScreenshot();                       // a pan / a pin edit
    const armed = autoCaptureTimer !== null;
    invalidateScreenshot(); invalidateScreenshot();
    const stillOne = autoCaptureTimer !== null;   // debounced, not queued up
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    // With the modal actually OPEN the user is still framing it — closeSiteMap
    // captures whatever they settle on, so nothing is armed underneath them.
    siteMap.screenshot = { dataUrl:'data:image/png;base64,x', valid:true, meta:{}, source:'auto', at: Date.now() };
    siteMap.overlay.classList.remove('hidden');
    invalidateScreenshot();
    const armedWhileOpen = autoCaptureTimer !== null;
    siteMap.overlay.classList.add('hidden');
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    return { madeFirst, armed, stillOne, armedWhileOpen };
  });
  check('re-arm: a picture that goes stale while the box is ticked replaces itself', rearm.madeFirst === 1 && rearm.armed);
  check('re-arm: a burst of changes schedules one capture, not one each', rearm.stillOne);
  check('re-arm: nothing is captured behind the user while the Site Map is open', rearm.armedWhileOpen === false);

  // ---- 6. a picture the user framed is never overwritten ---------------------
  const manual = await page.evaluate(async () => {
    window.__armWorld('rich');
    const btn = document.querySelector('.smap-capture');
    await captureVisibleMap(btn);                 // the user presses 📸
    const afterCapture = { source: siteMap.screenshot.source, url: siteMap.screenshot.dataUrl, shots: window.__shots };
    const res = await ensureMapPicture();         // the copy asks for a picture
    return {
      afterCapture,
      shotsAfter: window.__shots,
      source: siteMap.screenshot.source,
      sameUrl: res && res.dataUrl === afterCapture.url,
      chipText: document.getElementById('mapStateChip').textContent
    };
  });
  check('manual: pressing 📸 still arms the tick box and caches a user capture', manual.afterCapture.source === 'capture');
  check('manual: the automatic path hands back that picture untouched — no second capture', manual.shotsAfter === manual.afterCapture.shots && manual.sameUrl && manual.source === 'capture');
  check('manual: the chip credits the user, not the machine', /captured/i.test(manual.chipText) && !/made automatically/i.test(manual.chipText));

  // ---- 7. unticked means unchanged (§7.4, §8) -------------------------------
  const off = await page.evaluate(async () => {
    window.__armWorld('rich');
    window.__setTick(false);
    const armedOnUntick = autoCaptureTimer !== null;
    siteMap.screenshot = { dataUrl:'data:image/png;base64,x', valid:true, meta:{}, source:'auto', at: Date.now() };
    invalidateScreenshot();
    const armedOnChange = autoCaptureTimer !== null;
    await copyTable();
    const html = window.__copied || '';
    return {
      armedOnUntick, armedOnChange,
      shots: window.__shots,
      hasImg: /<img/.test(html),
      hasTable: /<table/i.test(html),
      chipHidden: document.getElementById('mapStateChip').hidden
    };
  });
  check('unticked: nothing is captured and nothing is scheduled', off.armedOnUntick === false && off.armedOnChange === false && off.shots === 0);
  check('unticked: the copy is the map-free output it always was', off.hasTable && !off.hasImg);
  check('unticked: the toolbar stays quiet', off.chipHidden);

  // ---- 8. no coordinates is not a failure -----------------------------------
  const noPins = await page.evaluate(async () => {
    window.__armWorld('rich');
    const saved = siteMap.pins;
    const table = activeTable();
    const savedRefresh = window.refreshPins;
    window.refreshPins = () => { siteMap.pins = []; };      // a table with no coordinates
    siteMap.pins = [];
    window.__setTick(true);
    const res = await ensureMapPicture();
    await copyTable();
    const html = window.__copied || '';
    const out = {
      res, failed: autoCaptureFailed,
      shots: window.__shots,
      chipWarn: document.getElementById('mapStateChip').classList.contains('map-state--warn'),
      status: document.getElementById('statusMsg').textContent,
      hasTable: /<table/i.test(html), hasImg: /<img/.test(html)
    };
    window.refreshPins = savedRefresh; siteMap.pins = saved; refreshPins(table);
    return out;
  });
  check('no pins: nothing is captured and nothing is reported as broken', noPins.res === null && noPins.shots === 0 && noPins.failed === false && !noPins.chipWarn);
  check('no pins: the copy says why there is no map, and still copies the table', /no coordinates/i.test(noPins.status) && noPins.hasTable && !noPins.hasImg);

  // ---- 9. a failure IS reported, and points at the button -------------------
  const failed = await page.evaluate(async () => {
    window.__armWorld('blank');                   // live view renders nothing …
    const realOffscreen = window.captureOffscreen;
    window.captureOffscreen = async () => { window.__offscreenCalls++; throw new Error('off-screen build failed'); };  // … and so does the retry
    window.__setTick(true);
    if(autoCaptureTimer){ clearTimeout(autoCaptureTimer); autoCaptureTimer = null; }
    const res = await ensureMapPicture();
    const offscreenTried = window.__offscreenCalls === 1;   // before Copy tries again
    const chip = document.getElementById('mapStateChip');
    await copyTable();                                       // a retry per copy is deliberate
    const html = window.__copied || '';
    window.captureOffscreen = realOffscreen;
    return {
      res, failed: autoCaptureFailed,
      offscreenTried,
      chipWarn: chip.classList.contains('map-state--warn'),
      chipText: chip.textContent,
      status: document.getElementById('statusMsg').textContent,
      hasTable: /<table/i.test(html), hasImg: /<img/.test(html)
    };
  });
  check('failure: both routes are tried before giving up', failed.res === null && failed.offscreenTried && failed.failed === true);
  check('failure: the chip says so plainly and offers the Site Map', failed.chipWarn && /Couldn’t make the map picture/.test(failed.chipText) && /Site Map/.test(failed.chipText));
  check('failure: the copy still produces the tables and says the map is missing (§7.4)', failed.hasTable && !failed.hasImg && /map not included/i.test(failed.status));

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
if(failed){ console.error('Map auto-capture test: FAILED'); process.exit(1); }
console.log('Map auto-capture test: OK');
