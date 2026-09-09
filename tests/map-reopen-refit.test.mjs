/*
 * Regression test for "the Site Map opens where the LAST station was".
 *
 * The MapView is deliberately kept alive between opens (§6) — rebuilding it
 * costs a full Esri load — and the first manual pan or zoom latches
 * `siteMap.userHasAdjustedView`, which told `fitView` to leave the framing
 * alone. That flag used to survive a close, so a user who scoped one station,
 * closed the modal, and opened it again for the next station in the same
 * session landed on the PREVIOUS station's framing and had to hunt for their
 * own pins. It was only cleared when the anchor pin's coordinate had changed —
 * which misses every case where the anchor is a different row, where the
 * previous session had no resolvable anchor to compare against, and where the
 * user simply wants the pins re-framed.
 *
 * Every open now re-frames on the pins that are showing at that moment:
 * `openSiteMap` drops the manual framing, and both of its framing calls pass
 * `fitView({ force:true })` so a background capture-on-close restoring the flag
 * mid-open cannot strand the old view either. Manual framing still holds for as
 * long as the modal stays open — `fitView()` with no argument is unchanged.
 *
 * A9 — two further things had to be true before a re-open actually landed on the
 * new station, and neither was:
 *
 *   1. `openSiteMap` must frame the INTERACTIVE view. Capture-on-close rebuilds
 *      the map off-screen in the background (captureOffscreen), and while it does
 *      it points the module's view/layers/diagnostics at its own throwaway view.
 *      A re-open in that window framed the THROWAWAY, and the capture then handed
 *      the interactive view back exactly as it was — still on the last station.
 *      openSiteMap now takes the interactive view back first
 *      (`siteMap.offscreenRestore`), and the capture works from its own reference.
 *   2. `fitView` must CONFIRM the framing landed. A goTo issued while the modal is
 *      still being re-shown races the container's re-measure and can be dropped,
 *      so fitView now re-frames until the anchor really is in the middle of the
 *      view, bounded by SITE_MAP_CONFIG.frameAttempts.
 *
 * Drives the real `openSiteMap` / `fitView` / `drawPins` code against a stand-in view.
 * Fully hermetic: the central store, the Esri CDN and every QLD host are
 * blocked, and no WebGL view is ever created.
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
  await ctx.route('**://js.arcgis.com/**', r => r.abort());
  await ctx.route('**://*.arcgis.com/**', r => r.abort());
  await ctx.route('**://*.qld.gov.au/**', r => r.abort());
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });

  /* ---- fitView: forced framing overrides a manually adjusted view ---- */
  const forced = await page.evaluate(async ()=>{
    siteMap.esri = { reactiveUtils: { whenOnce: ()=> Promise.resolve(true) } };
    siteMap.pins = [{ key:'a', rowId:'coords', on:true, ok:true, anchor:true, lat:-17.1699, lon:145.68885, colour:'red', label:'Current location' }];
    const stub = ()=>{
      let calls = 0; const targets = [];
      siteMap.view = {
        ready:true, width:800, height:450, stationary:true, scale:5000,
        graphics:{ toArray:()=>[] },
        goTo:(t)=>{ calls++; targets.push(t); return Promise.resolve(); }
      };
      return ()=>({ calls, targets });
    };
    // The user panned away last session.
    siteMap.userHasAdjustedView = true;
    let read = stub();
    await fitView();
    const honoured = read().calls;
    read = stub();
    await fitView({ force:true });
    const overridden = read();
    return {
      honoured,
      forcedCalls: overridden.calls,
      forcedLat: overridden.targets[0] && overridden.targets[0].target && overridden.targets[0].target.latitude
    };
  });
  check('fitView() with no argument still honours a manually adjusted view', forced.honoured === 0);
  check('fitView({force:true}) re-frames a manually adjusted view', forced.forcedCalls === 1);
  check('the forced re-frame lands on the anchor pin', forced.forcedLat === -17.1699);

  /* ---- openSiteMap: every open drops the manual framing and forces a fit ---- */
  const opened = await page.evaluate(async ()=>{
    // Stand in for the pieces that would need the Esri CDN and a WebGL view, so
    // the real openSiteMap can run its re-open branch end to end.
    const realFit = window.fitView, realDraw = window.drawPins;
    const fitArgs = [];
    window.loadEsri = async ()=> (siteMap.esri = { reactiveUtils:{ whenOnce: ()=> Promise.resolve(true) } });
    window.fitView = async (opts)=>{ fitArgs.push(opts || null); };
    window.drawPins = ()=>{};
    window.mapBuildTrackRedraw = ()=>{};
    siteMap.view = {
      ready:true, width:800, height:450, stationary:true, scale:5000,
      graphics:{ toArray:()=>[] }, goTo:()=>Promise.resolve()
    };
    // The previous scoping session left the view panned/zoomed somewhere else.
    siteMap.userHasAdjustedView = true;
    const before = siteMap.userHasAdjustedView;

    await openSiteMap(document.getElementById('siteMapBtn'));
    const afterFirst = { adjusted: siteMap.userHasAdjustedView, fitArgs: fitArgs.slice() };

    // Close and re-open exactly as the user would for the next station.
    await closeSiteMap();
    siteMap.userHasAdjustedView = true;     // they panned again while it was open
    await openSiteMap(document.getElementById('siteMapBtn'));
    const afterSecond = { adjusted: siteMap.userHasAdjustedView, fitArgs: fitArgs.slice() };

    window.fitView = realFit; window.drawPins = realDraw;
    await closeSiteMap();
    return { before, afterFirst, afterSecond };
  });
  check('the manual framing is dropped on open', opened.afterFirst.adjusted === false);
  check('open frames the pins exactly once', opened.afterFirst.fitArgs.length === 1);
  check('open forces the fit, so a late flag restore cannot strand the old view',
        opened.afterFirst.fitArgs[0] && opened.afterFirst.fitArgs[0].force === true);
  check('a second open (next scoping session) re-frames again',
        opened.afterSecond.adjusted === false && opened.afterSecond.fitArgs.length === 2);
  check('the second open forces its fit too',
        opened.afterSecond.fitArgs[1] && opened.afterSecond.fitArgs[1].force === true);

  /* ---- A9.2: fitView re-frames until the view reports it landed ---- */
  const landing = await page.evaluate(async ()=>{
    // A view that only accepts the framing on its `landsOn`-th goTo, so we can see
    // whether fitView notices a frame that did not take and asks again.
    const makeView = (landsOn)=>{
      const v = {
        ready:true, width:800, height:450, stationary:true, scale:5000, suspended:false,
        __calls:0, __at:{ lon:151, lat:-27 },
        graphics:{ toArray:()=>[] },
        goTo(t){
          v.__calls++;
          if(v.__calls >= landsOn){ v.__at = { lon:t.target.longitude, lat:t.target.latitude }; }
          return Promise.resolve();
        },
        // Where a coordinate sits on screen: dead centre once the view is on it,
        // off in the corner while it is not.
        toScreen(pt){
          return (pt.longitude === v.__at.lon && pt.latitude === v.__at.lat)
            ? { x:400, y:225 } : { x:795, y:445 };
        }
      };
      return v;
    };
    siteMap.esri = {
      reactiveUtils:{ whenOnce: ()=> Promise.resolve(true) },
      Graphic: function(o){ this.geometry = o.geometry; }
    };
    siteMap.pins = [{ key:'a', rowId:'coords', on:true, ok:true, anchor:true, lat:-17.1699, lon:145.68885, colour:'red', label:'Current location' }];
    siteMap.userHasAdjustedView = false;

    siteMap.view = makeView(1);  await fitView({ force:true });
    const first = siteMap.view.__calls;
    siteMap.view = makeView(3);  await fitView({ force:true });
    const third = { calls: siteMap.view.__calls, at: siteMap.view.__at };
    siteMap.view = makeView(99); await fitView({ force:true });
    const never = siteMap.view.__calls;

    // An explicit view is framed instead of the module's (the off-screen capture).
    const modules = makeView(1), other = makeView(1);
    siteMap.view = modules;
    await fitView({ force:true, view: other });
    return { first, third, never, cap: SITE_MAP_CONFIG.frameAttempts,
             moduleCalls: modules.__calls, otherCalls: other.__calls };
  });
  check('a framing that lands is asked for exactly once', landing.first === 1);
  check('a framing that is dropped is asked for again', landing.third.calls === 3);
  check('the re-framing ends on the anchor pin', landing.third.at && landing.third.at.lat === -17.1699);
  check('re-framing is bounded by frameAttempts', landing.never === landing.cap && landing.cap >= 1);
  check('fitView({view}) frames the view it was given', landing.otherCalls === 1);
  check('fitView({view}) leaves the module view alone', landing.moduleCalls === 0);

  /* ---- A9.1: an open never frames the off-screen capture's throwaway view ---- */
  const handback = await page.evaluate(async ()=>{
    const fitArgs = [];
    const realFit = window.fitView, realDraw = window.drawPins;
    const interactive = { __id:'interactive', ready:true, width:800, height:450, stationary:true,
                          scale:5000, suspended:false, graphics:{ toArray:()=>[] }, goTo:()=>Promise.resolve() };
    const throwaway  = { __id:'throwaway',  ready:true, width:1600, height:1120, stationary:true,
                          scale:5000, suspended:false, graphics:{ toArray:()=>[] }, goTo:()=>Promise.resolve() };
    window.loadEsri = async ()=> (siteMap.esri = { reactiveUtils:{ whenOnce: ()=> Promise.resolve(true) } });
    window.drawPins = ()=>{};
    window.mapBuildTrackRedraw = ()=>{};
    window.fitView = async ()=>{ fitArgs.push(siteMap.view && siteMap.view.__id); };

    // Exactly the state captureOffscreen leaves behind while it builds.
    siteMap.view = throwaway;
    let handedBack = false;
    siteMap.offscreenRestore = ()=>{ handedBack = true; siteMap.view = interactive; siteMap.offscreenRestore = null; };

    await openSiteMap(document.getElementById('siteMapBtn'));
    const framed = fitArgs.slice();
    window.fitView = realFit; window.drawPins = realDraw;
    await closeSiteMap();
    return { handedBack, framed, cleared: siteMap.offscreenRestore };
  });
  check('opening hands the interactive view back from an off-screen capture', handback.handedBack === true);
  check('the open frames the interactive view, never the throwaway',
        handback.framed.length === 1 && handback.framed[0] === 'interactive');
  check('the hand-back is one-shot', !handback.cleared);

  /* ---- drawPins draws into the view it is given ---- */
  const pinned = await page.evaluate(()=>{
    siteMap.esri = { Graphic: function(o){ Object.assign(this, o); } };
    siteMap.pins = [{ key:'a', rowId:'coords', on:true, ok:true, anchor:true, lat:-17.1, lon:145.6, colour:'red', label:'Current location' }];
    const mk = ()=>{ const g = []; return { added:g, graphics:{ removeAll:()=>{ g.length = 0; }, add:x=>g.push(x) } }; };
    const modules = mk(), other = mk();
    siteMap.view = modules;
    drawPins(other);
    return { module: modules.added.length, other: other.added.length };
  });
  check('drawPins(view) draws into the view it was given', pinned.other === 1);
  check('drawPins(view) leaves the module view alone', pinned.module === 0);

  /* ---- the "Fit all pins" / reset controls are untouched ---- */
  const controls = await page.evaluate(()=>{
    const overlay = siteMap.overlay;
    return { reset: !!overlay.querySelector('.smap-reset'), fitall: !!overlay.querySelector('.smap-fitall') };
  });
  check('the reset control is still there for mid-session re-framing', controls.reset);
  check('the "Fit all pins" control is still there', controls.fitall);

  check('no uncaught page errors', pageErrors.length === 0);
  if(pageErrors.length) console.log('page errors:', pageErrors.slice(0,3));

} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('Site Map re-fit-on-open test: OK');
