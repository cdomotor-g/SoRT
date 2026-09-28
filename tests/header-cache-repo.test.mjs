/*
 * Regression test for the two header actions: "Load from repo" and
 * "Clear cache".
 *
 * Load from repo reads definitions.json straight from GitHub — the copy people
 * edit on github.com — so an edit made there reaches the app without an Export /
 * Import round trip. It must:
 *   * read the branch as it is right now (the contents API, asking for the raw
 *     file), and fall back to raw.githubusercontent.com — with a throwaway query
 *     so no cache can answer — when the API refuses (rate limit) or is blocked;
 *   * keep the loaded copy as an UNPUBLISHED browser copy, like an Import: the
 *     central store is never written, the source chip and Manage Tables say where
 *     it came from, and a later reload doesn't lose it;
 *   * ask before it replaces unpublished edits — and not ask when the copy in
 *     the browser is itself an untouched repo load;
 *   * carry over answers already filled in on rows that still exist;
 *   * leave everything exactly as it was when GitHub can't be reached, returns
 *     something that isn't a definitions file, or doesn't answer in time.
 *
 * Clear cache forgets what SoRT has saved in this browser and reloads the page
 * fresh from the server. It must:
 *   * ask first (it clears the page's answers too), and do nothing on "Cancel";
 *   * remove every `sort.*` key EXCEPT the theme, and nothing else — GitHub
 *     Pages sites on one account share an origin, so other apps' keys survive;
 *   * not let a pending (debounced) autosave write the draft straight back;
 *   * re-fetch the page past the HTTP cache before reloading, and say it
 *     worked once the fresh page is up;
 *   * actually defeat a stale page cache: served the way GitHub Pages serves
 *     it (`max-age=600`), a new deploy is invisible to an ordinary visit until
 *     Clear cache is pressed — and from then on it isn't.
 *
 * Hermetic: the central store is blocked and both GitHub hosts are stubbed with
 * Playwright network interception — the page code runs unmodified. Interception
 * switches Chromium's HTTP cache off, so the real-cache section runs in a second
 * browser with no interception, where only 127.0.0.1 resolves.
 *
 * Run: see tests/README.md (same invocation as reopen-coords.test.mjs).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- the "repo" copies GitHub hands back ---- */
const bundled = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'definitions.json'), 'utf8'));
function repoCopy(tableLabel){
  const d = JSON.parse(JSON.stringify(bundled));
  const t = d.tables.find(x => x.id === 'rainfall');
  t.label = tableLabel;
  // A brand-new option on an existing row: the kind of edit made on github.com.
  t.rows.find(r => r.id === 'InfraOps').options.push('Repo-only footing');
  return JSON.stringify(d);
}
const API_URL = 'https://api.github.com/repos/cdomotor-g/SoRT/contents/definitions.json?ref=main';
const RAW_PREFIX = 'https://raw.githubusercontent.com/cdomotor-g/SoRT/main/definitions.json?nocache=';

/* ---- GitHub stubs: each scenario sets what the two hosts do ---- */
// A behaviour is { status, body, delayMs? } or 'abort' (a network failure).
const gh = { api: null, raw: null };
const ghLog = [];
async function answer(route, how){
  if(how === 'abort') return route.abort();
  if(how.delayMs) await sleep(how.delayMs);
  try{
    await route.fulfill({
      status: how.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
      body: how.body
    });
  }catch(_){ /* the page gave up on it (timeout) — that's the point */ }
}

const chromium = await loadPlaywright();
const server = await serve(REPO_ROOT);
const port = server.address().port;
const PAGE_URL = `http://127.0.0.1:${port}/index.html`;
const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

