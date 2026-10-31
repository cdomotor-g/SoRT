#!/usr/bin/env node
/* SoRT v2 — end-to-end checks in headless Chromium.

     cd SoRT && python3 -m http.server 8642 --bind 127.0.0.1 &
     node v2/tests/e2e.cjs [scenario ...]        # all scenarios when none named

   Scenarios: station, copy, playbook, editor, map. They use the live Flood-Net
   API (and, for "map", the Esri CDN and the Queensland map services); GitHub is
   always a stand-in (an in-memory contents API), so nothing is ever written.
   Needs Playwright: `npm i playwright` anywhere and point PLAYWRIGHT_PKG at it,
   or have it resolvable. PW_CHROMIUM pins a browser binary. BASE overrides
   the page address (default http://127.0.0.1:8642/v2/). */
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8642/v2/';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? '  ✓' : '  ✗'} ${what}`); if (!cond) failures++; };

// An in-memory GitHub contents API: the SoRT repo's v2/definitions.json and the playbook.
function fakeGithub(defsText) {
  const files = new Map([['SoRT/v2/definitions.json', { text: defsText, sha: 'd1' }]]);
  let n = 0;
  const reply = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: typeof obj === 'string' ? obj : JSON.stringify(obj) });
  const handler = async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/user') return reply(route, 200, { login: 'tester' });
    if (url.pathname === '/repos/cdomotor-g/SoRT-playbook') return reply(route, 200, { name: 'SoRT-playbook', private: true, permissions: { push: true } });
    const m = url.pathname.match(/^\/repos\/cdomotor-g\/(SoRT|SoRT-playbook)\/contents\/(.+)$/);
    if (!m) return route.abort();
    const key = `${m[1]}/${decodeURIComponent(m[2])}`, cur = files.get(key);
    if (req.method() === 'GET') {
      if (!cur) return reply(route, 404, { message: 'Not Found' });
      if (/raw/.test(req.headers().accept || '')) return reply(route, 200, cur.text);
      return reply(route, 200, { content: Buffer.from(cur.text).toString('base64'), encoding: 'base64', sha: cur.sha });
    }
    if (req.method() === 'PUT') {
      const b = JSON.parse(req.postData());
      if ((cur && b.sha !== cur.sha) || (!cur && b.sha)) return reply(route, 409, { message: 'conflict' });
      files.set(key, { text: Buffer.from(b.content, 'base64').toString('utf8'), sha: `s${++n}`, message: b.message });
      return reply(route, 200, { content: { sha: `s${n}` }, commit: { sha: `c${n}` } });
    }
    return route.abort();
  };
  return { files, handler };
}

