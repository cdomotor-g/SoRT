/*
 * Regression test for two Site Map additions, both resolved against the LIVE QLD
 * service schema at runtime (so, like road-filter.test.mjs, the only stub is the
 * external ArcGIS REST endpoint — unreachable from CI anyway; the page code runs
 * unmodified):
 *
 *   C1 — rail lines. resolveRailLayers() reads the Transportation/OtherTransport
 *        layer list and keeps only the RAILWAY sublayers (heavy rail, sidings,
 *        sugar-cane, tourist…), never the aviation / port sublayers that share the
 *        same service, and never the group layers. Falls back to the metadata ids
 *        if the probe can't run.
 *
 *   A7 — road-parcel parity with QLD Globe. resolveRoadSource() prefers the
 *        cadastre's OWN dedicated ROAD polygon sublayer (drawn whole — the same
 *        selection QLD Globe's "Road parcel" layer shows), validated site-locally,
 *        and only falls back to the previous parcel + LIKE '%ROAD%' heuristic when
 *        no such sublayer exists — so it can only ever match QLD Globe better.
 *
 * Run: see tests/README.md (same invocation as road-filter.test.mjs).
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
    const file = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
    if(!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', ()=> resolve(server)));
}

const results = [];
const check = (name, cond) => results.push({ name, ok: !!cond });

const SITE = { lat: -18.029481, lon: 145.923906 };   // the Mulgrave River / North Coast Line site from the brief

// The OtherTransport tree: railway leaves + aviation/port leaves + a group layer,
// mirroring the real service (railways AND aviation in one MapServer).
const RAIL_LAYERS = [
  { id: 1,   name: 'Railway',              type:'Group Layer', subLayerIds:[155,156,157,158] },
  { id: 155, name: 'Light Rail',           geometryType:'esriGeometryPolyline' },
  { id: 156, name: 'Railway',              geometryType:'esriGeometryPolyline' },
  { id: 157, name: 'Sugar Cane Railway',   geometryType:'esriGeometryPolyline' },
  { id: 158, name: 'Railway Siding',       geometryType:'esriGeometryPolyline' },
  { id: 200, name: 'Aviation',             type:'Group Layer', subLayerIds:[201,202] },
  { id: 201, name: 'Airport',              geometryType:'esriGeometryPolygon' },
  { id: 202, name: 'Airport Runway',       geometryType:'esriGeometryPolyline' },
  { id: 300, name: 'Port',                 geometryType:'esriGeometryPoint' },
  { id: 100, name: 'Public Transport Stops', geometryType:'esriGeometryPoint' }
];

// Road-source scenarios. R1: a dedicated "Road" polygon sublayer exists (id 8).
// R2: no dedicated road sublayer → fall back to the parcel-filter heuristic on 4.
let roadMode = 'R1';
const CADASTRE_LAYERS = {
  R1: [
    { id: 4, name: 'Cadastral parcels', geometryType:'esriGeometryPolygon' },
    { id: 8, name: 'Road',              geometryType:'esriGeometryPolygon' },
    { id: 9, name: 'Road labels',       geometryType:'esriGeometryPolygon' }   // must be EXCLUDED (label)
  ],
  R2: [
    { id: 4, name: 'Cadastral parcels', geometryType:'esriGeometryPolygon' }
  ]
};

const server = await serve(REPO_ROOT);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/index.html`;

const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

try {
  const ctx = await browser.newContext();
  await ctx.route('**://*.supabase.co/**', r => r.abort());

  await ctx.route(/spatial-gis\.information\.qld\.gov\.au/, route=>{
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = obj => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(obj) });

    // OtherTransport service root → layer list (rail resolution).
    if(/Transportation\/OtherTransport\/MapServer$/.test(p)) return json({ layers: RAIL_LAYERS });

    // Cadastre service root → layer list (road-source tier 1).
    if(/LandParcelPropertyFramework\/MapServer$/.test(p)) return json({ layers: CADASTRE_LAYERS[roadMode] });

    // Cadastre sublayer 4 schema (fields) → parcel-filter fallback (tier 2).
    if(/LandParcelPropertyFramework\/MapServer\/4$/.test(p)){
      return json({ id:4, name:'Cadastral parcels', minScale:1000000, maxScale:0, fields:[
        { name:'OBJECTID',   type:'esriFieldTypeOID' },
        { name:'PARCEL_TYP', type:'esriFieldTypeString' },
        { name:'TENURE',     type:'esriFieldTypeString' }
      ]});
    }

    // Count queries. Dedicated road sublayer 8 has parcels near the site; the
    // parcel filter on 4 matches PARCEL_TYP locally.
    const q = p.match(/MapServer\/(\d+)\/query$/);
    if(q){
      const sub = q[1];
      const scoped = url.searchParams.has('geometry');
      if(sub === '8') return json({ count: 6 });                 // dedicated road sublayer: real parcels here
      if(sub === '4'){
        const m = (url.searchParams.get('where') || '').match(/UPPER\((\w+)\)/i);
        const field = m ? m[1].toUpperCase() : '';
        return json({ count: (scoped && field === 'PARCEL_TYP') ? 9 : (field === 'PARCEL_TYP' ? 500000 : 0) });
      }
      return json({ count: 0 });
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });

  // Anchor the map on the site, exactly as a user would.
  await page.evaluate((coord)=>{
    const prev = document.querySelector('#rowsContainer [data-preview-for="coords"]');
    const card = prev && prev.closest('.row');
    const input = card && card.querySelector('input[type="text"], textarea');
    if(!input) throw new Error('anchor coordinate input not found');
    input.value = coord;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    syncPinsForReopen(activeTable());
  }, `${SITE.lat}, ${SITE.lon}`);

  // ---- C1: rail sublayer resolution. --------------------------------------
  const rail = await page.evaluate(async ()=>{ siteMap.railIds = null; return await resolveRailLayers(); });
  check('C1: keeps the four railway sublayers', JSON.stringify(rail) === JSON.stringify([155,156,157,158]));
  check('C1: excludes aviation, port and public-transport sublayers', !rail.includes(201) && !rail.includes(202) && !rail.includes(300) && !rail.includes(100));
  check('C1: excludes the "Railway" group layer (leaves only)', !rail.includes(1) && !rail.includes(200));

  // ---- A7 / R1: prefer the dedicated ROAD polygon sublayer, drawn whole. ---
  roadMode = 'R1';
  const r1 = await page.evaluate(async ()=>{
    const r = await resolveRoadSource();
    return { r, resolved: siteMap.diag && siteMap.diag.cadastre.resolved };
  });
  check('A7: uses the dedicated Road sublayer, not the parcel filter', r1.r && r1.r.sublayer === 8);
  check('A7: draws it whole (no LIKE filter)', r1.r && r1.r.where === '1=1');
  check('A7: never picks the "Road labels" sublayer', r1.r && r1.r.sublayer !== 9);
  check('A7: diagnostics name the dedicated road sublayer', /dedicated .*road sublayer \(id 8/i.test(r1.resolved || ''));

  // ---- A7 / R2: no dedicated sublayer → fall back to the parcel filter. -----
  roadMode = 'R2';
  const r2 = await page.evaluate(async ()=> await resolveRoadSource());
  check('A7: falls back to parcel sublayer 4 when no road sublayer exists', r2 && r2.sublayer === 4);
  check('A7: fallback keeps the UPPER(field) LIKE %ROAD% heuristic', r2 && /UPPER\(PARCEL_TYP\) LIKE '%ROAD%'/.test(r2.where));

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
console.log('Rail + road-source resolution test: OK');
