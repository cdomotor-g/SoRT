/*
 * Regression test for the Site Map visual work:
 *
 *   - Road reserve carries a 50%-transparent SANDY fill (emulating the QLD Globe
 *     view), not the old no-fill outline-only symbology.
 *   - Contours default to 5 m (1 m is still selectable), and the contour line is
 *     WARMER + slightly THICKER so it reads over the aerial base map.
 *   - The live contour-sublayer name probe resolves "N metre" spellings, so the
 *     new 5 m default actually resolves an id (the old \bN\s*m\b probe missed it).
 *   - A non-blocking build-progress bar sits at the bottom of the map: it starts
 *     at zero, advances through milestones, trickles while the map is drawing,
 *     completes and hides when it settles, resets to zero on a change, and never
 *     captures pointer events (so the map is never locked).
 *
 * It drives the real page globals (SITE_MAP_CONFIG, contourRenderer,
 * buildSiteMapModal, mapBuild*) and is hermetic: the central store, the Esri CDN
 * and every QLD host are blocked, so nothing here touches the network. The
 * progress lifecycle is exercised directly (no WebGL view needed).
 *
 * Run (same invocation as the other tests — see tests/README.md):
 *   PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
 *   PW_CHROMIUM=/opt/pw-browsers/chromium-*\/chrome-linux/chrome \
 *     node tests/map-visuals.test.mjs
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

// resolveContourLayers' interval matcher isn't a global; mirror it here and pin
// the behaviour the 5 m default depends on (the QLD sublayers are "N metre …").
(function testIntervalRegex(){
  const intervalFromName = (n)=>{ const m = String(n).toLowerCase().match(/(?:^|[^0-9])(10|5|1)\s*(?:m\b|met(?:re|er)s?\b)/); return m ? m[1] : null; };
  check('probe: "1 metre Contours (LiDAR)" resolves 1',  intervalFromName('1 metre Contours (LiDAR derived)') === '1');
  check('probe: "5 metre Contours (LiDAR)" resolves 5',  intervalFromName('5 metre Contours (LiDAR derived)') === '5');
  check('probe: "10 metre Contours" resolves 10',        intervalFromName('10 metre Contours') === '10');
  check('probe: "5 m Contour" resolves 5',               intervalFromName('5 m Contour') === '5');
  check('probe: "1m contour" resolves 1',                intervalFromName('1m contour') === '1');
})();

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

  // ---- config + defaults ----------------------------------------------------
  const cfg = await page.evaluate(()=>({
    roadFill: SITE_MAP_CONFIG.roadFill,
    line: SITE_MAP_CONFIG.contourLine,
    layerOpacity: SITE_MAP_CONFIG.contourLayerOpacity,
    interval: siteMap.contourInterval,
    rendered: siteMap.renderedInterval,
    renderer: contourRenderer()
  }));
  check('road reserve has a sandy fill at 50% alpha',
    Array.isArray(cfg.roadFill) && cfg.roadFill[3] === 0.5 && cfg.roadFill[0] > 180 && cfg.roadFill[1] > 150 && cfg.roadFill[2] < 170,
    JSON.stringify(cfg.roadFill));
  check('contours default to 5 m', cfg.interval === '5' && cfg.rendered === '5');
  check('contour line is warm (R > G > B)', cfg.line.color[0] > cfg.line.color[1] && cfg.line.color[1] > cfg.line.color[2], JSON.stringify(cfg.line.color));
  check('contour line thickened but restrained (>0.7, <=1.5)', cfg.line.width > 0.7 && cfg.line.width <= 1.5, String(cfg.line.width));
  check('contourRenderer() reflects the config line', cfg.renderer.symbol.width === cfg.line.width && cfg.renderer.symbol.color[0] === cfg.line.color[0]);
  check('contour layer opacity raised for legibility', cfg.layerOpacity >= 0.9, String(cfg.layerOpacity));

  // ---- modal DOM: default interval + progress element -----------------------
  const dom = await page.evaluate(()=>{
    buildSiteMapModal();
    const checked = document.querySelector('input[name="smapInterval"]:checked');
    const prog = document.querySelector('.smap-progress');
    const note = document.querySelector('.smap-progress-note');
    return {
      checkedVal: checked ? checked.value : null,
      hasBar: !!document.querySelector('.smap-progress-bar'),
      noteText: note ? note.textContent : '',
      bottom: prog ? getComputedStyle(prog).bottom : null,
      pointerEvents: prog ? getComputedStyle(prog).pointerEvents : null,
      hiddenAtRest: prog ? prog.hidden : null
    };
  });
  check('5 m radio checked by default', dom.checkedVal === '5', 'was ' + dom.checkedVal);
  check('progress bar + "Building map…" note present', dom.hasBar && /building/i.test(dom.noteText));
  check('progress bar pinned to the bottom of the map', dom.bottom === '0px', dom.bottom);
  check('progress bar never captures pointer events (map stays interactive)', dom.pointerEvents === 'none');
  check('progress bar hidden at rest', dom.hiddenAtRest === true);

  // ---- progress lifecycle (robust polling, no fixed sleeps) ------------------
  const barWidth = ()=> page.evaluate(()=>{ const b = document.querySelector('.smap-progress-bar'); return parseFloat(b.style.width) || 0; });
  const progHidden = ()=> page.evaluate(()=> document.querySelector('.smap-progress').hidden);

  await page.evaluate(()=> mapBuildStart());
  check('start(): bar shown', await progHidden() === false && await page.evaluate(()=> document.querySelector('.smap-progress').classList.contains('smap-progress--on')));

  // A milestone floor drives the bar toward ~50%.
  await page.evaluate(()=> mapBuildFloor(0.5));
  await page.waitForFunction(()=> (parseFloat(document.querySelector('.smap-progress-bar').style.width)||0) > 35, null, { timeout: 4000 });
  const wFloor = await barWidth();
  check('floor(0.5): bar advances to its milestone', wFloor > 35 && wFloor < 65, wFloor + '%');

  // While the map is "drawing", the bar trickles up but never reaches 100%.
  await page.evaluate(()=> mapBuildSetBusy(true));
  await page.waitForFunction((prev)=> (parseFloat(document.querySelector('.smap-progress-bar').style.width)||0) > prev, wFloor, { timeout: 4000 });
  const wBusy = await barWidth();
  check('busy: trickles up but stays below 100%', wBusy > wFloor && wBusy < 100, wBusy + '%');

  // When the map settles, the bar completes and hides itself.
  await page.evaluate(()=> mapBuildSetBusy(false));
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === true, null, { timeout: 5000 });
  check('settle: bar completes and hides', await progHidden() === true);

  // A fresh start (a pan / resolution change) resets the bar to zero.
  await page.evaluate(()=> mapBuildStart());
  await page.waitForFunction(()=> document.querySelector('.smap-progress').hidden === false, null, { timeout: 2000 });
  const wRestart = await barWidth();
  check('restart resets to zero (pan / resolution change)', wRestart < 15, wRestart + '%');

  await page.evaluate(()=> mapBuildReset());
  check('reset(): bar cleared', await progHidden() === true);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

let pass = 0;
for(const r of results){ console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.extra ? ('  [' + r.extra + ']') : '')); if(r.ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed`);
if(pass === results.length){ console.log('Map visuals test: OK'); process.exit(0); }
else { console.log('Map visuals test: FAILED'); process.exit(1); }
