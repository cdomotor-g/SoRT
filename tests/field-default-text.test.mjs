/*
 * Regression test for the two free-text changes:
 *
 *   D1 — "Default text" on a field. Boiler-plate configured once in Manage
 *        Tables lands in the matching Scope Builder input, where the end user
 *        edits it in place. It is a starting *answer* (it copies into Word),
 *        not a placeholder; untouched boiler-plate does not count towards the
 *        progress bar; Clear / Reset hand the boiler-plate back; a field the
 *        user emptied stays empty when the definitions are reconciled again.
 *
 *   D2 — Line breaks survive into Word. A multi-line free-text answer (or a
 *        multi-line default) used to collapse to one run-on paragraph, because
 *        the copied HTML escaped the value but left the newline bare and HTML
 *        treats that as a space. The copy now emits <br>, and the plain-text
 *        fallback — one table row per line — collapses breaks to "; ".
 *
 * Drives the real page code (normalizeRow / emptyRowState / reconcileState /
 * rowHasContent / renderRows / renderFieldEditor / buildHtmlTable /
 * buildPlainText) against a purpose-built definition set applied through the
 * app's own applyDefinitions. Fully hermetic: the central store is blocked and
 * nothing else is fetched — no map, no QLD services, no Esri CDN.
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

// The definition set under test: one table, three fields — plain boiler-plate,
// multi-line boiler-plate on a textarea, and a field with no default at all
// (the pre-change behaviour, which must be untouched).
const BOILER = 'Standard make-good: reinstate the surface to its pre-works condition.';
const MULTI  = 'Access:\nGate 3, then the northern track.\n\nContact the landholder 24 h before entry.';
const TEST_DEFS = {
  version: 1,
  meta: { name: 'default-text test' },
  optionSets: {},
  sharedRows: [],
  tables: [{
    id: 'tbl', label: 'Test', title: 'Test table',
    rows: [
      { id:'makeGood', item:'Make good', type:'none',
        fields:[{ key:'detail', label:'Detail', type:'text', default: BOILER }] },
      { id:'access', item:'Access', type:'none',
        fields:[{ key:'notes', label:'Notes', type:'textarea', default: MULTI }] },
      { id:'plain', item:'Plain', type:'none',
        fields:[{ key:'free', label:'Free text', type:'textarea' }] }
    ]
  }]
};

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
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });

  await page.evaluate(d => { applyDefinitions(d, 'imported'); }, TEST_DEFS);
  await page.waitForSelector('#rowsContainer [data-preview-for="makeGood"]', { timeout: 15000 });

  /* ---- D1: the default survives normalisation and seeds builder state ---- */
  const seeded = await page.evaluate(()=>{
    const row = defs.tables[0].rows.find(r=>r.id === 'makeGood');
    const multi = defs.tables[0].rows.find(r=>r.id === 'access');
    const inputs = [...document.querySelectorAll('#rowsContainer .fields-list input, #rowsContainer .fields-list textarea')];
    return {
      kept:       row.fields[0].default,
      keptMulti:  multi.fields[0].default,
      noDefault:  Object.prototype.hasOwnProperty.call(defs.tables[0].rows[2].fields[0], 'default'),
      stateText:  state.tbl.makeGood.fields.detail,
      stateMulti: state.tbl.access.fields.notes,
      statePlain: state.tbl.plain.fields.free,
      shown:      inputs.map(el=>el.value)
    };
  });
  check('D1: normalizeRow keeps a field default', seeded.kept === BOILER);
  check('D1: a multi-line default is kept verbatim', seeded.keptMulti === MULTI);
  check('D1: a field with no default gains no default key', seeded.noDefault === false);
  check('D1: builder state is seeded with the default', seeded.stateText === BOILER);
  check('D1: builder state is seeded with the multi-line default', seeded.stateMulti === MULTI);
  check('D1: a field with no default is still empty', seeded.statePlain === undefined || seeded.statePlain === '');
  check('D1: the boiler-plate is in the on-screen inputs', seeded.shown[0] === BOILER && seeded.shown[1] === MULTI);
  check('D1: the field with no default renders empty', seeded.shown[2] === '');

  /* ---- D1: untouched boiler-plate is not "filled in" for the progress bar ---- */
  const progress = await page.evaluate(()=>{
    const t = activeTable();
    const pristine = document.getElementById('progressText').textContent;
    const rowHas = effectiveRows(t).map(r => rowHasContent(t, r));
    return { pristine, rowHas };
  });
  check('D1: a pristine default leaves the progress bar at zero', /^0 of 3/.test(progress.pristine));
  check('D1: a pristine default leaves the row un-filled', progress.rowHas.every(v => v === false));

  /* ---- D1: editing it counts, and the copy carries it either way ---- */
  const editRes = await page.evaluate(txt=>{
    const input = document.querySelector('#rowsContainer .fields-list input');
    input.value = txt;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    const t = activeTable();
    const revert = document.querySelector('#rowsContainer .fields-list .field-revert');
    return {
      state: state.tbl.makeGood.fields.detail,
      filled: rowHasContent(t, effectiveRows(t)[0]),
      progress: document.getElementById('progressText').textContent,
      revertShown: !!(revert && !revert.hidden)
    };
  }, BOILER + ' Also re-seed the disturbed ground.');
  check('D1: the user edit replaces the boiler-plate in state', editRes.state === BOILER + ' Also re-seed the disturbed ground.');
  check('D1: an edited default counts as filled in', editRes.filled === true);
  check('D1: the progress bar advances on the edit', /^1 of 3/.test(editRes.progress));
  check('D1: "restore default text" appears once edited', editRes.revertShown === true);

  const reverted = await page.evaluate(()=>{
    document.querySelector('#rowsContainer .fields-list .field-revert').click();
    const revert = document.querySelector('#rowsContainer .fields-list .field-revert');
    return {
      state: state.tbl.makeGood.fields.detail,
      input: document.querySelector('#rowsContainer .fields-list input').value,
      revertShown: !!(revert && !revert.hidden)
    };
  });
  check('D1: "restore default text" puts the boiler-plate back', reverted.state === BOILER && reverted.input === BOILER);
  check('D1: and hides itself again', reverted.revertShown === false);

  /* ---- D1: Clear restores the boiler-plate; an emptied field stays empty ---- */
  const cleared = await page.evaluate(()=>{
    const input = document.querySelector('#rowsContainer .fields-list input');
    input.value = 'something else';
    input.dispatchEvent(new Event('input', { bubbles:true }));
    document.querySelector('#rowsContainer .row .row-clear').click();
    return {
      state: state.tbl.makeGood.fields.detail,
      input: document.querySelector('#rowsContainer .fields-list input').value
    };
  });
  check('D1: Clear restores the boiler-plate, not a blank box', cleared.state === BOILER && cleared.input === BOILER);

  const emptied = await page.evaluate(()=>{
    const input = document.querySelector('#rowsContainer .fields-list input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles:true }));
    reconcileState();               // what a definitions edit / mode switch does
    return state.tbl.makeGood.fields.detail;
  });
  check('D1: a field the user emptied is not re-seeded', emptied === '');

  /* ---- D1: a default added later fills only never-touched fields ---- */
  const late = await page.evaluate(()=>{
    defs.tables[0].rows[2].fields[0].default = 'Added later';
    reconcileState();
    return { plain: state.tbl.plain.fields.free, emptied: state.tbl.makeGood.fields.detail };
  });
  check('D1: a default added later seeds an untouched field', late.plain === 'Added later');
  check('D1: …and still does not re-fill an emptied one', late.emptied === '');

  /* ---- D1: the Manage Tables editor writes the default and round-trips ---- */
  const manage = await page.evaluate(()=>{
    setMode('manage');
    // Expand the first row editor so its field editor is built.
    const head = document.querySelector('#rowEditors .ed-row .ed-row-head');
    if(head && !head.parentElement.classList.contains('open')) head.click();
    const box = document.querySelector('#rowEditors .fe-default textarea');
    const before = box ? box.value : null;
    box.value = 'Replacement boiler-plate';
    box.dispatchEvent(new Event('input', { bubbles:true }));
    const row = defs.tables[0].rows.find(r=>r.id === 'makeGood');
    const exported = exportableDefinitions().tables[0].rows.find(r=>r.id === 'makeGood');
    return {
      hasBox: !!box,
      before,
      written: row.fields[0].default,
      exported: exported.fields[0].default
    };
  });
  check('D1: the field editor exposes a Default text box', manage.hasBox === true);
  check('D1: it is pre-loaded with the configured default', manage.before === BOILER);
  check('D1: typing in it updates the definition', manage.written === 'Replacement boiler-plate');
  check('D1: the default survives export', manage.exported === 'Replacement boiler-plate');

  const cleardef = await page.evaluate(()=>{
    const box = document.querySelector('#rowEditors .fe-default textarea');
    box.value = '';
    box.dispatchEvent(new Event('input', { bubbles:true }));
    const row = defs.tables[0].rows.find(r=>r.id === 'makeGood');
    return Object.prototype.hasOwnProperty.call(row.fields[0], 'default');
  });
  check('D1: emptying the box removes the default entirely', cleardef === false);

  /* ---- D1: multi-line boiler-plate on a single-line field is flagged ---- */
  const hint = await page.evaluate(()=>{
    const box = document.querySelector('#rowEditors .fe-default textarea');
    const hintEl = document.querySelector('#rowEditors .fe-hint');
    box.value = 'line one\nline two';
    box.dispatchEvent(new Event('input', { bubbles:true }));
    const shownForText = !hintEl.hidden;
    const sel = document.querySelector('#rowEditors .fe-main select');
    sel.value = 'textarea';
    sel.dispatchEvent(new Event('change', { bubbles:true }));
    return { shownForText, shownForTextarea: !document.querySelector('#rowEditors .fe-hint').hidden };
  });
  check('D1: a multi-line default on a Text field is flagged', hint.shownForText === true);
  check('D1: the flag clears once the field is a Text area', hint.shownForTextarea === false);

  /* ---- D2: line breaks reach Word as <br>, and collapse in plain text ---- */
  const copy = await page.evaluate(()=>{
    setMode('builder');
    const t = activeTable();
    state.tbl.access.fields.notes = 'First chunk.\n\nSecond chunk.';
    state.tbl.plain.fields.free = 'alpha\nbeta';
    state.tbl.plain.note = 'note line 1\nnote line 2';
    renderRows();
    document.getElementById('includeEmpty').checked = false;
    document.getElementById('includeHeader').checked = false;
    return { html: buildHtmlTable(), text: buildPlainText() };
  });
  check('D2: a blank line inside an answer becomes <br><br>',
        copy.html.includes('First chunk.<br><br>Second chunk.'));
  check('D2: a single break inside an answer becomes <br>',
        copy.html.includes('alpha<br>beta'));
  check('D2: a multi-line row note keeps its break',
        copy.html.includes('note line 1<br>note line 2'));
  check('D2: HTML escaping still applies around the breaks',
        !/[^&]<br>[^<]*<script/i.test(copy.html));
  check('D2: the plain-text fallback keeps one row on one line',
        copy.text.split('\n').filter(l=>l.startsWith('Access\t')).length === 1);
  check('D2: the plain-text fallback collapses breaks to "; "',
        copy.text.includes('First chunk.; Second chunk.') && copy.text.includes('alpha; beta'));

  const esc = await page.evaluate(()=>{
    state.tbl.plain.fields.free = '<b>bold</b> & "quoted"\nnext';
    return buildHtmlTable();
  });
  check('D2: markup in a value is still escaped',
        esc.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;<br>next') && !esc.includes('<b>bold</b>'));

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
console.log('Default text + line-break test: OK');
