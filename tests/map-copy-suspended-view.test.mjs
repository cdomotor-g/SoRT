/*
 * Regression test for the "Site Map copy-for-Word exports pins + legend but no
 * map" defect. The MapView is SUSPENDED when the screenshot is taken — the modal
 * is hidden with `.hidden { display:none }`, and per the Esri docs a view whose
 * container is display:none stops rendering and updating. So at capture time:
 *   - every base LayerView (imagery, contours, road, rail, labels) has stopped
 *     drawing → nothing in the frame;
 *   - view.graphics (the pins) still paint from geometry held in memory → pins;
 *   - the legend/stamp/attribution are composited on afterwards → always present.
 * That is exactly pins + legend + no map. It stayed silent because a suspended
 * view reports `updating === false` (it has simply STOPPED), so the old
 * `whenOnce(() => !view.updating)` gate resolved instantly on an empty frame, and
 * the old all-black probe never fired on a TRANSPARENT frame that a white base
 * fill then turned into a plausible pale "map".
 *
 * This is a DOM/CSS problem, not a service problem, so it IS reproducible without
 * js.arcgis.com or the QLD hosts. The test drives the real functions against
 * stand-in views:
 *   - beginCaptureVisibility() parks the overlay in the one hidden state
 *     (visibility:hidden) that keeps `suspended === false`;
 *   - whenCaptureReady() waits for an un-suspended, settled, painted frame
 *     instead of the stale `updating === false`;
 *   - takeViewScreenshot() reads the native framebuffer (no resample);
 *   - rasterStats() measures the RAW raster and fails a nearly-empty frame loudly;
 *   - compositeScreenshot() throws rather than export pins-on-white;
 *   - the diagnostics name the coverage and the suspension state.
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
const port = server.address().port;
const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

try {
  const ctx = await browser.newContext();
  await ctx.route('**://*.supabase.co/**', r => r.abort());
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });

  // ---- Capture visibility: the .hidden (display:none) state SUSPENDS the view;
  //      a capture must swap it for visibility:hidden, which does NOT. -----------
  const vis = await page.evaluate(()=>{
    buildSiteMapModal();                       // creates siteMap.overlay (.smap-overlay.hidden)
    const ov = siteMap.overlay;
    const restore = beginCaptureVisibility();  // hidden → capturing
    const swapped = !ov.classList.contains('hidden') && ov.classList.contains('smap-capturing');
    const cs = getComputedStyle(ov);
    const visibility = cs.visibility, pointerEvents = cs.pointerEvents;
    restore();                                 // capturing → hidden
    const restored = ov.classList.contains('hidden') && !ov.classList.contains('smap-capturing');
    // Already on screen (modal open): must be a no-op, and its restore must not re-hide.
    ov.classList.remove('hidden');
    const restore2 = beginCaptureVisibility();
    const noop = !ov.classList.contains('smap-capturing');
    restore2();
    const stillVisible = !ov.classList.contains('hidden');
    ov.classList.add('hidden');                // leave it clean for later sections
    return { swapped, visibility, pointerEvents, restored, noop, stillVisible };
  });
  check('capture visibility: a capture swaps .hidden for .smap-capturing (un-suspends the view)', vis.swapped === true);
  check('capture visibility: .smap-capturing computes to visibility:hidden (keeps suspended === false)', vis.visibility === 'hidden');
  check('capture visibility: .smap-capturing computes to pointer-events:none (invisible + click-through)', vis.pointerEvents === 'none');
  check('capture visibility: restore() puts .hidden back and clears .smap-capturing', vis.restored === true);
  check('capture visibility: no-op when the modal is already on screen (nothing to un-hide)', vis.noop === true && vis.stillVisible === true);

  // ---- whenCaptureReady: waits for an un-suspended, settled frame — NOT the
  //      stale `updating === false` a suspended view reports. -------------------
  const ready = await page.evaluate(async ()=>{
    // Poll-based whenOnce that evaluates the predicate safely.
    siteMap.esri = { reactiveUtils: { whenOnce: (pred)=> new Promise(res=>{
      const tick = ()=>{ let ok=false; try{ ok = !!pred(); }catch(_){ ok=false; } if(ok){ clearInterval(iv); res(true); } };
      const iv = setInterval(tick, 5); tick();
    }) } };
    // Starts SUSPENDED (but reports updating:false, like a real suspended view),
    // then un-suspends and settles a moment later.
    let lvUpdating = true;
    const view = {
      suspended: true, ready: true, width: 900, height: 500, updating: false,
      allLayerViews: { toArray: ()=> [ { updating: lvUpdating } ] }
    };
    let resolved = false;
    const p = whenCaptureReady(view).then(()=>{ resolved = true; });
    await new Promise(r=> setTimeout(r, 60));
    const resolvedWhileSuspended = resolved;   // must be false — the old gate would be true here
    view.suspended = false; lvUpdating = false;
    await p;
    return { resolvedWhileSuspended, resolved };
  });
  check('whenCaptureReady: does NOT resolve while the view is suspended (unlike the old !updating gate)', ready.resolvedWhileSuspended === false);
  check('whenCaptureReady: resolves once the view un-suspends and every layer view is idle', ready.resolved === true);

  // ---- whenCaptureReady is bounded: it must never hang the copy on a layer that
  //      stays "updating" forever (a retrying service). --------------------------
  const bounded = await page.evaluate(async ()=>{
    siteMap.esri = { reactiveUtils: { whenOnce: (pred)=> new Promise(res=>{
      const tick = ()=>{ let ok=false; try{ ok = !!pred(); }catch(_){ } if(ok){ clearInterval(iv); res(true); } };
      const iv = setInterval(tick, 5); tick();
    }) } };
    const saved = SITE_MAP_CONFIG.timeouts.layer;
    SITE_MAP_CONFIG.timeouts.layer = 80;       // shrink the bound so the test is quick
    const view = { suspended:false, ready:true, width:900, height:500, updating:true,
                   allLayerViews:{ toArray: ()=> [ { updating:true } ] } };   // never idles
    const t0 = Date.now();
    let resolved = false;
    await whenCaptureReady(view).then(()=>{ resolved = true; });
    const dt = Date.now() - t0;
    SITE_MAP_CONFIG.timeouts.layer = saved;
    return { resolved, dt };
  });
  check('whenCaptureReady: bounded — resolves even when a layer view never goes idle', bounded.resolved === true);
  check('whenCaptureReady: the bounded wait does not hang (well under a second here)', bounded.dt < 2000);

  // ---- rasterStats: measure the RAW frame — coverage + distinct colours — so a
  //      pins-on-transparent capture is distinguishable from real imagery. -------
  const rs = await page.evaluate(()=>{
    // A) full-coverage, many-colour raster (real-imagery stand-in).
    const c1 = document.createElement('canvas'); c1.width = 200; c1.height = 140;
    const x1 = c1.getContext('2d');
    const id = x1.createImageData(200, 140);
    for(let i=0;i<id.data.length;i+=4){
      const px = (i/4)|0, x = px%200, y = (px/200)|0;
      id.data[i] = (x*7)%256; id.data[i+1] = (y*11)%256; id.data[i+2] = (x*y)%256; id.data[i+3] = 255;
    }
    x1.putImageData(id, 0, 0);
    const full = rasterStats(x1, 200, 140);
    // B) mostly-transparent frame with only a few opaque pins (suspended-view stand-in).
    const c2 = document.createElement('canvas'); c2.width = 200; c2.height = 140;
    const x2 = c2.getContext('2d');            // left transparent
    x2.fillStyle = '#d62828'; x2.fillRect(20, 20, 6, 6);
    x2.fillStyle = '#1e6ec8'; x2.fillRect(90, 70, 6, 6);
    x2.fillStyle = '#28a745'; x2.fillRect(150, 110, 6, 6);
    const pins = rasterStats(x2, 200, 140);
    return { full, pins };
  });
  check('rasterStats: a full-coverage many-colour raster reads ~100% covered, many colours', rs.full && rs.full.coverage > 0.9 && rs.full.distinct > 4);
  check('rasterStats: a pins-on-transparent frame reads low coverage / few colours (the blank-map signature)', rs.pins && rs.pins.coverage < 0.5 && rs.pins.distinct <= 4);

  // ---- compositeScreenshot: export a real capture, but THROW on a near-empty one
  //      rather than paste pins-on-white into a scope document. -----------------
  const comp = await page.evaluate(async ()=>{
    // A REAL (full-coverage) screenshot data URL.
    const c1 = document.createElement('canvas'); c1.width = 240; c1.height = 160;
    const x1 = c1.getContext('2d');
    const id = x1.createImageData(240, 160);
    for(let i=0;i<id.data.length;i+=4){
      const px = (i/4)|0, x = px%240, y = (px/240)|0;
      id.data[i] = (x*5)%256; id.data[i+1] = (y*9)%256; id.data[i+2] = ((x+y)*3)%256; id.data[i+3] = 255;
    }
    x1.putImageData(id, 0, 0);
    const realShot = { dataUrl: c1.toDataURL('image/png') };
    // An EMPTY (transparent + a couple of pins) screenshot data URL.
    const c2 = document.createElement('canvas'); c2.width = 240; c2.height = 160;
    const x2 = c2.getContext('2d');
    x2.fillStyle = '#d62828'; x2.fillRect(30, 30, 7, 7);
    x2.fillStyle = '#1e6ec8'; x2.fillRect(120, 90, 7, 7);
    const emptyShot = { dataUrl: c2.toDataURL('image/png') };

    // A non-suspended stand-in view so the diag records suspended:no.
    siteMap.view = { suspended:false, ready:true, width:240, height:160, updating:false, allLayerViews:{ toArray:()=>[] } };
    resetDiag();

    let realUrl = null, realThrew = false;
    try{ realUrl = await compositeScreenshot(realShot, '5'); }catch(_){ realThrew = true; }
    // Snapshot primitives NOW — setDiag mutates the screenshot object in place, so
    // the empty capture below would otherwise overwrite what we read here.
    const ss = siteMap.diag.screenshot || {};
    const okStatus = ss.status, okCoverage = ss.coverage, okSuspended = ss.suspended;

    let emptyThrew = false, emptyMsg = '';
    try{ await compositeScreenshot(emptyShot, '5'); }catch(e){ emptyThrew = true; emptyMsg = String(e.message || e); }
    const failStatus = (siteMap.diag.screenshot || {}).status;

    return {
      realThrew, realIsPng: !!(realUrl && realUrl.indexOf('data:image/png') === 0),
      okStatus, okCoverage, okSuspended,
      emptyThrew, emptyMsg, failStatus
    };
  });
  check('compositeScreenshot: a real full-coverage capture returns a PNG data URL (no throw)', comp.realThrew === false && comp.realIsPng === true);
  check('compositeScreenshot: records status ok + measured coverage + suspended:no after a real capture', comp.okStatus === 'ok' && typeof comp.okCoverage === 'number' && comp.okCoverage > 0.9 && comp.okSuspended === false);
  check('compositeScreenshot: a pins-on-transparent frame THROWS (never exports a blank map)', comp.emptyThrew === true && /nearly empty/.test(comp.emptyMsg));
  check('compositeScreenshot: records status failed after the near-empty capture', comp.failStatus === 'failed');

  // ---- Diagnostics name the coverage and the suspension state (the only
  //      debugging surface on the target machine — there is no DevTools). --------
  const diag = await page.evaluate(async ()=>{
    const c = document.createElement('canvas'); c.width = 200; c.height = 140;
    const x = c.getContext('2d');
    const id = x.createImageData(200, 140);
    for(let i=0;i<id.data.length;i+=4){
      const px = (i/4)|0, xx = px%200, yy = (px/200)|0;
      id.data[i] = (xx*5)%256; id.data[i+1] = (yy*9)%256; id.data[i+2] = ((xx+yy)*3)%256; id.data[i+3] = 255;
    }
    x.putImageData(id, 0, 0);
    siteMap.view = { suspended:false, ready:true, width:200, height:140, updating:false, allLayerViews:{ toArray:()=>[ {updating:false}, {updating:false} ] } };
    resetDiag();
    await compositeScreenshot({ dataUrl: c.toDataURL('image/png') }, '5');
    const okText = diagnosticsText();
    // Now flip the LIVE view to suspended and re-read the live render state block.
    siteMap.view = { suspended:true, ready:true, width:200, height:140, updating:false, allLayerViews:{ toArray:()=>[ {updating:false} ] } };
    const susText = diagnosticsText();
    return { okText, susText };
  });
  check('diagnostics: "Screenshot capture: ok" line names the coverage', /Screenshot capture: ok/.test(diag.okText) && /% covered/.test(diag.okText));
  check('diagnostics: reports "View suspended at capture: no" for a rendering view', /View suspended at capture: no/.test(diag.okText));
  check('diagnostics: "Live render state" flags a currently SUSPENDED view', /Live render state:/.test(diag.susText) && /suspended:true/.test(diag.susText) && /SUSPENDED/.test(diag.susText));

  // ---- Escape is ignored while a capture has briefly un-hidden the overlay into
  //      the invisible .smap-capturing state (else Escape would close a modal the
  //      user cannot see). -----------------------------------------------------
  const esc = await page.evaluate(()=>{
    buildSiteMapModal();                       // ensures the keydown listener is attached
    const ov = siteMap.overlay;
    siteMap.view = null;                       // so a wrongly-fired close would hide synchronously
    siteMap.triggerEl = null;
    ov.classList.remove('hidden'); ov.classList.add('smap-capturing');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const closed = ov.classList.contains('hidden');   // must stay false — the guard blocked it
    ov.classList.remove('smap-capturing'); ov.classList.add('hidden');   // clean up
    return { closed };
  });
  check('escape: ignored while the overlay is mid-capture (.smap-capturing) — the modal is not closed', esc.closed === false);

  check('no uncaught page errors', pageErrors.length === 0);

} finally {
  await browser.close();
  server.close();
}

for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('Map copy suspended-view test: OK');
