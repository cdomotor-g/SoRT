/*
 * Regression test for GitHub as the definitions store (Supabase is gone).
 *
 * The published definitions are definitions.json in the repo. The app must:
 *   * load them from GitHub at startup (the contents API, raw file), as the
 *     PUBLISHED copy — and never contact the retired Supabase store;
 *   * refuse to publish nothing: a copy identical to GitHub's (bar the date
 *     stamp) is not a change;
 *   * need a connected token to publish, via "Connect GitHub…": the token is
 *     checked before it is kept (who it belongs to, and that it can write to
 *     the repo), a wrong or read-only token is refused with a plain reason,
 *     "Remember" picks localStorage vs sessionStorage, and Disconnect forgets;
 *   * publish by committing EXACTLY what Export would download — the base64
 *     content round-trips the UTF-8 (emoji, en dashes) byte for byte — with
 *     the commit message the user typed, onto main, quoting the sha of the
 *     version it replaces;
 *   * never overwrite someone else's edit: if GitHub's file is no longer the
 *     text the edits started from, Publish is refused before anything is
 *     written — including for a draft resumed in a later session (the draft
 *     remembers its base) — and a 409 from GitHub itself is reported the same
 *     way; a draft with no known base asks before replacing the file;
 *   * explain a rejected (401) or read-only (403) token, keep the edits, and
 *     forget a token GitHub has rejected;
 *   * send the connected token on reads too, and still read when GitHub
 *     rejects it.
 *
 * Hermetic: GitHub is a fake served through Playwright network interception,
 * built to answer like the real REST API; the page code runs unmodified.
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= a fake GitHub ================= */
const REPO = '/repos/cdomotor-g/SoRT';
const TOKENS = {
  'github_pat_GOOD':     { login: 'cdomotor-g', write: true },
  'github_pat_READONLY': { login: 'cdomotor-g', write: false }
};
const gh = {
  fileText: '',         // what main holds now
  version: 1,
  failPut: null,        // { status, message } to answer the next PUT with
  puts: [],             // accepted and refused PUT bodies
  log: []               // every request: { method, path, auth, accept }
};
const shaOf = v => 'blob' + String(v).padStart(36, '0');
const b64 = text => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');   // GitHub wraps at 60
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE'
};
function json(route, status, body){
  return route.fulfill({ status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS), body: JSON.stringify(body) });
}
async function fakeGithub(route){
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  const method = req.method();
  if(method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
  const auth = headers.authorization || '';
  gh.log.push({ method, path: url.pathname + url.search, auth, accept: headers.accept || '' });
  const token = auth.replace(/^Bearer /, '');
  const who = auth ? TOKENS[token] : null;
  if(auth && !who) return json(route, 401, { message: 'Bad credentials' });

  if(url.pathname === '/user'){
    return who ? json(route, 200, { login: who.login }) : json(route, 401, { message: 'Requires authentication' });
  }
  if(url.pathname === REPO + '/git/blobs' && method === 'POST'){
    if(!who) return json(route, 401, { message: 'Requires authentication' });
    if(!who.write) return json(route, 403, { message: 'Resource not accessible by personal access token' });
    return json(route, 201, { sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' });
  }
  if(url.pathname === REPO + '/contents/definitions.json' && method === 'GET'){
    if(url.searchParams.get('ref') !== 'main') return json(route, 404, { message: 'No commit found for the ref' });
    if(/application\/vnd\.github\.raw/.test(headers.accept || '')){
      return route.fulfill({ status: 200, headers: Object.assign({ 'Content-Type': 'application/vnd.github.raw; charset=utf-8' }, CORS), body: gh.fileText });
    }
    return json(route, 200, { name: 'definitions.json', path: 'definitions.json', sha: shaOf(gh.version),
                              encoding: 'base64', content: b64(gh.fileText) });
  }
  if(url.pathname === REPO + '/contents/definitions.json' && method === 'PUT'){
    const body = JSON.parse(req.postData() || '{}');
    gh.puts.push({ body, auth });
    if(!who) return json(route, 401, { message: 'Requires authentication' });
    if(gh.failPut){ const f = gh.failPut; gh.failPut = null; return json(route, f.status, { message: f.message || 'failed' }); }
    if(!who.write) return json(route, 403, { message: 'Resource not accessible by personal access token' });
    if(body.sha !== shaOf(gh.version)) return json(route, 409, { message: `definitions.json does not match ${body.sha}` });
    gh.fileText = Buffer.from(body.content, 'base64').toString('utf8');
    gh.version++;
    return json(route, 200, { content: { sha: shaOf(gh.version) },
                              commit: { sha: 'c0ffee' + String(gh.version).padStart(34, '0'), html_url: 'https://github.com/cdomotor-g/SoRT/commit/x' } });
  }
  return json(route, 404, { message: 'Not Found' });
}

const chromium = await loadPlaywright();
const server = await serve(REPO_ROOT);
const PAGE_URL = `http://127.0.0.1:${server.address().port}/index.html`;
const launchOpts = { headless: true };
if(process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOpts);

try {
  const ctx = await browser.newContext();
  const supabaseHits = [];
  await ctx.route(/supabase\.co/, r => { supabaseHits.push(r.request().url()); return r.abort(); });
  await ctx.route('https://api.github.com/**', fakeGithub);
  await ctx.route('https://raw.githubusercontent.com/**', r => r.abort());

  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  // Dialogs: each scenario queues its answers; anything unplanned is dismissed
  // and recorded as unexpected.
  const plan = [];
  const dialogs = [];
  const unexpected = [];
  page.on('dialog', async d => {
    dialogs.push({ type: d.type(), message: d.message() });
    const next = plan.shift();
    if(!next){ unexpected.push(d.message()); return d.dismiss(); }
    if(next.dismiss) return d.dismiss();
    return d.accept(next.value);
  });

  const status = () => page.evaluate(()=>{ const el = document.querySelector('#manageView .status-msg'); return el ? el.textContent : ''; });
  const RESULT = /Published to GitHub|changed on GitHub|didn’t accept|can’t change|Publish failed|Nothing to publish/;
  async function publish(){
    await page.evaluate(()=>{ const el = document.querySelector('#manageView .status-msg'); if(el) el.textContent = ''; });
    await page.click('#btnPublish');
    await page.waitForFunction(re => {
      const el = document.querySelector('#manageView .status-msg');
      return el && new RegExp(re).test(el.textContent);
    }, RESULT.source, { timeout: 10000 }).catch(()=>{});
    return status();
  }
  const store = () => page.evaluate(()=>({
    local: localStorage.getItem('sort.github'),
    session: sessionStorage.getItem('sort.github'),
    draft: localStorage.getItem('sort.definitions.v1'),
    base: localStorage.getItem('sort.definitions.base'),
    origin: defsOrigin,
    source: document.getElementById('sourceLabel').textContent,
    published: publishedText
  }));
  // An edit made the way the editor makes one: change, then the debounced save
  // (waited for in storage — the origin may already read "local").
  async function edit(label){
    await page.evaluate(l => { defs.tables[0].label = l; afterStructuralChange(); }, label);
    await page.waitForFunction(l => {
      const d = localStorage.getItem('sort.definitions.v1');
      return defsOrigin === 'local' && !!d && JSON.parse(d).tables[0].label === l;
    }, label, { timeout: 3000 });
  }

  /* ---- what "the same as GitHub" means: the app's own export of the file ---- */
  gh.fileText = fs.readFileSync(path.join(REPO_ROOT, 'definitions.json'), 'utf8');
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });
  const canonical = await page.evaluate(()=> definitionsFileText());
  // GitHub holds that file with an older date stamp, as it would a day later.
  gh.fileText = canonical.replace(/"updated": "\d{4}-\d{2}-\d{2}"/, '"updated": "2026-09-01"');
  gh.log.length = 0;

  /* ================= startup reads GitHub ================= */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });
  let s0 = await store();
  const bootRead = gh.log.find(l => l.path.startsWith(REPO + '/contents/definitions.json'));
  check('startup loads definitions.json from GitHub as the published copy',
        s0.origin === 'remote' && s0.source === 'Definitions: GitHub (published)');
  check('…through the contents API for main, as the raw file', bootRead && bootRead.path.endsWith('?ref=main') &&
        /application\/vnd\.github\.raw/.test(bootRead.accept));
  check('…anonymously while nothing is connected', bootRead && bootRead.auth === '');
  check('…and remembers the exact text it loaded (the base Publish checks against)', s0.published === gh.fileText);

  await page.evaluate(()=> setMode('manage'));
  const ui = await page.evaluate(()=>({
    publishBtn: (document.getElementById('btnPublish') || {}).textContent,
    conn: (document.querySelector('#manageView .gh-conn') || {}).textContent || '',
    history: (document.querySelector('#manageView .admin-note a') || {}).href,
    note: document.querySelector('#manageView .admin-note').textContent
  }));
  check('Manage Tables publishes to GitHub', ui.publishBtn === 'Publish to GitHub');
  check('…names the repo in its note', /cdomotor-g\/SoRT/.test(ui.note) && /definitions\.json/.test(ui.note));
  check('…links to the file\'s history for roll back',
        ui.history === 'https://github.com/cdomotor-g/SoRT/commits/main/definitions.json');
  check('…and shows GitHub as not connected', /not connected/.test(ui.conn) && /Connect/.test(ui.conn));

  /* ================= nothing to publish ================= */
  const putsBefore = gh.puts.length;
  const nothing = await publish();
  check('publishing an unchanged copy (only the date stamp differs) is refused as nothing to publish',
        /Nothing to publish/.test(nothing) && gh.puts.length === putsBefore && dialogs.length === 0);
  check('…without asking for a GitHub connection', !(await page.isVisible('.gh-connect')));

  /* ================= publishing needs a connection ================= */
  await edit('Rainfall Table (edited)');
  await page.click('#btnPublish');
  await page.waitForSelector('.gh-connect', { timeout: 5000 });
  const link = await page.getAttribute('.gh-connect a[href*="personal-access-tokens"]', 'href');
  const params = new URL(link).searchParams;
  check('Publish with no token opens "Connect to GitHub"', await page.isVisible('.gh-connect .gh-token'));
  check('…whose link pre-fills a fine-grained token: name, owner, one-year expiry, Contents write',
        link.startsWith('https://github.com/settings/personal-access-tokens/new?') &&
        params.get('name') === 'SoRT publishing' && params.get('target_name') === 'cdomotor-g' &&
        params.get('expires_in') === '366' && params.get('contents') === 'write');
  check('…and says which repository to pick', /Only select repositories/.test(await page.textContent('.gh-connect')) &&
        /SoRT/.test(await page.textContent('.gh-connect')));
  await page.click('.gh-connect .gh-cancel');
  await sleep(200);
  let s1 = await store();
  check('Cancel closes it, publishes nothing and keeps the edit',
        !(await page.isVisible('.gh-connect')) && gh.puts.length === putsBefore && s1.origin === 'local' && !!s1.draft);

  /* ================= the connect dialog checks the token ================= */
  const connectWith = async (token, remember)=>{
    await page.fill('.gh-connect .gh-token', token);
    await page.setChecked('.gh-connect .gh-remember-chk', remember !== false);
    await page.click('.gh-connect .gh-save');
    await page.waitForFunction(()=> !document.querySelector('.gh-connect') ||
      (document.querySelector('.gh-connect .gh-error').textContent !== '' && !document.querySelector('.gh-connect .gh-save').disabled),
      null, { timeout: 8000 });
    const open = await page.isVisible('.gh-connect');
    return { open, error: open ? await page.textContent('.gh-connect .gh-error') : '' };
  };
  await page.click('#btnGithubConnect');
  await page.waitForSelector('.gh-connect');
  const empty = await connectWith('');
  check('an empty token is refused', empty.open && /Paste the token first/.test(empty.error));
  const bad = await connectWith('github_pat_BAD');
  check('a token GitHub rejects is refused, and says so', bad.open && /didn’t accept that token/.test(bad.error));
  const ro = await connectWith('github_pat_READONLY');
  check('a read-only token is refused, with the setting to fix',
        ro.open && /can’t change cdomotor-g\/SoRT/.test(ro.error) && /Contents → Read and write/.test(ro.error));
  check('…and the write check changes nothing in the repo (an unreferenced empty blob, never a commit)',
        gh.log.some(l => l.method === 'POST' && l.path === REPO + '/git/blobs') && gh.puts.length === putsBefore);
  let s2 = await store();
  check('nothing is kept from a refused token', !s2.local && !s2.session);
  const good = await connectWith('github_pat_GOOD', false);
  let s3 = await store();
  check('a good token connects', !good.open);
  check('…kept for this tab only when "Remember" is unticked', !s3.local && s3.session && JSON.parse(s3.session).token === 'github_pat_GOOD');
  check('Manage Tables shows who is connected',
        /@cdomotor-g/.test(await page.textContent('#manageView .gh-conn')) && await page.isVisible('#btnGithubDisconnect'));

  /* ================= a publish, end to end ================= */
  // Work on the third table, to see the editor stay where it was.
  await page.evaluate(()=>{ selectedTableIndex = 2; renderManage(); });
  const expected = await page.evaluate(()=> definitionsFileText());
  const loadedSha = shaOf(gh.version);
  plan.push({ value: 'Add a test option' });
  const logBefore = gh.log.length;
  const done = await publish();
  const put = gh.puts[gh.puts.length - 1];
  const sent = put ? Buffer.from(put.body.content, 'base64').toString('utf8') : '';
  const calls = gh.log.slice(logBefore);
  let s4 = await store();
  check('Publish asks for a commit message', dialogs.length && dialogs[dialogs.length - 1].type === 'prompt' &&
        /commit message/.test(dialogs[dialogs.length - 1].message));
  check('it reads GitHub\'s current file first (JSON, with its sha), then PUTs', calls.length >= 2 &&
        calls[0].method === 'GET' && /application\/vnd\.github\+json/.test(calls[0].accept) &&
        calls[calls.length - 1].method === 'PUT');
  check('…both with the connected token', calls.every(c => c.auth === 'Bearer github_pat_GOOD'));
  check('the commit carries the message typed', put && put.body.message === 'Add a test option');
  check('…onto main', put && put.body.branch === 'main');
  check('…quoting the sha of the version it replaces', put && put.body.sha === loadedSha);
  check('…and the content is exactly what Export would download', sent === expected);
  check('…UTF-8 intact through base64 (emoji and en dashes)', /⚙️/.test(sent) && /–/.test(sent) && gh.fileText === expected);
  check('success names the commit', /Published to GitHub \(commit c0ffee0\)/.test(done));
  check('afterwards the definitions are the published copy, with no draft left',
        s4.origin === 'remote' && s4.source === 'Definitions: GitHub (published)' && !s4.draft && !s4.base);
  check('…the published text is the new base', s4.published === expected);
  check('…and the editor stayed on the table being worked on', await page.evaluate(()=> selectedTableIndex) === 2);

  /* ================= someone else changed it on GitHub ================= */
  gh.fileText = gh.fileText.replace('Rainfall Table (edited)', 'Rainfall Table (edited on github.com)');
  gh.version++;
  await edit('Rainfall Table (edited again)');
  plan.push({ value: 'Second change' });
  const putsC = gh.puts.length;
  const conflict = await publish();
  let s5 = await store();
  check('a file changed on GitHub since it was loaded is not overwritten', gh.puts.length === putsC &&
        /changed on GitHub since you loaded it/.test(conflict) && /Reload latest/.test(conflict));
  check('…and the edits are kept', s5.origin === 'local' && !!s5.draft &&
        JSON.parse(s5.draft).tables[0].label === 'Rainfall Table (edited again)');

  plan.push({ value: undefined });   // "discard your unpublished edits?" → OK
  await page.click('#btnReloadRemote');
  await page.waitForFunction(()=> defsOrigin === 'remote', null, { timeout: 8000 });
  check('Reload latest brings in the change made on GitHub',
        await page.evaluate(()=> defs.tables[0].label) === 'Rainfall Table (edited on github.com)');
  await edit('Rainfall Table (re-applied)');
  plan.push({ value: 'Re-applied' });
  const again = await publish();
  check('…after which the re-applied edit publishes', /Published to GitHub/.test(again) &&
        /Rainfall Table \(re-applied\)/.test(gh.fileText));

  /* ================= GitHub's own 409 ================= */
  await edit('Rainfall Table (race)');
  gh.failPut = { status: 409, message: 'definitions.json does not match' };
  plan.push({ value: 'Race' });
  const race = await publish();
  check('a 409 from GitHub (changed in between) reads as the same conflict',
        /changed on GitHub since you loaded it/.test(race) && !!(await store()).draft);

  /* ================= a token that stops working ================= */
  gh.failPut = { status: 403, message: 'Resource not accessible by personal access token' };
  plan.push({ value: 'Read-only' });
  const ro2 = await publish();
  let s6 = await store();
  check('a 403 explains the token needs Contents: Read and write, and keeps it',
        /can’t change cdomotor-g\/SoRT/.test(ro2) && /Contents: Read and write/.test(ro2) && !!s6.session && !!s6.draft);
  gh.failPut = { status: 401, message: 'Bad credentials' };
  plan.push({ value: 'Revoked' });
  const revoked = await publish();
  let s7 = await store();
  check('a 401 says the token was rejected and to connect again', /didn’t accept the saved token/.test(revoked) &&
        /Connect again/.test(revoked));
  check('…forgets that token and shows GitHub as not connected, keeping the edits',
        !s7.session && !s7.local && !!s7.draft && /not connected/.test(await page.textContent('#manageView .gh-conn')));

  /* ================= a draft resumed another day keeps its base ================= */
  // Connect for real (remembered), edit, and leave the edit unpublished.
  await page.click('#btnGithubConnect');
  await page.waitForSelector('.gh-connect');
  await connectWith('github_pat_GOOD', true);
  await edit('Rainfall Table (draft from yesterday)');
  const draftBase = (await store()).base;
  check('a saved draft remembers the published text it was edited from', draftBase === gh.fileText);
  // Meanwhile it changes on github.com; next day the app opens on the new copy.
  gh.fileText = gh.fileText.replace('Rainfall Table (re-applied)', 'Rainfall Table (changed overnight)');
  gh.version++;
  gh.log.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });
  const bootAuthed = gh.log.find(l => l.path.startsWith(REPO + '/contents/definitions.json'));
  check('with a remembered token, startup reads GitHub with it', bootAuthed && bootAuthed.auth === 'Bearer github_pat_GOOD');
  await page.evaluate(()=> setMode('manage'));
  check('the unpublished draft is offered back', await page.isVisible('#btnResumeDraft'));
  await page.click('#btnResumeDraft');
  plan.push({ value: 'Yesterday\'s draft' });
  const putsD = gh.puts.length;
  const stale = await publish();
  check('publishing the resumed draft is refused — GitHub moved on since it was made',
        gh.puts.length === putsD && /changed on GitHub since you loaded it/.test(stale));

  /* ================= a draft with no known base asks first ================= */
  await page.evaluate(()=>{ localStorage.removeItem('sort.definitions.base'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });
  await page.evaluate(()=> setMode('manage'));
  await page.click('#btnResumeDraft');
  check('(setup) a draft saved without its base resumes with no base', (await store()).published === null);
  plan.push({ dismiss: true });
  const putsE = gh.puts.length;
  await page.click('#btnPublish');
  await sleep(400);
  check('Publish asks before replacing the file when it can\'t check for changes',
        /Replace definitions\.json on GitHub/.test(dialogs[dialogs.length - 1].message) && gh.puts.length === putsE);
  plan.push({ value: undefined });            // replace it: OK
  plan.push({ value: 'Replace' });            // commit message
  const forced = await publish();
  check('…and on "OK" replaces it, quoting GitHub\'s current sha',
        /Published to GitHub/.test(forced) && gh.puts[gh.puts.length - 1].body.sha === shaOf(gh.version - 1) &&
        /draft from yesterday/.test(gh.fileText));

  /* ================= a published file broken by a hand edit loses nothing ================= */
  // Valid JSON with a tables array — so it downloads fine — but unusable: the
  // kind of slip a hand edit on github.com makes.
  await edit('Rainfall Table (precious draft)');
  const beforeBroken = await store();
  const goodText = gh.fileText;
  gh.fileText = '{"tables":[null]}';
  plan.push({ value: undefined });   // "discard your unpublished edits?" → OK
  await page.click('#btnReloadRemote');
  await page.waitForFunction(()=> /Reload failed/.test((document.querySelector('#manageView .status-msg') || {}).textContent || ''),
                             null, { timeout: 8000 }).catch(()=>{});
  const afterBroken = await store();
  check('Reload latest over a broken published file reports it and changes nothing',
        /Reload failed/.test(await status()) && /nothing was changed/.test(await status()));
  check('…the unpublished draft (and its base) survive it',
        afterBroken.draft === beforeBroken.draft && afterBroken.base === beforeBroken.base &&
        JSON.parse(afterBroken.draft).tables[0].label === 'Rainfall Table (precious draft)');
  check('…and the edits stay on screen, still unpublished',
        afterBroken.origin === 'local' && afterBroken.published === beforeBroken.published &&
        await page.evaluate(()=> defs.tables[0].label) === 'Rainfall Table (precious draft)');
  gh.fileText = goodText;

  /* ================= a rejected token must not stop anyone reading ================= */
  await page.evaluate(()=> localStorage.setItem('sort.github', JSON.stringify({ token: 'github_pat_BAD', login: 'x' })));
  gh.log.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rowsContainer .row', { timeout: 15000 });
  const reads = gh.log.filter(l => l.path.startsWith(REPO + '/contents/definitions.json'));
  check('startup with a rejected token retries without it and still loads the published copy',
        reads.length === 2 && reads[0].auth === 'Bearer github_pat_BAD' && reads[1].auth === '' &&
        (await store()).origin === 'remote');

  /* ================= Disconnect ================= */
  await page.evaluate(()=> localStorage.setItem('sort.github', JSON.stringify({ token: 'github_pat_GOOD', login: 'cdomotor-g' })));
  await page.evaluate(()=> setMode('manage'));
  plan.push({ value: undefined });
  await page.click('#btnGithubDisconnect');
  await sleep(200);
  let s8 = await store();
  check('Disconnect asks, then forgets the token', /Disconnect from GitHub/.test(dialogs[dialogs.length - 1].message) &&
        !s8.local && !s8.session && /not connected/.test(await page.textContent('#manageView .gh-conn')));

  check('no dialog appeared that the test did not expect', unexpected.length === 0);
  if(unexpected.length) console.log('unexpected dialogs:', unexpected);
  check('the retired Supabase store is never contacted', supabaseHits.length === 0);
  check('no uncaught page errors', pageErrors.length === 0);
  if(pageErrors.length) console.log('page errors:', pageErrors.slice(0, 3));

} catch(e){
  // A step that throws (a wait that never came true) must not hide the checks
  // already made: report it as a failure of its own and print the lot.
  check('the run reached the end without an exception — ' + String(e && e.message || e).split('\n')[0], false);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
for(const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if(failed.length){ process.exit(1); }
console.log('GitHub publish test: OK');
