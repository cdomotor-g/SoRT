/*
 * Regression test for the Part B data-editing features:
 *   B1 — dragging a pin writes the new coordinate back to the originating scope
 *        row's field, offers undo, and undo restores the previous value.
 *   B4 — the relocation-distance suggestion appears when both endpoints parse and,
 *        on "use this", writes a geodesic distance into the Relocation distance
 *        field without overwriting a typed value silently (undoable).
 *
 * These edit the user's coordinates, so they get their own guard. The test drives
 * the real `finalizePinDrag` / `undoPinMove` / `renderDistanceSuggestion` code by
 * simulating the drop with a stand-in graphic — no WebGL view, no QLD services,
 * no Esri CDN, nothing stubbed on the QLD side. The central store is blocked so
 * the bundled definitions.json loads.
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

  // Seed state: current location (anchor), relocation site + relocation = Yes,
  // Distance left empty. Done straight on state, then re-render like the app does.
  await page.evaluate(()=>{
    const t = activeTable().id;
    state[t]['coords'].fields.existing = '-27.471000, 153.023400';
    state[t]['relocation'].selected = 'Yes';
    state[t]['relocation'].fields.newLocation = '-27.472000, 153.024400';
    state[t]['relocation'].fields.distance = '';
    renderRows();
    buildSiteMapModal();
    syncPinsForReopen(activeTable());
    renderSiteMapPanel();
  });

  // ---- B1: simulate a drag-drop of the anchor pin and assert write-back. ----
  const drag = await page.evaluate(()=>{
    const t = activeTable().id;
    const p = siteMap.pins.find(x => x.rowId === 'coords' && x.ok);
    const newLat = -27.480000, newLon = 153.030000;
    siteMap.dragStart = { lat: p.lat, lon: p.lon };
    const fakeGraphic = { __pin: p, geometry: { latitude: newLat, longitude: newLon } };
    finalizePinDrag(fakeGraphic);
    return {
      written: state[t]['coords'].fields.existing,
      toast: !!document.querySelector('.smap-toast-host .smap-toast'),
      hasUndoBtn: !!document.querySelector('.smap-toast-undo'),
      lastEdit: siteMap.lastPinEdit && siteMap.lastPinEdit.field
    };
  });
  check('B1: drag wrote rounded coord back to the field', drag.written === '-27.48, 153.03');
  check('B1: a toast is shown', drag.toast === true);
  check('B1: toast offers undo', drag.hasUndoBtn === true);
  check('B1: last edit recorded for undo', drag.lastEdit === 'existing');

  const afterUndo = await page.evaluate(()=>{
    undoPinMove();
    const t = activeTable().id;
    return state[t]['coords'].fields.existing;
  });
  check('B1: undo restored the original coordinate', afterUndo === '-27.471000, 153.023400');

  // ---- B4: relocation-distance suggestion appears and "use this" writes it. --
  const b4 = await page.evaluate(()=>{
    renderSiteMapPanel();
    const box = document.querySelector('.smap-distsuggest');
    const val = box && box.querySelector('.smap-distsuggest-val') ? box.querySelector('.smap-distsuggest-val').textContent : null;
    const useBtn = document.querySelector('.smap-distsuggest-use');
    const t = activeTable().id;
    const before = state[t]['relocation'].fields.distance;
    if(useBtn) useBtn.click();
    const after = state[t]['relocation'].fields.distance;
    return { hasBox: !!box, val, before, after };
  });
  check('B4: distance suggestion is shown', b4.hasBox === true);
  check('B4: suggestion shows a metric value', typeof b4.val === 'string' && /(m|km)$/.test(b4.val));
  check('B4: Distance field was empty before', b4.before === '');
  check('B4: "use this" filled the Distance field', typeof b4.after === 'string' && b4.after.length > 0 && b4.after === b4.val);

  const b4undo = await page.evaluate(()=>{
    undoPinMove();
    const t = activeTable().id;
    return state[t]['relocation'].fields.distance;
  });
  check('B4: undo cleared the suggested distance', b4undo === '');

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
console.log('Pin write-back + distance test: OK');