try {
  const ctx = await browser.newContext();
  const storeWrites = [];
  await ctx.route('**://*.supabase.co/**', r => {
    if(r.request().method() !== 'GET') storeWrites.push(r.request().method() + ' ' + r.request().url());
    return r.abort();
  });
  await ctx.route('https://api.github.com/**', async r => {
    ghLog.push({ via:'api', url: r.request().url(), headers: await r.request().allHeaders() });
    await answer(r, gh.api);
  });
  await ctx.route('https://raw.githubusercontent.com/**', async r => {
    ghLog.push({ via:'raw', url: r.request().url(), headers: await r.request().allHeaders() });
    await answer(r, gh.raw);
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  // Every dialog is recorded; each scenario says how the next one is answered.
  const dialogs = [];
  let dialogAnswer = 'fail';
  page.on('dialog', async d => {
    dialogs.push(d.message());
    if(dialogAnswer === 'accept') await d.accept(); else await d.dismiss();
  });

  // Another app on the same origin, and the theme — neither is SoRT's cache.
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem('seeded')){
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('other.app.setting', 'keep me');
      localStorage.setItem('sort.theme', 'dark');
    }
  });
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });

  const snap = () => page.evaluate(()=>({
    origin: defsOrigin,
    source: document.getElementById('sourceLabel').textContent,
    label: defs && defs.tables.find(t=>t.id === 'rainfall').label,
    tabs: [...document.querySelectorAll('#tabs .tab-btn, #tabs button')].map(b=>b.textContent.trim()),
    draft: localStorage.getItem('sort.definitions.v1'),
    url: localStorage.getItem('sort.definitionsUrl'),
    btnDisabled: document.getElementById('loadRepoBtn').disabled,
    btnLabel: document.querySelector('#loadRepoBtn .header-btn-label').textContent,
    btnBusy: document.getElementById('loadRepoBtn').hasAttribute('aria-busy'),
    toast: document.getElementById('appToast').hidden ? '' : document.getElementById('appToast').textContent,
    toastError: document.getElementById('appToast').classList.contains('is-error')
  }));
  // Click "Load from repo" and wait for it to finish (the button comes back and
  // a toast reports the outcome). A run that never reports is left for the
  // checks to flag, rather than aborting the whole test.
  async function loadFromRepo(){
    await page.evaluate(()=>{ document.getElementById('appToast').hidden = true; });
    await page.click('#loadRepoBtn');
    await page.waitForFunction(()=> !document.getElementById('loadRepoBtn').disabled &&
                                     !document.getElementById('appToast').hidden, null, { timeout: 8000 })
      .catch(()=>{});
    return snap();
  }

  /* ================= the buttons ================= */
  const layout = await page.evaluate(()=>{
    const group = document.querySelector('header.app-header .header-actions');
    return {
      order: group ? [...group.querySelectorAll('button')].map(b=>b.id) : [],
      labels: ['clearCacheBtn','loadRepoBtn'].map(id=>document.querySelector('#'+id+' .header-btn-label').textContent),
      repoTitle: document.getElementById('loadRepoBtn').title
    };
  });
  check('the header carries Clear cache, Load from repo, then the theme toggle',
        JSON.stringify(layout.order) === JSON.stringify(['clearCacheBtn','loadRepoBtn','themeToggle']));
  check('the buttons are labelled "Clear cache" and "Load from repo"',
        layout.labels[0] === 'Clear cache' && layout.labels[1] === 'Load from repo');
  check('the Load from repo tooltip names the repo and branch',
        /cdomotor-g\/SoRT/.test(layout.repoTitle) && /main/.test(layout.repoTitle));
  for(const m of ['manage','map','ps','builder']){
    await page.evaluate(m => setMode(m), m);
    check(`both buttons are on screen in the "${m}" tab`,
          await page.isVisible('#clearCacheBtn') && await page.isVisible('#loadRepoBtn'));
  }

  /* ================= Load from repo — the API route ================= */
  const before = await snap();
  check('(setup) the bundled file loaded, with no browser copy saved',
        before.origin === 'file' && !before.draft);
  // Work in progress: an answer on a row the repo copy keeps, and the attendees.
  await page.locator('label.option-row', { hasText: 'Reduced footing' }).locator('input').check();
  await page.fill('#forumAttendees', 'CD, JS');
  await page.evaluate(()=> localStorage.setItem('sort.definitionsUrl', 'https://example.invalid/defs.json'));

  gh.api = { status: 200, body: repoCopy('Rainfall Table (repo)') };
  gh.raw = { status: 500, body: '' };
  dialogAnswer = 'fail';
  const dialogsBefore = dialogs.length;
  const a = await loadFromRepo();
  check('with nothing unpublished to lose, it loads without asking', dialogs.length === dialogsBefore);
  check('it reads the contents API for main', ghLog.length === 1 && ghLog[0].via === 'api' && ghLog[0].url === API_URL);
  check('…asking for the raw file, not the JSON envelope',
        ghLog[0] && ghLog[0].headers.accept === 'application/vnd.github.raw');
  check('the raw CDN is not touched when the API answers', !ghLog.some(l => l.via === 'raw'));
  check('the repo copy is applied', a.label === 'Rainfall Table (repo)' && a.tabs.includes('Rainfall Table (repo)'));
  check('an option added on GitHub shows up in the builder',
        await page.locator('label.option-row', { hasText: 'Repo-only footing' }).count() === 1);
  check('its origin is "repo"', a.origin === 'repo');
  check('the source chip says it came from GitHub', a.source === 'Definitions: loaded from GitHub (browser only)');
  check('an answer already given on a row that still exists carries over',
        await page.evaluate(()=> state.rainfall.InfraOps.selected) === 'Reduced footing' &&
        await page.locator('label.option-row', { hasText: 'Reduced footing' }).locator('input').isChecked());
  check('the forum attendees are left alone', await page.inputValue('#forumAttendees') === 'CD, JS');
  check('it is kept in this browser (so a reload does not lose it)',
        a.draft && JSON.parse(a.draft).tables.find(t=>t.id === 'rainfall').label === 'Rainfall Table (repo)');
  check('like an Import, it forgets a remembered URL', a.url === null);
  check('the toast says it loaded the latest from GitHub', /Loaded the latest definitions from GitHub \(cdomotor-g\/SoRT, main\)/.test(a.toast));
  check('…and that it still has to be published to reach everyone', /Publish to central store/.test(a.toast) && !a.toastError);
  check('the button is usable again, label restored, not busy',
        !a.btnDisabled && a.btnLabel === 'Load from repo' && !a.btnBusy);
  check('nothing was sent to the central store', storeWrites.length === 0);

  // Manage Tables tells the editor where these came from — not a stale draft.
  await page.evaluate(()=> setMode('manage'));
  const manage = await page.evaluate(()=>({
    note: document.querySelector('#manageView .admin-note').textContent,
    resumeBanner: !!document.getElementById('btnResumeDraft')
  }));
  check('Manage Tables says they were loaded from GitHub and are not published yet',
        /loaded from GitHub and are not published yet/.test(manage.note));
  check('…and does not offer them back as a draft "from a previous session"', !manage.resumeBanner);
  await page.evaluate(()=> setMode('builder'));

  // The toast dismisses on click.
  await page.click('#appToast');
  check('the toast dismisses on click', await page.evaluate(()=> document.getElementById('appToast').hidden));

  /* ================= loading again over an untouched repo load ================= */
  gh.api = { status: 200, body: repoCopy('Rainfall Table (repo, v2)') };
  const d0 = dialogs.length;
  const again = await loadFromRepo();
  check('re-loading over an untouched repo load does not ask', dialogs.length === d0);
  check('…and picks up the newer copy', again.label === 'Rainfall Table (repo, v2)');

  /* ================= unpublished edits: ask first ================= */
  await page.evaluate(()=>{ defs.tables.find(t=>t.id === 'rainfall').label = 'Edited locally'; afterTextChange(); });
  await page.waitForFunction(()=> defsOrigin === 'local', null, { timeout: 3000 });
  const logBefore = ghLog.length;
  dialogAnswer = 'dismiss';
  const d1 = dialogs.length;
  await page.click('#loadRepoBtn');
  await sleep(300);
  const kept = await snap();
  check('with unpublished edits, it asks before replacing them',
        dialogs.length === d1 + 1 && /unpublished definition edits/.test(dialogs[dialogs.length - 1]));
  check('"Cancel" leaves the edits in place and never contacts GitHub',
        ghLog.length === logBefore && kept.label === 'Edited locally' && kept.origin === 'local' &&
        JSON.parse(kept.draft).tables.find(t=>t.id === 'rainfall').label === 'Edited locally');
  check('"Cancel" leaves the button usable', !kept.btnDisabled);

  dialogAnswer = 'accept';
  gh.api = { status: 200, body: repoCopy('Rainfall Table (repo, v3)') };
  const replaced = await loadFromRepo();
  check('"OK" replaces them with the repo copy', replaced.label === 'Rainfall Table (repo, v3)' && replaced.origin === 'repo');

  /* ================= the API refuses → the raw CDN ================= */
  gh.api = { status: 403, body: '{"message":"API rate limit exceeded"}' };
  gh.raw = { status: 200, body: repoCopy('Rainfall Table (raw)') };
  const rawStart = ghLog.length;
  const viaRaw = await loadFromRepo();
  const rawReq = ghLog.slice(rawStart).find(l => l.via === 'raw');
  check('a rate-limited API falls back to raw.githubusercontent.com',
        viaRaw.label === 'Rainfall Table (raw)' && viaRaw.origin === 'repo');
  check('…at main, with a throwaway query so no cache can answer',
        rawReq && rawReq.url.startsWith(RAW_PREFIX) && /nocache=\d+$/.test(rawReq.url));
  check('…and the toast warns the raw copy can lag a very recent commit',
        /up to 5 minutes behind/.test(viaRaw.toast) && !/Loaded the latest/.test(viaRaw.toast) && !viaRaw.toastError);

  /* ================= GitHub unreachable: nothing changes ================= */
  const intact = await snap();
  gh.api = 'abort';
  gh.raw = { status: 404, body: '404: Not Found' };
  const failed = await loadFromRepo();
  check('when neither route works, an error says so', failed.toastError &&
        /Couldn.t load definitions from GitHub/.test(failed.toast));
  check('…naming each route and why it failed',
        /GitHub API: /.test(failed.toast) && /raw\.githubusercontent\.com: HTTP 404/.test(failed.toast));
  check('…and the definitions, origin and saved copy are untouched',
        failed.label === intact.label && failed.origin === intact.origin && failed.draft === intact.draft);
  check('…and the button is usable again', !failed.btnDisabled && failed.btnLabel === 'Load from repo');

  /* ================= not a definitions file: nothing changes ================= */
  gh.api = { status: 200, body: '{"hello":"world"}' };
  gh.raw = { status: 200, body: '<html>captive portal</html>' };
  const junk = await loadFromRepo();
  check('something that is not a definitions file is refused',
        junk.toastError && /not a valid definitions file/.test(junk.toast));
  check('…leaving everything as it was',
        junk.label === intact.label && junk.origin === intact.origin && junk.draft === intact.draft);

  /* ================= a host that never answers can't hang the button ================= */
  await page.evaluate(()=>{ GITHUB_REPO.timeoutMs = 700; });
  gh.api = { status: 200, body: repoCopy('Too late'), delayMs: 3000 };
  gh.raw = { status: 200, body: repoCopy('Too late'), delayMs: 3000 };
  const t0 = Date.now();
  const slow = await loadFromRepo();
  const took = Date.now() - t0;
  check('a route that does not answer is abandoned after the timeout',
        slow.toastError && /no response within 1 s/.test(slow.toast) && took < 2900);
  check('…and nothing that arrives late is applied', slow.label === intact.label);
  await page.evaluate(()=>{ GITHUB_REPO.timeoutMs = 15000; });
  await sleep(2600);   // let the late responses land (and be ignored)
  check('…even after the late responses land', (await snap()).label === intact.label);

  /* ================= Clear cache ================= */
  await page.evaluate(()=>{
    localStorage.setItem('sort.definitionsUrl', 'https://example.invalid/defs.json');
    localStorage.setItem('sort.someFutureKey', 'stale');
    window.__notReloaded = true;
  });
  const seeded = await page.evaluate(()=> Object.keys(localStorage).sort());
  check('(setup) the browser holds SoRT data, the theme and another app\'s key',
        ['sort.definitions.v1','sort.definitionsUrl','sort.someFutureKey','sort.theme','other.app.setting']
          .every(k => seeded.includes(k)));

  // "Cancel" clears nothing and doesn't reload.
  dialogAnswer = 'dismiss';
  const d2 = dialogs.length;
  await page.click('#clearCacheBtn');
  await sleep(300);
  check('Clear cache asks first', dialogs.length === d2 + 1 &&
        /Clear the cache and reload\?/.test(dialogs[dialogs.length - 1]));
  check('…warning that answers on the page are cleared and the store is untouched',
        /Anything filled in on this page will be cleared/.test(dialogs[dialogs.length - 1]) &&
        /central store are not affected/.test(dialogs[dialogs.length - 1]));
  check('"Cancel" clears nothing and does not reload',
        JSON.stringify(await page.evaluate(()=> Object.keys(localStorage).sort())) === JSON.stringify(seeded) &&
        await page.evaluate(()=> window.__notReloaded === true) &&
        !(await page.evaluate(()=> document.getElementById('clearCacheBtn').disabled)));

  // "OK" — with an edit's autosave still pending, and a slow page refresh, so
  // the autosave's 300 ms debounce would fire before the reload if it weren't
  // cancelled.
  //
  // Playwright turns the HTTP cache off whenever routing is on, so the cache
  // bypass is asserted where it is decided: the page's own fetch() call must
  // ask for `cache:"reload"` (which, per the Fetch spec, goes to the network
  // with no-cache headers and stores the fresh copy), and that request must
  // land before the reload's document request.
  const pageRequests = [];
  await page.route('**/index.html', async r => {
    const type = r.request().resourceType();
    pageRequests.push(type);
    if(type === 'fetch') await sleep(700);
    await r.continue();
  });
  const pageFetchCalls = [];
  await page.exposeFunction('__recordFetch', (url, cache) => { pageFetchCalls.push({ url, cache }); });
  await page.evaluate(()=>{
    const real = window.fetch;
    window.fetch = function(input, init){
      window.__recordFetch(String(input && input.url || input), init && init.cache);
      return real.apply(this, arguments);
    };
  });
  dialogAnswer = 'accept';
  await page.evaluate(()=>{ defs.tables[0].label = 'Unsaved edit'; persistLocal(); });
  const reloaded = page.waitForEvent('load', { timeout: 15000 });
  await page.click('#clearCacheBtn');
  await reloaded;
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });
  await page.unroute('**/index.html');

  const after = await page.evaluate(()=>({
    keys: Object.keys(localStorage).sort(),
    theme: localStorage.getItem('sort.theme'),
    themeApplied: document.documentElement.getAttribute('data-theme'),
    other: localStorage.getItem('other.app.setting'),
    notReloaded: window.__notReloaded === true,
    origin: defsOrigin,
    source: document.getElementById('sourceLabel').textContent,
    label: defs.tables.find(t=>t.id === 'rainfall').label,
    toast: document.getElementById('appToast').hidden ? '' : document.getElementById('appToast').textContent,
    flag: sessionStorage.getItem('sort.cacheCleared')
  }));
  check('"OK" reloads the page', !after.notReloaded);
  check('the saved definitions draft is gone', !after.keys.includes('sort.definitions.v1'));
  check('…even though an autosave was pending when it was pressed', !after.keys.includes('sort.definitions.v1'));
  check('the remembered definitions URL is gone', !after.keys.includes('sort.definitionsUrl'));
  check('any other sort.* key is gone too', !after.keys.includes('sort.someFutureKey'));
  check('the theme choice is kept (and still applied)', after.theme === 'dark' && after.themeApplied === 'dark');
  check('another app\'s data on the same origin is untouched', after.other === 'keep me');
  check('the app starts from the published definitions again',
        after.origin === 'file' && after.source === 'Definitions: published file' && after.label === 'Rainfall Table');
  check('the page itself is re-fetched with cache:"reload" (past the HTTP cache)',
        pageFetchCalls.some(c => c.url === PAGE_URL && c.cache === 'reload'));
  check('…and that refresh lands before the reload',
        pageRequests.indexOf('fetch') !== -1 &&
        pageRequests.indexOf('fetch') < pageRequests.indexOf('document'));
  check('the fresh page says the cache was cleared', /Cache cleared/.test(after.toast));
  check('…once (the one-shot flag is consumed)', after.flag === null);

  check('no uncaught page errors', pageErrors.length === 0);
  if(pageErrors.length) console.log('page errors:', pageErrors.slice(0,3));

} finally {
  await browser.close();
  server.close();
}

