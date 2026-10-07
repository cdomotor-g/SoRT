/*
 * Regression test for custom comments in the Property Services table.
 *
 *   C1 — "+ Add comment" on a row. Every answerable Property Services row
 *        (question, free text, coordinate group, date) carries a collapsible
 *        comment box, like the scope table's "+ Add note". The comment lands
 *        in that row's answer cell in Word, on its own line under the answer
 *        (a coordinate group gets its own "Comment" row instead), and is
 *        joined with "; " in the plain-text fallback. A comment is not an
 *        answer: a highlighted row stays highlighted.
 *
 *   C2 — "Additional comments" at the foot of the table, for anything that
 *        is not about one row. Copied into Word as its own row just above the
 *        fixed Note — and left out entirely when blank.
 *
 *   C3 — Comments live with the rest of the Property Services answers: they
 *        survive a re-render and reconcileState, "Reset this table" clears
 *        them, and with no comments the copied table is byte-identical to
 *        what it was before this feature.
 *
 * Drives the real page code (renderPropertyServices / buildPsRow /
 * buildPropertyServicesHtml / buildPropertyServicesText / reconcileState /
 * copyTable) against the bundled definitions.json. Fully hermetic: GitHub is
 * blocked and nothing else is fetched — no map, no QLD services, no Esri CDN.
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

const SOIL_COMMENT = 'Shallow trench only.\nHand dig near the fence line.';
const COORD_COMMENT = 'Coordinates taken from the 2024 survey.';
const GENERAL = 'Landholder prefers access via the north gate.\nCall ahead: <b>24 h</b> & "notice".';

const chromium = await loadPlaywright();
const server = await serve(REPO_ROOT);
const port = server.address().port;
const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

try {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/api\.github\.com|raw\.githubusercontent\.com/, r => r.abort());
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });

  // The Water Level table carries every Property Services row kind, applied.
  await page.evaluate(()=>{ activeTableId = 'waterlevel'; renderBuilder(); });
  await page.waitForSelector('.ps-block .ps-row', { timeout: 15000 });

  // Baseline copy with no comments, to prove the feature changes nothing until used.
  const baseline = await page.evaluate(()=>({
    html: buildPropertyServicesHtml(activeTable()),
    text: buildPropertyServicesText(activeTable())
  }));

  /* ---- C1: the toggle and box are on every answerable row ---- */
  const ui = await page.evaluate(()=>{
    const rows = [...document.querySelectorAll('.ps-block .ps-row:not(.ps-row--comments)')];
    return {
      rows: rows.length,
      withToggle: rows.filter(r => r.querySelector('.ps-comment-toggle')).length,
      labels: rows.map(r => r.querySelector('.ps-comment-toggle')?.textContent),
      anyOpen: !!document.querySelector('.ps-comment-box.open'),
      headersWithToggle: [...document.querySelectorAll('.ps-sectionheader .ps-comment-toggle')].length
    };
  });
  check('C1: every answerable row has a comment toggle', ui.rows > 0 && ui.withToggle === ui.rows);
  check('C1: the toggle reads "+ Add comment" when empty', ui.labels.every(l => l === '+ Add comment'));
  check('C1: comment boxes start closed', ui.anyOpen === false);
  check('C1: section headers get no comment toggle', ui.headersWithToggle === 0);

  // Find the rows by their label, open the box, type — the way a user does.
  const rowByLabel = (label) => page.locator('.ps-block .ps-row', { hasText: label }).first();
  const soil = rowByLabel('turning of soil');
  await soil.locator('.ps-comment-toggle').click();
  check('C1: clicking the toggle opens the box', await soil.locator('.ps-comment-box.open').count() === 1);
  await soil.locator('.ps-comment-box textarea').fill(SOIL_COMMENT);

  const coords = rowByLabel('Current Co-Ordinates');
  await coords.locator('.ps-comment-toggle').click();
  await coords.locator('.ps-comment-box textarea').fill(COORD_COMMENT);

  const st = await page.evaluate(()=>{
    const ps = state.waterlevel.__ps;
    const soilRow = [...document.querySelectorAll('.ps-block .ps-row')].find(r => /turning of soil/.test(r.textContent));
    return {
      soil: ps.comments.turnSoil,
      coords: ps.comments.currentCoords,
      stillNeeds: soilRow.classList.contains('needs'),
      answer: ps.answers.turnSoil
    };
  });
  check('C1: the comment is stored against its row', st.soil === SOIL_COMMENT && st.coords === COORD_COMMENT);
  check('C1: a comment is not an answer — the row stays highlighted', st.stillNeeds === true && st.answer === undefined);

  /* ---- C2: the Additional comments box ---- */
  check('C2: an "Additional comments" row is shown', await page.locator('.ps-block .ps-row--comments #psGeneralComment').count() === 1);
  const blankCopy = await page.evaluate(()=> buildPropertyServicesHtml(activeTable()));
  check('C2: a blank Additional comments box is left out of Word', !blankCopy.includes('Additional comments'));
  await page.locator('#psGeneralComment').fill(GENERAL);
  check('C2: the text is stored with the table', await page.evaluate(g => state.waterlevel.__ps.general === g, GENERAL));

  /* ---- C1/C2: the Word copy ---- */
  const copy = await page.evaluate(()=>{
    const html = buildPropertyServicesHtml(activeTable());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr')].map(tr => [...tr.cells].map(td => td.innerHTML));
    return { html, rows, text: buildPropertyServicesText(activeTable()) };
  });
  const rowFor = (label) => copy.rows.find(r => r[0] && r[0].includes(label));
  const soilCell = rowFor('turning of soil');
  check('C1: the row comment lands in its answer cell, line breaks kept',
        soilCell && soilCell[1] === 'Shallow trench only.<br>Hand dig near the fence line.');
  const coordIdx = copy.rows.findIndex(r => r[0] && r[0].includes('Current Co-Ordinates'));
  const relocIdx = copy.rows.findIndex(r => r[0] && r[0].includes('Is the equipment being relocated?'));
  const commentRow = copy.rows.findIndex(r => r[0] === 'Comment');
  check('C1: a coordinate group\'s comment is its own "Comment" row inside the group',
        commentRow > coordIdx && commentRow < relocIdx && copy.rows[commentRow][1] === COORD_COMMENT);
  const genIdx = copy.rows.findIndex(r => r[0] === 'Additional comments');
  const noteIdx = copy.rows.findIndex(r => r[0] === 'Note');
  check('C2: Additional comments is copied as a row just above the Note',
        genIdx > 0 && (noteIdx === -1 || genIdx === noteIdx - 1));
  check('C2: the Additional comments text is escaped and keeps its break',
        copy.rows[genIdx][1] === 'Landholder prefers access via the north gate.<br>Call ahead: &lt;b&gt;24 h&lt;/b&gt; &amp; "notice".' &&
        !copy.html.includes('<b>24 h</b>'));
  check('C1: plain text joins answer and comment on one line with "; "',
        copy.text.includes('Does the work require the turning of soil?\tShallow trench only.; Hand dig near the fence line.\n'));
  check('C1: plain text carries the coordinate group comment',
        copy.text.includes(`\tComment\t${COORD_COMMENT}\n`));
  check('C2: plain text carries Additional comments on one line',
        copy.text.includes('Additional comments\tLandholder prefers access via the north gate.; Call ahead: <b>24 h</b> & "notice".\n'));

  // Answering the question puts the answer first, the comment under it.
  await soil.locator('label.option-row', { hasText: 'Yes' }).locator('input').check();
  const answered = await page.evaluate(()=>{
    const doc = new DOMParser().parseFromString(buildPropertyServicesHtml(activeTable()), 'text/html');
    const tr = [...doc.querySelectorAll('tr')].find(tr => tr.cells[0].textContent.includes('turning of soil'));
    return tr.cells[1].innerHTML;
  });
  check('C1: answer first, then the comment on its own line',
        answered === 'Yes<br>Shallow trench only.<br>Hand dig near the fence line.');

  /* ---- C3: comments survive a re-render and reconcile ---- */
  const kept = await page.evaluate(()=>{
    reconcileState();
    renderPropertyServices();
    const soilRow = [...document.querySelectorAll('.ps-block .ps-row')].find(r => /turning of soil/.test(r.textContent));
    return {
      box: soilRow.querySelector('.ps-comment-box textarea').value,
      open: soilRow.querySelector('.ps-comment-box').classList.contains('open'),
      label: soilRow.querySelector('.ps-comment-toggle').textContent,
      general: document.getElementById('psGeneralComment').value,
      state: state.waterlevel.__ps.comments.turnSoil
    };
  });
  check('C3: a comment survives reconcileState + re-render', kept.state === SOIL_COMMENT && kept.box === SOIL_COMMENT);
  check('C3: a row holding a comment re-renders open, labelled "Comment added"', kept.open && kept.label === '− Comment added');
  check('C3: Additional comments survives a re-render', kept.general === GENERAL);

  /* ---- C3: the comments reach the clipboard through the real Copy button ---- */
  await page.evaluate(()=>{ includeMapCopy = false; includePsCopy = true; });
  await page.evaluate(()=> copyTable());
  const clip = await page.evaluate(()=> navigator.clipboard.readText());
  check('C3: Copy for Word carries the row and general comments',
        clip.includes('Shallow trench only.; Hand dig near the fence line.') && clip.includes('Additional comments\t'));

  /* ---- C3: Reset clears them; an emptied box drops out of the copy ---- */
  const reset = await page.evaluate(()=>{
    document.getElementById('resetBtn').click();
    const ps = state.waterlevel.__ps;
    return {
      comments: Object.keys(ps.comments).length,
      general: ps.general,
      box: document.getElementById('psGeneralComment').value,
      anyOpen: !!document.querySelector('.ps-comment-box.open')
    };
  });
  check('C3: Reset this table clears the comments', reset.comments === 0 && reset.general === '' && reset.box === '' && !reset.anyOpen);

  const after = await page.evaluate(()=>({
    html: buildPropertyServicesHtml(activeTable()),
    text: buildPropertyServicesText(activeTable())
  }));
  check('C3: with no comments the copied table is byte-identical to before', after.html === baseline.html && after.text === baseline.text);

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
console.log('Property Services comments test: OK');
