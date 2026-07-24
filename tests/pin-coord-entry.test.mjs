/*
 * Regression test for §C2 — editing a pin's coordinate from a TEXT ENTRY FIELD in
 * the Site Map panel (the counterpart to the B1 drag): typing a coordinate and
 * committing it writes the canonical value back to the originating scope row's
 * field, offers undo, re-frames, and — crucially — validates through the SAME
 * parseCoord path as every other coordinate, so a bad value is refused with an
 * inline message (and a swap hint when the pair looks reversed) and NOTHING is
 * written. Also covers every pin being editable (invalid pins included) and the
 * "clear = remove the pin" path.
 *
 * Like pin-writeback.test.mjs this is fully hermetic: no WebGL view, no QLD
 * services, no Esri CDN, nothing stubbed on the QLD side. The central store is
 * blocked so the bundled definitions.json loads. Same invocation as the others
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

  // Seed state: current location (anchor), and one deliberately INVALID coordinate
  // on the relocation row so we can prove an invalid pin is still editable.
  await page.evaluate(()=>{
    const t = activeTable().id;
    state[t]['coords'].fields.existing = '-27.471000, 153.023400';
    state[t]['relocation'].selected = 'Yes';
    state[t]['relocation'].fields.newLocation = 'not a coordinate';
    renderRows();
    buildSiteMapModal();
    syncPinsForReopen(activeTable());
    renderSiteMapPanel();
  });

  // ---- The panel renders an editable text field for EVERY pin. ----
  const ui = await page.evaluate(()=>{
    const rows = [...document.querySelectorAll('.smap-pin')];
    const coordsRow = document.querySelector('.smap-pin[data-pin-key="coords"]');
    const relocRow  = document.querySelector('.smap-pin[data-pin-key="relocation"]');
    return {
      pinCount: rows.length,
      everyRowHasInput: rows.every(r => !!r.querySelector('.smap-pin-input')),
      everyRowHasSet:   rows.every(r => !!r.querySelector('.smap-pin-apply')),
      coordsInputVal: coordsRow && coordsRow.querySelector('.smap-pin-input').value,
      relocInputVal:  relocRow  && relocRow.querySelector('.smap-pin-input').value,
      relocIsInvalid: !!(relocRow && relocRow.classList.contains('smap-pin--invalid')),
    };
  });
  check('C2: every pin row has a coordinate text field', ui.everyRowHasInput === true && ui.pinCount >= 2);
  check('C2: every pin row has a Set button', ui.everyRowHasSet === true);
  check('C2: valid pin field prefilled with the canonical value', ui.coordsInputVal === '-27.4710, 153.0234' || ui.coordsInputVal === '-27.471, 153.0234');
  check('C2: invalid pin is editable, prefilled with the raw text', ui.relocInputVal === 'not a coordinate' && ui.relocIsInvalid === true);

  // ---- Type a new coordinate into the field + press Enter → write-back. ----
  const typed = await page.evaluate(async ()=>{
    const input = document.querySelector('.smap-pin[data-pin-key="coords"] .smap-pin-input');
    input.focus();
    input.value = '-27.5000, 153.1000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    const t = activeTable().id;
    return {
      written: state[t]['coords'].fields.existing,
      toast: !!document.querySelector('.smap-toast-host .smap-toast'),
      hasUndoBtn: !!document.querySelector('.smap-toast-undo'),
      lastEdit: siteMap.lastPinEdit && siteMap.lastPinEdit.field,
    };
  });
  check('C2: Enter wrote the canonical coord back to the field', typed.written === '-27.5, 153.1');
  check('C2: a toast with undo is shown', typed.toast === true && typed.hasUndoBtn === true);
  check('C2: last edit recorded for undo', typed.lastEdit === 'existing');

  const afterUndo = await page.evaluate(()=>{ undoPinMove(); return state[activeTable().id]['coords'].fields.existing; });
  check('C2: undo restored the original coordinate', afterUndo === '-27.471000, 153.023400');

  // ---- The Set button commits too (DMS accepted via the shared parseCoord). ----
  const dms = await page.evaluate(()=>{
    renderSiteMapPanel();
    const row = document.querySelector('.smap-pin[data-pin-key="coords"]');
    const input = row.querySelector('.smap-pin-input');
    input.value = `27°28'15.6"S 153°01'24.2"E`;
    row.querySelector('.smap-pin-apply').click();
    const v = state[activeTable().id]['coords'].fields.existing;
    // Canonical decimal-degree string, negative lat, ~153 lon.
    return { v, ok: /^-27\.\d+, 153\.\d+$/.test(v) };
  });
  check('C2: Set button commits, DMS parsed to decimal degrees', dms.ok === true);
  await page.evaluate(()=>{ undoPinMove(); renderSiteMapPanel(); });

  // ---- An INVALID entry is refused: inline message, nothing written. ----
  const bad = await page.evaluate(()=>{
    const before = state[activeTable().id]['coords'].fields.existing;
    const row = document.querySelector('.smap-pin[data-pin-key="coords"]');
    const input = row.querySelector('.smap-pin-input');
    input.value = 'banana';
    row.querySelector('.smap-pin-apply').click();
    const msg = row.querySelector('.smap-pin-msg');
    return {
      unchanged: state[activeTable().id]['coords'].fields.existing === before,
      msgShown: !!(msg && msg.textContent && msg.className.includes('smap-pin-msg--err')),
      inputKept: input.value === 'banana',   // the user's text is preserved for them to fix
    };
  });
  check('C2: invalid entry did not write to the field', bad.unchanged === true);
  check('C2: invalid entry shows an inline error message', bad.msgShown === true);
  check('C2: invalid entry preserves the typed text to correct', bad.inputKept === true);

  // ---- A swapped pair is refused WITH a swap hint (QLD lon,lat order). ----
  const swap = await page.evaluate(()=>{
    renderSiteMapPanel();
    const row = document.querySelector('.smap-pin[data-pin-key="coords"]');
    const input = row.querySelector('.smap-pin-input');
    input.value = '153.0234, -27.4710';   // lon,lat — reversed for a QLD site
    row.querySelector('.smap-pin-apply').click();
    const msg = row.querySelector('.smap-pin-msg');
    return { text: msg ? msg.textContent : '' };
  });
  check('C2: swapped pair is caught with a "Did you mean" hint', /did you mean/i.test(swap.text));

  // ---- Clearing the field removes the pin (undoably). ----
  const cleared = await page.evaluate(()=>{
    renderSiteMapPanel();
    const row = document.querySelector('.smap-pin[data-pin-key="coords"]');
    const input = row.querySelector('.smap-pin-input');
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    const t = activeTable().id;
    const stillPin = !!siteMap.pins.find(p => p.rowId === 'coords' && p.ok);
    return { field: state[t]['coords'].fields.existing, stillPin };
  });
  check('C2: clearing the field cleared the stored coordinate', cleared.field === '');
  check('C2: clearing removed the pin', cleared.stillPin === false);
  const restore = await page.evaluate(()=>{ undoPinMove(); return state[activeTable().id]['coords'].fields.existing; });
  check('C2: undo restored a cleared coordinate', restore === '-27.471000, 153.023400');

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
console.log('Pin coordinate text-entry test: OK');
