/*
 * Regression test for A3 — "Stale coordinates when the modal is reopened".
 *
 * The Site Map view is kept alive between opens by design, so a coordinate the
 * user edits in the scope table while the modal is closed must still take effect
 * on the next open: the pins re-resolve from app state, and if the ANCHOR pin
 * moved, the previous manual framing is dropped so the view re-centres on the new
 * location. This test drives that real logic (`syncPinsForReopen`, `refreshPins`,
 * `resolveMapPins`, `parseCoord`) after a real DOM edit to the coordinate input.
 *
 * It is deliberately hermetic: it never opens the WebGL view and never touches the
 * QLD services or the Esri CDN — the A3 logic makes no network calls. The central
 * store is blocked so the bundled definitions.json loads (same as the verify
 * skill). Nothing here stubs a QLD service response.
 *
 * Run:
 *   npm install playwright            # in a scratch dir
 *   NODE_PATH=<that dir>/node_modules \
 *     node tests/reopen-coords.test.mjs
 *   # optional: PW_CHROMIUM=/opt/pw-browsers/chromium to pin the browser binary
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve Playwright from the repo's own node_modules if present, else from the
// PLAYWRIGHT_PKG env (absolute path to the installed `playwright` package) — ESM
// bare imports ignore NODE_PATH, so a scratch-dir install needs an explicit path.
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
const A = '-27.471000, 153.023400';   // first coordinate
const B = '-28.318301, 152.921640';   // edited-to coordinate (well away from A)

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
function check(name, cond){ results.push({ name, ok: !!cond }); }
function near(a, b, eps = 1e-5){ return Math.abs(a - b) <= eps; }

const server = await serve(REPO_ROOT);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/index.html`;

const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

try {
  const ctx = await browser.newContext();
  // Force the bundled definitions.json (keep the run hermetic).
  await ctx.route('**://*.supabase.co/**', r => r.abort());
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  // Boot done when the builder has rendered the rainfall table's rows.
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });

  // Type a coordinate into the anchor row's ("coords" → field "existing") input,
  // exactly as a user would (real 'input' event drives the state write).
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

  // ---- First open: establish the baseline pins + framing. ------------------
  await setCoord(A);
  const baseline = await page.evaluate(()=>{
    syncPinsForReopen(activeTable());          // simulates the first openSiteMap()
    const anchor = activeSitePins().find(p=>p.anchor) || activeSitePins()[0];
    return anchor ? { lat: anchor.lat, lon: anchor.lon } : null;
  });
  check('baseline anchor resolved', baseline);
  check('baseline anchor lat ≈ A', baseline && near(baseline.lat, -27.471));
  check('baseline anchor lon ≈ A', baseline && near(baseline.lon, 153.0234));

  // The user pans/zooms (manual framing) and a screenshot gets cached.
  await page.evaluate(()=>{
    siteMap.userHasAdjustedView = true;
    siteMap.screenshot = { dataUrl: 'data:image/png;base64,AAAA', valid: true, meta: {} };
  });

  // ---- Edit the coordinate in the table while the modal is "closed". -------
  await setCoord(B);

  // ---- Reopen: pins must re-resolve and the framing must reset. ------------
  const after = await page.evaluate(()=>{
    const r = syncPinsForReopen(activeTable());
    const anchor = activeSitePins().find(p=>p.anchor) || activeSitePins()[0];
    return {
      anchorChanged: r.anchorChanged,
      anyChanged: r.anyChanged,
      userHasAdjustedView: siteMap.userHasAdjustedView,
      screenshotValid: siteMap.screenshot.valid,
      lat: anchor ? anchor.lat : null,
      lon: anchor ? anchor.lon : null
    };
  });
  check('reopen: pin re-resolved to new lat (B)', after.lat != null && near(after.lat, -28.318301));
  check('reopen: pin re-resolved to new lon (B)', after.lon != null && near(after.lon, 152.92164));
  check('reopen: anchorChanged flagged true', after.anchorChanged === true);
  check('reopen: manual framing cleared (view will re-centre)', after.userHasAdjustedView === false);
  check('reopen: cached screenshot invalidated', after.screenshotValid === false);

  // ---- Reopen again with NO table change: framing must be preserved. -------
  const unchanged = await page.evaluate(()=>{
    siteMap.userHasAdjustedView = true;          // user re-frames
    const r = syncPinsForReopen(activeTable());   // reopen, nothing edited
    return { anchorChanged: r.anchorChanged, userHasAdjustedView: siteMap.userHasAdjustedView };
  });
  check('no-change reopen: anchorChanged false', unchanged.anchorChanged === false);
  check('no-change reopen: manual framing preserved', unchanged.userHasAdjustedView === true);

} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('A3 regression test: OK');
