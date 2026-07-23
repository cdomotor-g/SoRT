/*
 * Regression test for the invisible road reserve: resolveRoadWhere() must
 * validate candidate DCDB fields against parcels NEAR THE SITE, not state-wide.
 *
 * The defect: `UPPER(tenure) LIKE '%ROAD%'` matched 202 parcels somewhere in
 * Queensland, so the old first-nonzero-state-wide logic accepted it — and the
 * road layer "applied" cleanly while drawing nothing at the site (none of those
 * 202 parcels were anywhere near it). The fix scopes candidate counts to a
 * ~2 km envelope around the anchor pin, and only falls back to state-wide
 * counts (taking the LARGEST match, not the first non-zero) when nothing
 * matches locally.
 *
 * This test drives the real `resolveRoadWhere` / `siteEnvelope` code in the
 * page, with the QLD cadastre service stubbed at the network layer (Playwright
 * route interception) — the only stub is the external ArcGIS REST endpoint,
 * which is unreachable from CI anyway. Three scenarios:
 *
 *   A — real world: parcel_typ matches locally, tenure only state-wide
 *       → parcel_typ wins with the LOCAL count reported.
 *   B — local beats candidate order: the first candidate has no local parcels
 *       but a later one does → the later one wins.
 *   C — nothing local: fall back to the LARGEST state-wide count (not the
 *       first non-zero), and the diagnostics say nothing matched near the site.
 *
 * Run: see tests/README.md (same invocation as reopen-coords.test.mjs).
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
function check(name, cond){ results.push({ name, ok: !!cond }); }

// The anchor coordinate the test types into the table (Running Creek, the site
// from the reported diagnostics).
const SITE = { lat: -28.318253, lon: 152.921599 };

// Per-scenario stub counts, keyed by upper-cased field name. Fields absent from
// a table count 0. `local` answers geometry-scoped queries; `wide` state-wide.
const STUB = {
  A: { local: { PARCEL_TYP: 12, TENURE: 0 }, wide: { PARCEL_TYP: 400000, TENURE: 202 } },
  B: { local: { PARCEL_TYP: 0,  TENURE: 7 }, wide: { PARCEL_TYP: 400000, TENURE: 202 } },
  C: { local: {},                            wide: { PARCEL_TYP: 5,      TENURE: 500000 } }
};
let mode = 'A';
let lastEnvelope = null;   // the geometry the page sent with a scoped query

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

  // Stub the QLD cadastre service: schema + count queries. Everything else on
  // the QLD hosts is aborted — this test exercises only the road-filter logic.
  await ctx.route(/spatial-gis\.information\.qld\.gov\.au/, route=>{
    const url = new URL(route.request().url());
    const json = obj => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(obj) });
    if(/LandParcelPropertyFramework\/MapServer\/4$/.test(url.pathname)){
      return json({ id:4, name:'Cadastral parcels', minScale:1000000, maxScale:0, fields: [
        { name:'OBJECTID',   type:'esriFieldTypeOID' },
        { name:'LOTPLAN',    type:'esriFieldTypeString' },
        { name:'PARCEL_TYP', type:'esriFieldTypeString' },
        { name:'TENURE',     type:'esriFieldTypeString' },
        { name:'FEAT_NAME',  type:'esriFieldTypeString' }
      ]});
    }
    if(/MapServer\/4\/query$/.test(url.pathname)){
      const m = (url.searchParams.get('where') || '').match(/UPPER\((\w+)\)/i);
      const field = m ? m[1].toUpperCase() : '';
      const scoped = url.searchParams.has('geometry');
      if(scoped){ try{ lastEnvelope = JSON.parse(url.searchParams.get('geometry')); }catch(_){} }
      const table = scoped ? STUB[mode].local : STUB[mode].wide;
      return json({ count: table[field] || 0 });
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });

  // Give the map an anchor pin, exactly as a user would (real 'input' event).
  await page.evaluate((coord)=>{
    const prev = document.querySelector('#rowsContainer [data-preview-for="coords"]');
    const card = prev && prev.closest('.row');
    const input = card && card.querySelector('input[type="text"], textarea');
    if(!input) throw new Error('anchor coordinate input not found');
    input.value = coord;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    syncPinsForReopen(activeTable());
  }, `${SITE.lat}, ${SITE.lon}`);

  const resolve = () => page.evaluate(async ()=>{
    const r = await resolveRoadWhere();
    return { r, resolved: siteMap.diag && siteMap.diag.cadastre.resolved };
  });

  // ---- A: the real-world shape of the defect. ------------------------------
  mode = 'A'; lastEnvelope = null;
  const a = await resolve();
  check('A: resolves the field with road parcels near the site', a.r && a.r.field === 'PARCEL_TYP');
  check('A: reports the site-local count, not the state-wide one', a.r && a.r.count === 12);
  check('A: diagnostics say the match is near the site', /within ~2 km/.test(a.resolved || ''));
  check('A: scoped query carried an envelope around the anchor',
    lastEnvelope &&
    lastEnvelope.xmin < SITE.lon && SITE.lon < lastEnvelope.xmax &&
    lastEnvelope.ymin < SITE.lat && SITE.lat < lastEnvelope.ymax);

  // ---- B: a later candidate with local parcels beats an earlier one without.
  mode = 'B';
  const b = await resolve();
  check('B: local presence outranks candidate order', b.r && b.r.field === 'TENURE' && b.r.count === 7);

  // ---- C: nothing local → largest state-wide count, flagged as not-local. --
  mode = 'C';
  const c = await resolve();
  check('C: falls back to the LARGEST state-wide count, not the first non-zero', c.r && c.r.field === 'TENURE' && c.r.count === 500000);
  check('C: diagnostics flag that nothing matched near the site', /none within/.test(c.resolved || ''));

} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('Road-filter regression test: OK');
