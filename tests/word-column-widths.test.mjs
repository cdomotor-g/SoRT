/*
 * Regression test for the "one-character-wide first column" defect.
 *
 * Pasted into Word, both copied tables landed with their left-hand column
 * (Item / the Property Services label) collapsed to about one character wide,
 * so every row had to be dragged wider by hand in the report. The cause is
 * Word's own autofit: it re-computes column widths over pasted HTML and only
 * stands down when the table is declared FIXED and every column has an
 * explicit width. The old copy declared neither — the table was `width:100%`
 * with a single `width:28%` (38% in Property Services) on one cell per body
 * row, and nothing at all on the header cells or the full-width `colspan="2"`
 * rows — so autofit had free rein.
 *
 * The copy now emits, on BOTH tables:
 *   * `table-layout:fixed` and an absolute table width;
 *   * a `<colgroup>` with one `<col>` per column, carrying the widths;
 *   * a width on every single cell, the `colspan="2"` ones included, in cm
 *     (CSS) and px (the legacy `width` attribute older Word builds read first);
 *   * a one-third / two-thirds split, the widths the user asked for.
 *
 * Drives the real `buildHtmlTable` / `buildPropertyServicesHtml` code against
 * the bundled definitions, and parses the emitted HTML with the browser's own
 * parser rather than by regex, so the assertions are about the table Word
 * actually receives. Fully hermetic: the central store is blocked and nothing
 * else is fetched — no map, no QLD services, no Esri CDN.
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
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });

  // Measure both copied tables the way Word sees them: parse the emitted HTML
  // and read each cell's declared widths off the DOM.
  const geo = await page.evaluate(()=>{
    document.getElementById('includeHeader').checked = true;
    document.getElementById('includeEmpty').checked = true;
    const measure = (html)=>{
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const t = doc.querySelector('table');
      const cols = [...t.querySelectorAll('colgroup > col')].map(c=>c.style.width);
      const rows = [...t.rows].map(tr => [...tr.cells].map(td=>({
        span: td.colSpan,
        css:  td.style.width,
        attr: td.getAttribute('width')
      })));
      return {
        layout: t.style.tableLayout,
        width: t.style.width,
        widthAttr: t.getAttribute('width'),
        cols, rows,
        cells: rows.flat(),
        html
      };
    };
    return {
      scope: measure(buildHtmlTable()),
      ps:    measure(buildPropertyServicesHtml(activeTable())),
      split: WORD_COL_SPLIT,
      totalCm: WORD_TABLE_CM,
      colCm: WORD_COLS.map(c=>c.cm)
    };
  });

  const cm = v => parseFloat(v);
  for(const [label, t] of [['scope table', geo.scope], ['Property Services table', geo.ps]]){

    /* ---- the three things that make Word stop re-fitting the columns ---- */
    check(`${label}: declares a fixed table layout (autofit off)`, t.layout === 'fixed');
    check(`${label}: declares an absolute table width, not 100%`,
          /cm$/.test(t.width) && Math.abs(cm(t.width) - geo.totalCm) < 0.01);
    check(`${label}: carries a <colgroup> with one <col> per column`, t.cols.length === 2);
    check(`${label}: the <col> widths are the 1/3 : 2/3 split`,
          Math.abs(cm(t.cols[0]) - geo.colCm[0]) < 0.01 &&
          Math.abs(cm(t.cols[1]) - geo.colCm[1]) < 0.01);

    /* ---- no cell is left for autofit to guess at ---- */
    check(`${label}: every cell declares a CSS width`,
          t.cells.length > 0 && t.cells.every(c => /cm$/.test(c.css)));
    check(`${label}: every cell declares the legacy width attribute too`,
          t.cells.every(c => c.attr && Number(c.attr) > 0));
    check(`${label}: the full-width colspan cells span the whole table`,
          t.cells.filter(c=>c.span === 2).length > 0 &&
          t.cells.filter(c=>c.span === 2).every(c => Math.abs(cm(c.css) - geo.totalCm) < 0.01));

    /* ---- the split the user asked for, on every two-column row ---- */
    const twoCol = t.rows.filter(r => r.length === 2);
    check(`${label}: has two-column rows to widen`, twoCol.length > 0);
    check(`${label}: the narrow column gets one third on every two-column row`,
          twoCol.every(r => Math.abs(cm(r[0].css) - geo.colCm[0]) < 0.01));
    check(`${label}: the right-hand column gets two thirds on every two-column row`,
          twoCol.every(r => Math.abs(cm(r[1].css) - geo.colCm[1]) < 0.01));
    check(`${label}: the narrow column is nowhere near one character wide`,
          twoCol.every(r => cm(r[0].css) > 4));

    /* ---- the old percentage widths, which autofit ignored, are gone ---- */
    check(`${label}: no percentage cell widths survive`, !/width:\s*\d+%/.test(t.html));
  }

  // The declared widths must actually add up, or Word reconciles them itself —
  // which is the autofit pass we just turned off.
  check('the two column widths add up to the table width',
        Math.abs((geo.colCm[0] + geo.colCm[1]) - geo.totalCm) < 0.01);
  check('the split is one third / two thirds',
        Math.abs(geo.split[0] - 1/3) < 1e-9 && Math.abs(geo.split[1] - 2/3) < 1e-9);
  check('the table width is the A4-portrait text width', geo.totalCm === 16);

  // A cm width and its px mirror must agree, or Word picks whichever it reads
  // first and the columns come out at two different sizes.
  const mirrored = await page.evaluate(()=>{
    const px = cm => Math.round(cm * 96 / 2.54);
    return WORD_COLS.every(c => c.px === px(c.cm)) && WORD_FULL.px === px(WORD_FULL.cm);
  });
  check('the px width attribute mirrors the cm CSS width', mirrored);

  // Changing the split is a one-line edit: the whole copy must follow it.
  const swapped = await page.evaluate(()=>{
    const doc = new DOMParser().parseFromString(buildHtmlTable(), 'text/html');
    const body = [...doc.querySelectorAll('table > tbody > tr')].filter(tr=>tr.cells.length === 2);
    const first = body[0];
    return { left: first.cells[0].style.width, right: first.cells[1].style.width };
  });
  check('the left column is narrower than the right (not the other way round)',
        cm(swapped.left) < cm(swapped.right));

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
console.log('Word column-width test: OK');
