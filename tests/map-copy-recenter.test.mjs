/*
 * Regression test for two Site Map defects that only surface on the live view but
 * whose logic can be driven headlessly with a stand-in view (no WebGL, no QLD
 * services, no Esri CDN, nothing stubbed on the QLD side):
 *
 *   Copy (A2) — the copied/pasted map image must be captured at the view's NATIVE
 *     framebuffer size. Passing takeScreenshot an explicit width/height RESAMPLES:
 *     larger than the view re-renders the scene (blanking not-yet-fetched raster
 *     tiles — the "copied map is just pins on white" defect), and passing the CSS-
 *     pixel view.width down-samples on a high-DPI display. `takeViewScreenshot`
 *     must pass NO size at all.
 *
 *   Re-centre (A3) — when the modal is re-opened the map container goes
 *     display:none → visible, so the re-show resize can interrupt the framing goTo,
 *     which used to be swallowed, leaving the OLD centre on screen. `fitView` must
 *     wait for the view to be displayed and retry a goTo that was interrupted, and
 *     `whenViewDisplayed` must not return until the container has a real size.
 *
 * Drives the real `takeViewScreenshot` / `whenViewDisplayed` / `fitView` code with a
 * stand-in `siteMap.view` + `siteMap.esri`. The central store is blocked so the
 * bundled definitions.json loads.
 *
 * Run: see tests/README.md (same invocation as reopen-coords.test.mjs).
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

  // ---- Copy (A2): screenshot is captured at the view's NATIVE framebuffer size.
  //      takeViewScreenshot must pass NO width/height — an explicit size makes
  //      takeScreenshot RESAMPLE the scene (blanking not-yet-fetched raster tiles,
  //      and down-sampling on a high-DPI display where view.width is CSS pixels). --
  const cap = await page.evaluate(async ()=>{
    const calls = [];
    const view = { width: 812, height: 447, takeScreenshot: function(){ calls.push({ argc: arguments.length, first: arguments[0] }); return Promise.resolve({ dataUrl:'data:image/png;base64,AAAA' }); } };
    await takeViewScreenshot(view);
    return {
      argc: calls[0].argc,
      firstIsUndefined: calls[0].first === undefined,
      exportWidth: SITE_MAP_CONFIG.screenshotWidth,
      offscreen: SITE_MAP_CONFIG.offscreenSize
    };
  });
  check('copy: takeScreenshot called with NO arguments (1:1 native framebuffer read)', cap.argc === 0);
  check('copy: no forced width/height reaches takeScreenshot (no resample, no down-sample)', cap.firstIsUndefined);
  // The off-screen copy view is built at the export width so its native capture is
  // already high-res without any up-scale.
  check('copy: off-screen copy view is built at the export width', cap.offscreen && cap.offscreen.width === cap.exportWidth);

  // ---- Re-centre (A3): whenViewDisplayed waits for the container to gain size. ----
  const waited = await page.evaluate(async ()=>{
    // A whenOnce that resolves the moment the predicate turns true (poll-based
    // stand-in for the reactive one).
    siteMap.esri = { reactiveUtils: { whenOnce: (pred)=> new Promise(res=>{
      if(pred()){ res(true); return; }
      const iv = setInterval(()=>{ if(pred()){ clearInterval(iv); res(true); } }, 5);
    }) } };
    const v = { ready:true, width:0, height:0 };   // just re-shown, not measured yet
    const p = whenViewDisplayed(v);
    let resolvedEarly = false;
    p.then(()=>{ resolvedEarly = (v.width === 0); });
    // The ResizeObserver "fires" a moment later, giving the container its real size.
    setTimeout(()=>{ v.width = 900; v.height = 500; }, 25);
    await p;
    return { width: v.width, resolvedEarly };
  });
  check('reopen: whenViewDisplayed waits until the container has a real size', waited.width === 900);
  check('reopen: whenViewDisplayed does not resolve while the size is still zero', waited.resolvedEarly === false);

  // ---- Re-centre (A3): a goTo interrupted by the re-show resize is retried. ------
  const retry = await page.evaluate(async ()=>{
    siteMap.esri = { reactiveUtils: { whenOnce: ()=> Promise.resolve(true) } };
    siteMap.userHasAdjustedView = false;
    siteMap.pins = [{ key:'a', rowId:'coords', on:true, ok:true, anchor:true, lat:-17.1699, lon:145.68885, colour:'red', label:'Current location' }];
    let gotoCalls = 0;
    const targets = [];
    siteMap.view = {
      ready:true, width:800, height:450, stationary:true, scale:5000,
      graphics:{ toArray:()=>[] },
      goTo: (target)=>{
        gotoCalls++; targets.push(target);
        // The first framing goTo is interrupted by the re-show resize (rejects);
        // the retry after the view settles must succeed and land the new anchor.
        if(gotoCalls === 1) return Promise.reject(Object.assign(new Error('goTo interrupted'), { name:'AbortError' }));
        return Promise.resolve();
      }
    };
    let threw = false;
    try{ await fitView(); }catch(_){ threw = true; }
    const last = targets[targets.length-1];
    return { gotoCalls, threw, lastLat: last && last.target && last.target.latitude };
  });
  check('reopen: an interrupted framing goTo is retried, not swallowed', retry.gotoCalls === 2);
  check('reopen: fitView never throws out of framing', retry.threw === false);
  check('reopen: the retry frames the new anchor coordinate', retry.lastLat === -17.1699);

  // ---- fitView still honours a user-adjusted view (no surprise re-frame). -------
  const honoured = await page.evaluate(async ()=>{
    siteMap.userHasAdjustedView = true;
    let called = 0;
    siteMap.view = { ready:true, width:800, height:450, stationary:true, graphics:{ toArray:()=>[] }, goTo:()=>{ called++; return Promise.resolve(); } };
    await fitView();
    return { called };
  });
  check('manual framing preserved: fitView does not goTo when user-adjusted', honoured.called === 0);

  check('no uncaught page errors', pageErrors.length === 0);

} finally {
  await browser.close();
  server.close();
}

for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('Map copy + re-centre test: OK');