/* ================= Clear cache against a REAL HTTP cache =================
   Routing (above) switches Chromium's HTTP cache off, so this part runs in its
   own browser with no routes at all: every host but 127.0.0.1 fails to resolve
   (so the central store is still unreachable), and the app is served the way
   GitHub Pages serves it — `max-age=600` plus an ETag — from a scratch copy we
   can "deploy" a new version into. */
{
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'sort-cache-'));
  for(const f of ['index.html', 'definitions.json']) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(site, f));
  const hits = [];
  const pages = http.createServer((req, res)=>{
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(site, urlPath === '/' ? '/index.html' : urlPath);
    if(!file.startsWith(site) || !fs.existsSync(file)){ res.writeHead(404); res.end('not found'); return; }
    const body = fs.readFileSync(file);
    const etag = '"' + crypto.createHash('sha1').update(body).digest('hex') + '"';
    hits.push({ path: urlPath, dest: req.headers['sec-fetch-dest'] || '', cc: req.headers['cache-control'] || '' });
    if(req.headers['if-none-match'] === etag){ res.writeHead(304, { ETag: etag, 'Cache-Control': 'max-age=600' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag });
    res.end(body);
  });
  await new Promise(r => pages.listen(0, '127.0.0.1', r));
  const SITE_URL = `http://127.0.0.1:${pages.address().port}/index.html`;
  const cachedBrowser = await chromium.launch(Object.assign({}, launchOpts, {
    args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1']
  }));
  try {
    const page = await cachedBrowser.newPage();
    page.on('dialog', d => d.accept());
    const heading = async () => { await page.waitForSelector('#rowsContainer .row', { timeout: 15000 }); return page.textContent('header.app-header h1'); };
    const visit = async () => { await page.goto('about:blank'); await page.goto(SITE_URL); return heading(); };

    check('(real cache) the first visit shows the current version', await visit() === 'SoRT Forum Scope Builder');
    // Deploy a new version of the page.
    const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(site, 'index.html'),
      html.replace('<h1>SoRT Forum Scope Builder</h1>', '<h1>SoRT Forum Scope Builder (new)</h1>'));
    check('(real cache) an ordinary visit after a deploy is handed the stale page — the problem',
          await visit() === 'SoRT Forum Scope Builder');

    hits.length = 0;
    const reloaded = page.waitForEvent('load', { timeout: 15000 });
    await page.click('#clearCacheBtn');
    await reloaded;
    check('(real cache) Clear cache brings up the new version', await heading() === 'SoRT Forum Scope Builder (new)');
    const refresh = hits.findIndex(h => h.path === '/index.html' && h.dest === 'empty');
    const navigation = hits.findIndex(h => h.path === '/index.html' && h.dest === 'document');
    check('(real cache) it re-fetched the page with no-cache, before reloading',
          refresh !== -1 && hits[refresh].cc === 'no-cache' && refresh < navigation);
    check('(real cache) ordinary visits after that get the new version too',
          await visit() === 'SoRT Forum Scope Builder (new)');
  } finally {
    await cachedBrowser.close();
    pages.close();
    fs.rmSync(site, { recursive: true, force: true });
  }
}

const failed = results.filter(r => !r.ok);
for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('Header Clear cache + Load from repo test: OK');
