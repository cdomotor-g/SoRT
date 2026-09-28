/*
 * Regression test for "every location in the Site Map side panel, entered or not".
 *
 * Users skip the scope form and expect to make the FIRST coordinate entry in the
 * Site Map. The side panel used to list only locations that already had a value,
 * so on a fresh table there was nothing to type into. Now every location the
 * active table (station type) declares a mapPin for is listed — and only those,
 * so a rain-only station never offers a river-line / orifice location — and a
 * value entered there is written back into the scope form.
 *
 * Drives the real openSiteMap / resolveMapPins / refreshPins / renderSiteMapPanel /
 * commitPinCoordEntry / writePinCoord code with real keyboard and mouse input,
 * against a stand-in view (no WebGL, no Esri CDN, no QLD services). GitHub is
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
  // Hermetic: the published definitions, the Esri CDN and every QLD host are out.
  await ctx.route(/api\.github\.com|raw\.githubusercontent\.com|arcgis\.com|qld\.gov\.au/, r => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);           // a missing panel entry should fail fast, not hang
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer [data-preview-for="coords"]', { timeout: 15000 });

  // A stand-in for the live map: records the pins drawn into it and every goTo,
  // and reports any framing as landed. Everything else is the real page code.
  await page.evaluate(()=>{
    window.__graphics = [];
    window.__goTos = [];
    siteMap.esri = {
      reactiveUtils: { whenOnce: ()=> Promise.resolve(true), watch: ()=> ({ remove(){} }) },
      Graphic: function(o){ Object.assign(this, o); }
    };
    siteMap.view = {
      ready:true, width:800, height:450, stationary:true, scale:5000, suspended:false,
      graphics: {
        removeAll(){ window.__graphics.length = 0; },
        add(g){ window.__graphics.push(g); },
        toArray(){ return window.__graphics.slice(); }
      },
      goTo(t){ window.__goTos.push(t); return Promise.resolve(); },
      toScreen(){ return { x:400, y:225 }; }
    };
    window.loadEsri = async ()=> siteMap.esri;
    window.mapBuildTrackRedraw = ()=>{};
    window.scheduleAutoCapture = ()=>{};    // no background picture-making in this test

    // Read back what the user would see in the scope form (and Property Services).
    window.__formField = (rowId, label)=>{
      const card = document.querySelector('#rowsContainer [data-preview-for="' + rowId + '"]').closest('.row');
      const f = [...card.querySelectorAll('.field')].find(x => !label || x.querySelector('label').textContent === label);
      return f ? f.querySelector('input, textarea').value : null;
    };
    window.__psCoord = (groupIndex, label)=>{
      const g = document.querySelectorAll('#psContainer .ps-coordgroup')[groupIndex];
      const r = g && [...g.querySelectorAll('.ps-coord-row')].find(x => x.querySelector('.ps-coord-label').textContent === label);
      return r ? r.querySelector('input').value : null;
    };
    window.__filled = ()=> Number((document.getElementById('progressText').textContent.match(/^(\d+)/) || [])[1]);
    window.__panel = ()=>{
      const rows = [...document.querySelectorAll('.smap-pin-list .smap-pin')];
      const a = document.activeElement;
      const aRow = a && a.closest && a.closest('.smap-pin');
      return {
        keys: rows.map(r => r.dataset.pinKey),
        empty: rows.map(r => r.classList.contains('smap-pin--empty')),
        values: rows.map(r => r.querySelector('.smap-pin-input').value),
        boxes: rows.map(r => { const c = r.querySelector('input[type=checkbox]'); return { checked: c.checked, disabled: c.disabled }; }),
        msgs: rows.map(r => r.querySelector('.smap-pin-msg').textContent),
        intro: (document.querySelector('.smap-pin-list > .smap-empty') || {}).textContent || '',
        focusKey: aRow ? aRow.dataset.pinKey : null,
        focusRole: (a && a.dataset && a.dataset.role) || null,
        focusIsClose: !!(a && a.classList && a.classList.contains('smap-close')),
        drawn: window.__graphics.length,
        toast: (document.querySelector('.smap-toast-host .smap-toast-msg') || {}).textContent || ''
      };
    };
  });

  const openOn = (tableId)=> page.evaluate(async (id)=>{
    if(activeTableId !== id){ activeTableId = id; renderBuilder(); }
    await openSiteMap(document.getElementById('siteMapBtn'));
    return window.__panel();
  }, tableId);
  const closeMap = ()=> page.evaluate(()=> closeSiteMap());

  // ---- 1. Which locations each station type offers ---------------------------
  const lists = await page.evaluate(()=>{
    const out = {};
    defs.tables.forEach(t => { out[t.id] = resolveMapPins(t).map(p => p.key + (p.empty ? '' : '*')); });
    return out;
  });
  check('rain-only station: current location + relocation site, nothing else',
        JSON.stringify(lists.rainfall) === '["coords","relocation"]');
  check('water level: adds the river-line termination and its relocation',
        JSON.stringify(lists.waterlevel) === '["coords","relocation","riverCoords","riverRelocation"]');
  check('DLGWV water level: the same four locations',
        JSON.stringify(lists['waterlevel-dlgwv']) === '["coords","relocation","riverCoords","riverRelocation"]');
  check('repeater / gateway: adds the TBRG location, no river line',
        JSON.stringify(lists.repeater) === '["coords","relocation","row"]');

  // ---- 2. Open the map on a fresh rainfall table: everything is listed ---------
  const fresh = await openOn('rainfall');
  check('fresh table: both locations are listed before anything is entered', JSON.stringify(fresh.keys) === '["coords","relocation"]');
  check('fresh table: no river-line / orifice entry on a rain-only station', !fresh.keys.includes('riverCoords') && !fresh.keys.includes('riverRelocation'));
  check('fresh table: every entry is an empty, typeable field', fresh.empty.every(Boolean) && fresh.values.every(v => v === ''));
  check('fresh table: tick boxes are off and disabled until a coordinate exists', fresh.boxes.every(b => !b.checked && b.disabled));
  check('fresh table: each empty entry names the table row it fills',
        /“Instrumentation Coordinates”/.test(fresh.msgs[0]) && /“Relocation › New Location \(coordinates\)”/.test(fresh.msgs[1]));
  check('fresh table: the panel says entries made here go into the table', /filled in on the scope table/.test(fresh.intro));
  check('fresh table: nothing is drawn on the map', fresh.drawn === 0);
  check('fresh table: the cursor starts in the first location', fresh.focusKey === 'coords' && fresh.focusRole === 'coord');
  check('the panel heading says Locations', await page.evaluate(()=> document.querySelector('.smap-panel .smap-panel-head').textContent === 'Locations'));

  // ---- 3. The first entry, typed in the map — back into the form ---------------
  const filledBefore = await page.evaluate(()=> window.__filled());
  await page.keyboard.type('-27.5, 153.1');
  await page.keyboard.press('Enter');
  const first = await page.evaluate(()=>{
    const pin = siteMap.pins.find(p => p.key === 'coords');
    const last = window.__goTos[window.__goTos.length - 1];
    return {
      ...window.__panel(),
      stored: state.rainfall.coords.fields.existing,
      form: window.__formField('coords'),
      preview: document.querySelector('#rowsContainer [data-preview-for="coords"]').textContent,
      filled: window.__filled(),
      ps: window.__psCoord(0, 'Primary (main equipment)'),
      on: !!(pin && pin.on), ok: !!(pin && pin.ok),
      framedLat: last && last.target && last.target.latitude
    };
  });
  check('first entry: written to the scope row, canonical', first.stored === '-27.5, 153.1');
  check('first entry: the form field shows it', first.form === '-27.5, 153.1');
  check('first entry: the row preview shows it', /Existing: -27\.5, 153\.1/.test(first.preview));
  check('first entry: the progress count goes up', first.filled === filledBefore + 1);
  check('first entry: Property Services mirrors it', first.ps === '-27.5, 153.1');
  check('first entry: the pin is shown (not left switched off)', first.on === true && first.ok === true && first.drawn === 1);
  check('first entry: its tick box is live and ticked', first.boxes[0].checked && !first.boxes[0].disabled && !first.empty[0]);
  check('first entry: the map frames the new pin', first.framedLat === -27.5);
  check('first entry: the toast says it was added to the table', /added/.test(first.toast) && /Instrumentation Coordinates/.test(first.toast));
  check('first entry: the "nothing entered" note goes away', first.intro === '');
  check('first entry: the cursor stays in the field', first.focusKey === 'coords' && first.focusRole === 'coord');

  // ---- 4. On to the next location with ONE click --------------------------------
  // Committing rebuilds the list, which used to swallow the click on the next field.
  await page.fill('.smap-pin[data-pin-key="coords"] .smap-pin-input', '-27.471, 153.0234');
  await page.click('.smap-pin[data-pin-key="relocation"] .smap-pin-input');
  const moved = await page.evaluate(()=> ({ ...window.__panel(), stored: state.rainfall.coords.fields.existing }));
  check('click away: the edited location was committed', moved.stored === '-27.471, 153.0234');
  check('click away: the focus lands in the field that was clicked', moved.focusKey === 'relocation' && moved.focusRole === 'coord');
  await page.keyboard.type('-27.48, 153.03');
  await page.keyboard.press('Tab');
  const second = await page.evaluate(()=> ({
    ...window.__panel(),
    stored: state.rainfall.relocation.fields.newLocation,
    form: window.__formField('relocation', 'New Location (coordinates)'),
    ps: window.__psCoord(1, 'Primary (main equipment)'),
    suggest: !!document.querySelector('.smap-distsuggest')
  }));
  check('second entry: typed straight after the click, and committed by Tab', second.stored === '-27.48, 153.03');
  check('second entry: the Relocation row in the form shows it', second.form === '-27.48, 153.03');
  check('second entry: Property Services relocation coordinates mirror it', second.ps === '-27.48, 153.03');
  check('second entry: both pins are on the map', second.drawn === 2);
  check('Tab: the focus moves on to the Set button, not off the page', second.focusKey === 'relocation' && second.focusRole === 'apply');
  check('both entered: the relocation-distance suggestion appears', second.suggest);

  // ---- 5. Text still being typed survives a rebuild of the list -----------------
  // (e.g. the first zoom of the map re-renders the panel). A complete coordinate
  // is used on purpose: removing the focused field fires its blur, and that must
  // not commit what the user has not finished with.
  const typing = await page.evaluate(()=>{
    const input = document.querySelector('.smap-pin[data-pin-key="coords"] .smap-pin-input');
    input.focus();
    input.value = '-27.49, 153.04';
    input.dispatchEvent(new Event('input', { bubbles:true }));
    renderSiteMapPanel();
    const again = document.querySelector('.smap-pin[data-pin-key="coords"] .smap-pin-input');
    const out = { value: again.value, focused: document.activeElement === again, caret: again.selectionStart,
                  stored: state.rainfall.coords.fields.existing, toast: (document.querySelector('.smap-toast-msg') || {}).textContent || '' };
    again.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));   // abandon it
    return { ...out, afterEscape: state.rainfall.coords.fields.existing };
  });
  check('rebuild mid-typing: the typed text is kept', typing.value === '-27.49, 153.04' && typing.caret === 14);
  check('rebuild mid-typing: the field keeps the focus', typing.focused);
  check('rebuild mid-typing: nothing is written until it is committed', typing.stored === '-27.471, 153.0234' && !/153\.04/.test(typing.toast));
  check('Escape abandons the typed text', typing.afterEscape === '-27.471, 153.0234');
  await page.waitForTimeout(50);

  // ---- 6. Passing through a field doesn't rewrite the table ---------------------
  const passThrough = await page.evaluate(()=>{
    state.rainfall.coords.fields.existing = '-27.471000, 153.023400';   // typed in the form, more decimals
    renderRows(); syncPinsForReopen(activeTable()); renderSiteMapPanel();
    document.querySelector('.smap-toast-host').innerHTML = '';
    const goTos = window.__goTos.length;
    const input = document.querySelector('.smap-pin[data-pin-key="coords"] .smap-pin-input');
    input.focus(); input.blur();                                           // tab through it
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    return { stored: state.rainfall.coords.fields.existing, toast: !!document.querySelector('.smap-toast-host .smap-toast'), reframed: window.__goTos.length !== goTos };
  });
  check('pass-through: the stored text is left exactly as typed in the form', passThrough.stored === '-27.471000, 153.023400');
  check('pass-through: no toast and no re-frame', !passThrough.toast && !passThrough.reframed);

  // ---- 7. The relocation gate still applies ------------------------------------
  const gated = await page.evaluate(()=>{
    state.rainfall.relocation.selected = 'No';
    renderRows(); syncPinsForReopen(activeTable()); renderSiteMapPanel();
    const whenNo = window.__panel().keys;
    state.rainfall.relocation.selected = null;
    renderRows(); syncPinsForReopen(activeTable()); renderSiteMapPanel();
    return { whenNo, unanswered: window.__panel().keys };
  });
  check('relocation "No": no relocation entry offered', JSON.stringify(gated.whenNo) === '["coords"]');
  check('relocation unanswered: the relocation entry is offered', JSON.stringify(gated.unanswered) === '["coords","relocation"]');

  // ---- 8. Re-opening with locations entered starts on the close button as before
  await closeMap();
  const reopened = await openOn('rainfall');
  check('re-open with pins: focus starts on the close button, as before', reopened.focusIsClose && !reopened.intro);
  await closeMap();

  // ---- 9. A water-level station: its river-line locations fill its own rows -----
  const wl = await openOn('waterlevel');
  check('water level: all four locations listed, all empty', JSON.stringify(wl.keys) === '["coords","relocation","riverCoords","riverRelocation"]' && wl.empty.every(Boolean));
  check('water level: the rainfall table\'s pins are not carried over', wl.drawn === 0);
  await page.click('.smap-pin[data-pin-key="riverCoords"] .smap-pin-input');
  await page.keyboard.type('-27.4705, 153.0241');
  await page.keyboard.press('Enter');
  const river = await page.evaluate(()=> ({
    ...window.__panel(),
    stored: state.waterlevel.riverCoords.fields.detail,
    form: window.__formField('riverCoords'),
    ps: window.__psCoord(0, 'Subsidiary (orifice line)'),
    rainfallUntouched: !state.rainfall.riverCoords
  }));
  check('river line: written to the water-level table\'s own row', river.stored === '-27.4705, 153.0241');
  check('river line: the form field shows it', river.form === '-27.4705, 153.0241');
  check('river line: Property Services "Subsidiary (orifice line)" mirrors it', river.ps === '-27.4705, 153.0241');
  check('river line: only that pin is drawn', river.drawn === 1);
  check('river line: nothing written to the rain-only table', river.rainfallUntouched);

  // ---- 10. Undo takes a first entry back to "not entered" -----------------------
  const undone = await page.evaluate(()=>{
    undoPinMove();
    return { ...window.__panel(), stored: state.waterlevel.riverCoords.fields.detail, form: window.__formField('riverCoords') };
  });
  check('undo: the stored value is cleared again', undone.stored === '' || undone.stored === undefined);
  check('undo: the form field is empty again', undone.form === '');
  check('undo: the location is listed as not entered', undone.empty[undone.keys.indexOf('riverCoords')] === true && undone.drawn === 0);
  await closeMap();

  // ---- 11. A bad value fixed on the map shows its pin ---------------------------
  const fixedBad = await page.evaluate(async ()=>{
    activeTableId = 'repeater'; renderBuilder();
    state.repeater.row.fields.tbrg = 'somewhere near the gate';
    await openSiteMap(document.getElementById('siteMapBtn'));
    const before = window.__panel();
    const input = document.querySelector('.smap-pin[data-pin-key="row"] .smap-pin-input');
    input.value = '-19.2590, 146.8169';
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    const pin = siteMap.pins.find(p => p.key === 'row');
    return { before, on: !!(pin && pin.on), ok: !!(pin && pin.ok), drawn: window.__graphics.length, stored: state.repeater.row.fields.tbrg };
  });
  check('repeater: TBRG listed with the unreadable value to correct', fixedBad.before.keys.includes('row') && /somewhere near the gate/.test(fixedBad.before.values.join('|')));
  check('repeater: an unreadable value is an error, not "not entered"', /Enter latitude and longitude/.test(fixedBad.before.msgs[fixedBad.before.keys.indexOf('row')]));
  check('fixed on the map: the corrected pin is shown', fixedBad.on === true && fixedBad.ok === true && fixedBad.drawn === 1 && fixedBad.stored === '-19.259, 146.8169');

  // ---- 12. The Word copy carries a location entered only on the map -------------
  const copied = await page.evaluate(()=>{
    activeTableId = 'rainfall'; renderBuilder();
    return { html: buildHtmlTable(), ps: buildPropertyServicesHtml(activeTable()) };
  });
  check('copy: the scope table carries the location entered on the map', /Existing: -27\.471000, 153\.023400/.test(copied.html) && /New Location \(coordinates\): -27\.48, 153\.03/.test(copied.html));
  check('copy: the Property Services table carries it too', /-27\.48, 153\.03/.test(copied.ps));

  // ---- 13. Diagnostics and the no-locations message ------------------------------
  const misc = await page.evaluate(()=>{
    syncPinsForReopen(activeTable());
    const diag = diagnosticsText();
    const saved = siteMap.pins;
    siteMap.pins = [];
    renderSiteMapPanel();
    const none = (document.querySelector('.smap-pin-list > .smap-empty') || {}).textContent || '';
    siteMap.pins = saved; renderSiteMapPanel();
    return { diag, none };
  });
  check('diagnostics: count the locations, placed and not entered', /Locations: +2 for this table — 2 placed, 0 unreadable, 0 not entered yet/.test(misc.diag));
  check('no location rows: the panel says so', /no locations/i.test(misc.none));

  check('no uncaught page errors', pageErrors.length === 0);
  if(pageErrors.length) console.log('page errors:', pageErrors.slice(0,3));

} catch(err) {
  // Report what ran before the failure rather than a bare stack trace.
  check('the test ran to the end (stopped at: ' + String(err && err.message || err).split('\n')[0] + ')', false);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('Site Map location-entry test: OK');