async function page(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  if (o.token) await ctx.addInitScript(() => { try { localStorage.setItem('sort.github', JSON.stringify({ token: 'fake', login: 'tester' })); } catch (e) { /* */ } });
  const gh = fakeGithub(require('fs').readFileSync(require('path').join(__dirname, '..', 'definitions.json'), 'utf8'));
  await ctx.route(/api\.github\.com/, gh.handler);
  await ctx.route(o.map ? /raw\.githubusercontent\.com/ : /raw\.githubusercontent\.com|js\.arcgis\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('dialog', d => (d.type() === 'prompt' ? d.accept('Test change') : d.accept()));
  await p.goto(BASE, { waitUntil: 'load' });
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sortv2.')) localStorage.removeItem(k); });
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#stationSearch', { timeout: 20000 });
  p.gh = gh;
  p.pick = async q => {
    await p.fill('#stationSearch', q);
    await p.waitForSelector('#stationResults li', { timeout: 20000 });
    await p.click('#stationResults li');
    await p.waitForSelector('.station-card', { timeout: 40000 });
    await p.waitForTimeout(600);
  };
  p.newSession = async () => { await p.click('#sessionsBtn'); await p.click('#newSessionBtn'); };
  p.clip = () => p.evaluate(async () => { for (const it of await navigator.clipboard.read()) if (it.types.includes('text/html')) return (await it.getType('text/html')).text(); return ''; });
  return p;
}

const scenarios = {
  async station(b) {
    const p = await page(b);
    await p.pick('41506');
    ok((await p.textContent('.st-name')) === 'Bengalla TM', 'Bengalla TM found by its number');
    ok(/Water Level/.test(await p.textContent('.seg.on')), 'Water Level table suggested');
    ok((await p.$$eval('#q-currentComms .opt.on', e => e.map(x => x.textContent))).join() === 'IP logger – cellular', 'current comms guessed as cellular');
    await p.click('#q-comms .opt:has-text("Local Processing Unit")');
    ok((await p.$$eval('#q-commsChange .opt.on', e => e.map(x => x.textContent))).join() === 'Cellular → ERRTS', 'comms change worked out');
    ok((await p.$$eval('#followups .fu', e => e.map(x => x.textContent))).some(t => /ALERT IDs/.test(t) && /Brisbane Hub/.test(t)), 'ALERT IDs follow-up for the Brisbane Hub rep');
    await p.click('#q-comms .opt:has-text("IP Logger - Cellular")');
    ok((await p.$$eval('#q-txPower .opt.on', e => e.map(x => x.textContent))).join() === 'NA', 'TX power goes NA for an IP logger');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async copy(b) {
    const p = await page(b);
    await p.pick('540601');
    ok(/151\.525 MHz/.test(await p.innerText('.station-card')), 'frequency inferred from the listening repeaters');
    ok((await p.$$eval('#q-frequency .opt.on', e => e.map(x => x.textContent))).join() === '151.525 MHz', 'frequency filled in');
    await p.click('#q-acmaLicence .opt:has-text("transfer")');
    await p.fill('[data-fk="acmaLicence::f::licenceNo"]', '1441013/1'); await p.press('[data-fk="acmaLicence::f::licenceNo"]', 'Tab');
    await p.click('[data-ps="bridgeAttach"] .opt:has-text("Yes")');
    await p.waitForTimeout(400);
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok((html.match(/<table/g) || []).length >= 2, 'scope and Property Services tables copied');
    ok(/1441013\/1/.test(html) && /transfer ACMA licence/.test(html), 'licence and its follow-up in the copy');
    ok(/ACTION – Property Services/.test(html), 'bridge action in the Property Services table');
    await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.station-card', { timeout: 40000 });
    ok((await p.$eval('[data-fk="acmaLicence::f::licenceNo"]', e => e.value)) === '1441013/1', 'session survives a reload');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async playbook(b) {
    const p = await page(b, { token: true });
    await p.pick('540601');
    await p.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    await p.click('#q-stockFence .opt:has-text("Yes (standard")');
    await p.selectOption('#outcome', 'complete');
    await p.fill('[data-fk="installNotes::f::notes"]', 'Ring 0459 123 456'); await p.press('[data-fk="installNotes::f::notes"]', 'Tab');
    let warned = false; p.once('dialog', d => { warned = /phone number/.test(d.message()); });
    await p.waitForTimeout(400);
    await p.click('#playbookActs button');
    await p.waitForFunction(() => /Saved to the playbook|Couldn/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
    ok(warned, 'the privacy check caught the phone number');
    ok(p.gh.files.has('SoRT-playbook/stations/540601.json') && p.gh.files.has('SoRT-playbook/index.json'), 'station file and index written');
    await p.newSession(); await p.pick('540335');
    await p.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    await p.waitForTimeout(400);
    ok(/Fifteen Mile AL/.test(await p.innerText('#pbStrip')), 'Fifteen Mile offered as a similar station');
    await p.click('#pbStrip .pb-sim button'); await p.waitForTimeout(1200);
    ok((await p.$$eval('#q-stockFence .opt.on', e => e.map(x => x.className))).join().includes('from-precedent'), 'precedent answers marked Precedent');
    ok(!(await p.$eval('[data-fk="installNotes::f::notes"]', e => e.value)).includes('0459'), 'free-text notes never travel as a precedent');
    await p.newSession(); await p.pick('540601');
    await p.click('#pbStrip button:has-text("Continue")'); await p.waitForTimeout(2500);
    ok((await p.$$eval('.q.waiting .src', e => e.map(x => x.textContent))).some(t => /Earlier session/.test(t)), 'Continue carries answers over as Earlier session');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async editor(b) {
    const p = await page(b, { token: true });
    await p.click('#defsChip button');
    await p.click('.ed-list button:has-text("TX power")');
    const ta = await p.$('.ed-q textarea'); const v = await ta.inputValue();
    await ta.fill(v.replace('1W  [1w]', '1W  [1w]\n2W'));
    await p.click('.ed-q .btn-primary');
    await p.click('.ed-dlg .dlg-foot .btn-primary:has-text("Publish")');
    await p.waitForFunction(() => /Published|Couldn|Can’t|Someone/.test(document.querySelector('.ed-dlg .dlg-foot .hint').textContent), null, { timeout: 15000 });
    const pub = JSON.parse(p.gh.files.get('SoRT/v2/definitions.json').text);
    ok(pub.questions.txPower.options.map(o => o.code).join() === 'na,1w,2w,5w,25w,other_specify', 'new option added, existing codes kept');
    ok(pub.version === JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'definitions.json'), 'utf8')).version + 1, 'version bumped on publish');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async map(b) {
    const p = await page(b, { map: true });
    await p.pick('abergowrie bridge');
    await p.waitForFunction(() => { const s = document.querySelector('.map-status'); return s && s.hidden; }, null, { timeout: 90000 });
    await p.waitForFunction(() => document.querySelectorAll('.map-side .mark').length > 0, null, { timeout: 30000 });
    const side = await p.innerText('.map-side');
    ok(/PSM \d+/.test(side), 'survey marks listed');
    ok(/Abergowrie Bridge/.test(side) && /Transport and Main Roads/.test(side), 'the TMR bridge listed');
    await p.click('[data-ps="bridgeAttach"] .opt:has-text("Yes")');
    ok(/structure 7646/.test(await p.$eval('[data-fk="ps::bridgeAttach.detail"]', e => e.value)), 'bridge detail filled into Property Services');
    await p.$eval('#mapView', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
    const box = await (await p.$('#mapView')).boundingBox();
    await p.click('.loc[data-pin="relocation.newLocation"] button:has-text("Place")');
    await p.mouse.click(box.x + box.width / 2 + 150, box.y + box.height / 2 - 100);
    await p.waitForTimeout(1200);
    ok((await p.$$eval('#q-relocation .opt.on', e => e.map(x => x.textContent))).join() === 'Yes', 'placing the relocation site answers Relocation');
    ok(/^\d+$/.test(await p.$eval('[data-fk="relocation::f::distance"]', e => e.value)), 'relocation distance measured');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 90000 });
    const html = await p.clip();
    ok(/<img/.test(html) && /Survey marks near the station/.test(html), 'map picture and survey marks table copied');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  }
};

(async () => {
  const pick = process.argv.slice(2);
  const browser = await chromium.launch(Object.assign({ args: ARGS }, process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}));
  for (const [name, run] of Object.entries(scenarios)) {
    if (pick.length && !pick.includes(name)) continue;
    console.log(`▶ ${name}`);
    try { await run(browser); } catch (e) { ok(false, `${name} threw: ${e.message.split('\n')[0]}`); }
  }
  await browser.close();
  console.log(failures ? `✗ ${failures} check(s) failed` : '✓ all checks passed');
  process.exit(failures ? 1 : 0);
})();
