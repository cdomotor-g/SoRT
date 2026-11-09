#!/usr/bin/env node
/* SoRT v2 — end-to-end checks in headless Chromium.

     cd SoRT && python3 -m http.server 8642 --bind 127.0.0.1 &
     node v2/tests/e2e.cjs [scenario ...]        # all scenarios when none named

   Scenarios: oldforum, station, copy, playbook, shared, delete, editor, tasks, manual, particulars, bureau, layout, help, cutover, map, coast, soil, pictures. They use the live Flood-Net
   API (and, for "map", the Esri CDN and the Queensland map services); GitHub is
   always a stand-in (an in-memory contents API), so nothing is ever written.
   "coast" gives QSpatial's coastline a stand-in too: one straight shore, so the
   distances (and the corrosion category they suggest) are known.
   "soil" does the same for Queensland's acid sulfate soil maps.
   "pictures" pastes made-up snips (drawn on a canvas) into question cards.
   Needs Playwright: `npm i playwright` anywhere and point PLAYWRIGHT_PKG at it,
   or have it resolvable. PW_CHROMIUM pins a browser binary. BASE overrides
   the page address (default http://127.0.0.1:8642/v2/). STUB_IMAGERY=1 gives
   the State's imagery tiles a stand-in (random-coloured squares), for when the
   imagery server won't serve this computer and "map" fails with "the map
   hadn't finished drawing" — everything else on the map stays live.
   E2E_STACK=1 prints where in the page's code a page error came from. */
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8642/v2/';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? '  ✓' : '  ✗'} ${what}`); if (!cond) failures++; };
// Wait (up to ms) for a check that is done outside the page — the fake store's files.
const until = async (fn, ms) => { const end = Date.now() + (ms || 10000); for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await new Promise(r => setTimeout(r, 200)); } };

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

// Flood-Net's shared session store (floodwarning.net/api/sort/v1), in memory:
// the forum passphrase is TEST-PASS; files carry ETags; If-Match / If-None-Match.
function fakeStore() {
  const files = new Map(); let n = 0; let puts = 0; let failPuts = 0;
  const log = [];   // "PUT files/index.json", … — every request after the passphrase
  const crypto = require('crypto');
  const N = p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let hash = crypto.createHash('sha256').update('sort-forum-v1:' + N('TEST-PASS')).digest('hex');
  const reply = (route, status, body, headers) => route.fulfill({ status, contentType: 'application/json', headers: Object.assign({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag' }, headers || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
  const handler = async route => {
    const req = route.request(), url = new URL(req.url()), H = req.headers();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-sort-passphrase, if-match, if-none-match', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Expose-Headers': 'ETag' } });
    if (crypto.createHash('sha256').update('sort-forum-v1:' + N(H['x-sort-passphrase'])).digest('hex') !== hash) return reply(route, 401, { error: 'passphrase' });
    const path = url.pathname.replace(/^\/api\/sort\/v1\//, '');
    log.push(`${req.method()} ${path}`);
    if (req.method() === 'PUT' && path.startsWith('files/') && failPuts > 0) { failPuts--; return reply(route, 503, { error: 'busy' }); }
    if (path === 'check') return reply(route, 200, { ok: true });
    if (path === 'passphrase' && req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (!/^[0-9a-f]{64}$/.test(b.sha256 || '')) return reply(route, 400, { error: 'sha256' }); hash = b.sha256; return reply(route, 200, { ok: true }); }
    const m = path.match(/^files\/(index\.json|stations\/[a-z0-9][a-z0-9-]*\.json)$/);
    if (!m) return reply(route, 400, { error: 'path' });
    const cur = files.get(m[1]);
    // Like the real thing behind Cloudflare: the ETag header comes back weak
    // (W/"…") on a compressed answer, and a save that quotes a weak tag is
    // refused — the tag under the W/ (quoted or bare) is the one to send.
    const given = String(H['if-match'] || '').replace(/^"(.*)"$/, '$1');
    if (req.method() === 'GET') return cur ? reply(route, 200, cur.text, { ETag: `W/${cur.etag}` }) : reply(route, 404, { error: 'not found' });
    if (req.method() === 'PUT') {
      if (cur ? (H['if-match'] == null || given !== cur.etag.replace(/"/g, '')) : H['if-none-match'] !== '*') return reply(route, 412, { error: 'changed' });
      const etag = `"e${++n}"`; puts++;
      files.set(m[1], { text: req.postData(), etag });
      return reply(route, 200, { etag }, { ETag: `W/${etag}` });
    }
    return reply(route, 405, { error: 'method' });
  };
  return { files, handler, puts: () => puts, log, failPuts: k => { failPuts = k; } };
}

// A 256×256 PNG of random-ish colours, made with Node alone: the stand-in imagery tile.
function standInTile() {
  const zlib = require('zlib');
  const crc32 = buf => { let crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { let c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const W = 256, H = 256, raw = Buffer.alloc((W * 3 + 1) * H);
  let r = 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { r = (r * 1103515245 + 12345) & 0x7fffffff; const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = 60 + (r % 90); raw[o + 1] = 90 + ((r >> 8) % 90); raw[o + 2] = 50 + ((r >> 16) % 60); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function page(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1360, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  if (o.token) await ctx.addInitScript(() => { try { localStorage.setItem('sort.github', JSON.stringify({ token: 'fake', login: 'tester' })); } catch (e) { /* */ } });
  if (o.autosaveMs) await ctx.addInitScript(ms => { window.SORT_AUTOSAVE_MS = ms; }, o.autosaveMs);
  if (o.retryMs) await ctx.addInitScript(ms => { window.SORT_RETRY_MS = ms; }, o.retryMs);
  let defsText = require('fs').readFileSync(require('path').join(__dirname, '..', 'definitions.json'), 'utf8');
  if (o.defsPatch) { const d = JSON.parse(defsText); o.defsPatch(d); defsText = JSON.stringify(d); }
  const gh = fakeGithub(defsText);
  await ctx.route(/api\.github\.com/, gh.handler);
  const store = o.store || fakeStore();   // o.store: another computer on the same saved sessions
  await ctx.route(/floodwarning\.net\/api\/sort\//, store.handler);
  if (o.pass) await ctx.addInitScript(() => { try { localStorage.setItem('sortv2.passphrase', 'TESTPASS'); } catch (e) { /* */ } });
  if (o.coast) await ctx.route(/CoastalWaters\/MapServer\/17\/query/, o.coast);
  if (o.soil) await ctx.route(/SoilsAndLandResource\/MapServer\/\d+\/query/, o.soil);
  await ctx.route(o.map ? /raw\.githubusercontent\.com/ : /raw\.githubusercontent\.com|js\.arcgis\.com/, r => r.abort());
  if (process.env.STUB_IMAGERY) { const tile = standInTile(); await ctx.route(/spatial-img\.information\.qld\.gov\.au\/.*\/tile\//, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: tile })); }
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(process.env.E2E_STACK ? e.stack : e.message));
  p.on('dialog', d => (d.type() === 'prompt' ? d.accept('Test change') : d.accept()));
  await p.goto(BASE, { waitUntil: 'load' });
  // A clean browser — but past the first-visit Help nudge, so its toast never
  // lands on top of a toast a check is waiting for (the help scenario wants it).
  await p.evaluate(fresh => { for (const k of Object.keys(localStorage)) if (k.startsWith('sortv2.')) localStorage.removeItem(k); if (!fresh) localStorage.setItem('sortv2.helpSeen', '1'); }, !!o.freshHelp);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#stationSearch', { timeout: 20000 });
  p.gh = gh; p.store = store;
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
    // The radio path: on the Fade Margin question only (off the station card since 9 Nov 2026).
    // Every saved figure is stale today, so it's shown, flagged, and not used as an answer.
    ok(!/Radio path/.test(await p.innerText('.station-card')), 'no radio path on the station card');
    // A rainfall table: no State survey marks (they tie a water level gauge to AHD), and Property Services' water level rows are NA, shown as chosen.
    ok(await p.evaluate(() => !SoRT.mapView._M.marks.length && !SoRT.app.session.map.marks.length) && !/State survey marks table/.test(await p.innerText('#outputControls')), 'a rainfall table asks for no survey marks, and offers no marks table');
    ok((await p.innerText('[data-ps="orificeReplace"] .opt.on')).trim() === 'NA' && await p.$eval('[data-ps="orificeDirection"] input', e => e.value) === 'NA', 'Property Services: the water level rows are NA, chosen for you');
    ok(/Should not normally need changing/.test(await p.innerText('[data-ps="date"]')), 'Property Services: the date says it should not normally need changing');
    ok(!(await p.isChecked('#outputControls label:has-text("Rows with nothing filled in") input')), 'rows with nothing filled in: unticked by default');
    await p.click('#outputControls label:has-text("Rows with nothing filled in") input');
    ok(await p.evaluate(() => localStorage.getItem('sortv2.pref.empty') === '1' && SoRT.store.newSession(SoRT.app.defs).include.empty === true), 'ticked: this browser remembers it for new sessions');
    await p.click('#outputControls label:has-text("Rows with nothing filled in") input');
    const fm = await p.innerText('#q-fadeMargin [data-hint="station.fadeMargin"]').catch(() => '');
    ok(/Fifteen Mile AL → Toowoomba AL \([+−]?[\d.]+ dB\) → /.test(fm), 'fade margin question shows the path to base, hop by hop');
    ok(/Stale/.test(fm) ? /not a pass or fail/.test(fm) : true, 'stale figures are flagged as a rough guide');
    ok(/Measured on site/.test(fm), 'the attenuator test measured on site is shown');
    ok(/stations&station=fifteen_mile_al/.test(await p.getAttribute('#q-fadeMargin .hint-link', 'href')), 'and links to the station on Flood-Net’s map');
    ok(/Stale/.test(fm) ? !(await p.$$eval('#q-fadeMargin .opt.on', e => e.length)) : true, 'stale figures don’t answer the question');
    ok(/Stale/.test(fm) || (await p.$$eval('#q-fadeMargin .opt.on', e => e.map(x => x.textContent))).join() === 'Yes', 'fresh figures over 20 dB on its own hop fill in Yes, to confirm');
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
    ok(/Rainfall Table — Fifteen Mile AL \(540601\)/.test(html), 'station name and number on the scope table heading');
    ok(/Property Services Instruction — Fifteen Mile AL \(540601\)/.test(html), 'and on the Property Services heading');
    ok(/background:#c55a11[^>]*>IMPORTANT NOTE</.test(html) && /<b>If there have been any changes to the coordinates[^<]*<a href="mailto:FWINLeasing@bom\.gov\.au">/.test(html) && !/\*\*/.test(html), 'the Property Services note is highlighted, its instruction bold, the address a link');
    ok(/IMPORTANT NOTE/.test(await p.innerText('#sec-ps .ps-note')) && (await p.$$eval('#sec-ps .ps-note b', e => e.length)) === 1, 'and stands out on screen too');
    await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.station-card', { timeout: 40000 });
    ok((await p.$eval('[data-fk="acmaLicence::f::licenceNo"]', e => e.value)) === '1441013/1', 'session survives a reload');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async playbook(b) {
    const p = await page(b, { pass: true });
    await p.pick('540601');
    await p.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    await p.click('#q-stockFence .opt:has-text("Yes (standard")');
    await p.selectOption('#outcome', 'complete');
    await p.fill('[data-fk="installNotes::f::notes"]', 'Ring 0459 123 456'); await p.press('[data-fk="installNotes::f::notes"]', 'Tab');
    ok(!(await p.$('#playbookActs button')), 'no Share button: it is saved by itself');
    await p.waitForSelector('#saveBar button:has-text("save it anyway")', { timeout: 15000 });
    ok(/phone number/.test(await p.innerText('#saveBar')) && /Not saved/.test(await p.innerText('#shareChip')), 'the phone number holds it back, and the top bar says it isn’t shared');
    let warned = false; p.once('dialog', d => { warned = /phone number/.test(d.message()); });
    await p.click('#saveBar button:has-text("save it anyway")');
    await p.waitForFunction(() => /Saved to the forum|Couldn/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
    ok(warned, 'save it anyway asks first');
    ok(p.store.files.has('stations/540601.json') && p.store.files.has('index.json'), 'station file and index written to the shared store');
    await p.fill('[data-fk="installNotes::f::notes"]', 'Ring 0459 123 456 after 5pm'); await p.press('[data-fk="installNotes::f::notes"]', 'Tab');
    ok(await until(() => /after 5pm/.test(p.store.files.get('stations/540601.json').text), 15000) && await p.$eval('#saveBar', e => e.hidden), 'once a person has said yes, the same text isn’t held back again');
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
  async shared(b) {
    // Not connected: the page says the session is only in this browser.
    const n = await page(b);
    await n.pick('540601');
    await n.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    ok(/Only in this browser/.test(await n.innerText('#shareChip')), 'the top bar says it is only in this browser');
    ok(/Saved only in this browser/.test(await n.innerText('#saveBar')) && await n.isVisible('#saveBar button:has-text("Enter the forum passphrase")'), 'no passphrase: a warning that it is only in this browser');
    await n.click('#saveBar button:has-text("Enter the forum passphrase")');
    await n.fill('#passInput', 'nope-nope'); await n.press('#passInput', 'Enter');
    await n.waitForFunction(() => /isn’t the forum passphrase/.test(document.querySelector('#passMsg').textContent), null, { timeout: 8000 });
    ok(true, 'a wrong passphrase is refused');
    await n.fill('#passInput', ' test-pass '); await n.press('#passInput', 'Enter');
    await n.waitForFunction(() => document.querySelector('#saveBar').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await n.evaluate(() => localStorage.getItem('sortv2.passphrase')) === 'TESTPASS' && await n.$eval('#saveBar', e => e.hidden), 'the right one (typed loosely) is remembered and the warning goes');
    ok(await until(() => n.store.files.has('stations/540601.json')), 'the session answered before the passphrase is saved by itself once it is typed');
    // Changing it: only its fingerprint leaves, and the old one stops working.
    await n.click('#sessionsBtn'); await n.click('#changePass');
    await n.fill('#passNew', 'short'); await n.fill('#passNew2', 'short'); await n.click('.pass-dlg .btn-primary');
    ok(/longer/.test(await n.textContent('#passNewMsg')), 'a short new passphrase is refused');
    await n.fill('#passNew', 'Wombats queue politely at the river ford'); await n.fill('#passNew2', 'wombats queue politely, at the river ford.');
    await n.click('.pass-dlg .btn-primary');
    await n.waitForFunction(() => /passphrase changed/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 });
    ok(await n.evaluate(() => localStorage.getItem('sortv2.passphrase')) === 'WOMBATSQUEUEPOLITELYATTHERIVERFORD', 'changed: this computer keeps the new one');
    ok(await n.evaluate(async () => (await SoRT.shared.check('TESTPASS')) === 'wrong' && (await SoRT.shared.check('WOMBATSQUEUEPOLITELYATTHERIVERFORD')) === 'ok'), 'the old one is refused, the new one works');

    await n.context().close();
    // Connected: it saves to the shared playbook by itself.
    const p = await page(b, { pass: true, autosaveMs: 800, retryMs: 1000 });
    await p.waitForFunction(() => document.querySelector('#saveBar').hidden, null, { timeout: 10000 });
    ok(true, 'connected: no warning bar');
    await p.pick('540601');
    await p.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    await p.click('#q-stockFence .opt:has-text("Yes (standard")');
    await p.waitForFunction(() => /playbook/.test(document.querySelector('#savedChip').textContent), null, { timeout: 15000 }).catch(() => {});
    ok(p.store.files.has('stations/540601.json') && p.store.files.has('index.json'), 'saved to the forum by itself, with no button');
    await p.waitForFunction(() => /✓ Saved/.test(document.querySelector('#shareChip').textContent), null, { timeout: 8000 }).catch(() => {});
    ok(!(await p.$('#playbookActs button')) && /Saved to the forum by itself/.test(await p.innerText('#shareState')) && /✓ Saved/.test(await p.innerText('#shareChip')), 'no Share button; it says it is shared, at the top and under Copy for Word');
    const first = JSON.parse(p.store.files.get('stations/540601.json').text).sessions[0].id;
    const station = () => JSON.parse(p.store.files.get('stations/540601.json').text);
    const answer = (c, f) => { const x = (station().sessions.find(z => z.id === first) || {}).session; return x && x.answers[c] ? x.answers[c].value : undefined; };
    // A change that leaves the index line alone: one request — the station's file, nothing read first.
    let mark = p.store.log.length;
    await p.click('#q-stockFence .opt:has-text("No")');
    ok(await until(() => answer('stockFence') === 'no'), 'a change is saved by itself');
    await p.waitForTimeout(400);
    ok(p.store.log.slice(mark).join() === 'PUT files/stations/540601.json', `one request for it: the station’s file, not read first, index untouched (${p.store.log.slice(mark).join(', ')})`);
    // Nothing really changed: nothing is sent.
    mark = p.store.log.length;
    await p.evaluate(() => SoRT.app.changed({ light: true }));
    await p.waitForTimeout(2500);
    ok(p.store.log.length === mark, 'a change that changes nothing sends nothing');
    // A change to what the index lists: the index too.
    mark = p.store.log.length;
    await p.click('#q-complexity .opt:has-text("Vegetation")');
    ok(await until(() => p.store.log.slice(mark).includes('PUT files/index.json')), 'a change to what the shared list shows rewrites the index too');
    // Another computer saved the station in between: read it again, keep theirs, add ours.
    await p.waitForTimeout(600);
    const f0 = p.store.files.get('stations/540601.json'), other = JSON.parse(f0.text);
    other.sessions.push({ id: 'other-computer', source: 'sort-v2', forum: { date: '2026-01-01' }, summary: { answers: {} } });
    p.store.files.set('stations/540601.json', { text: JSON.stringify(other), etag: '"elsewhere"' });
    mark = p.store.log.length;
    await p.click('#q-stockFence .opt:has-text("Yes (standard")');
    ok(await until(() => answer('stockFence') === 'yes_standard_dimensions_and_configuration', 10000) && station().sessions.some(z => z.id === 'other-computer'), 'saved by another computer in between: both kept');
    ok(/PUT files\/stations\/540601\.json,GET files\/stations\/540601\.json,PUT files\/stations\/540601\.json/.test(p.store.log.slice(mark).join()), 'it was refused once, read again, and written');
    const tidy = station(); tidy.sessions = tidy.sessions.filter(z => z.id !== 'other-computer');
    p.store.files.set('stations/540601.json', { text: JSON.stringify(tidy), etag: '"tidied"' });
    // The server busy: it tries again by itself.
    p.store.failPuts(1);
    await p.click('#q-stockFence .opt:has-text("No")');
    ok(await until(() => answer('stockFence') === 'no', 15000), 'Flood-Net’s server busy for a moment: shared when it tries again by itself');
    // A Bureau number corrected: the session leaves the old station’s file for the new one.
    await p.evaluate(() => { SoRT.app.session.station.number = '540699'; SoRT.app.changed({ light: true }); });
    ok(await until(() => p.store.files.has('stations/540699.json') && JSON.parse(p.store.files.get('stations/540699.json').text).sessions.some(z => z.id === first) && !station().sessions.some(z => z.id === first)), 'a corrected number moves it to the right station');
    await p.evaluate(() => { SoRT.app.session.station.number = '540601'; SoRT.app.changed({ light: true }); });
    ok(await until(() => station().sessions.some(z => z.id === first) && !JSON.parse(p.store.files.get('index.json').text).stations.some(e => e.key === '540699')), 'and back, leaving nothing in the shared list under the wrong number');
    await p.fill('[data-fk="installNotes::f::notes"]', 'Ring 0459 123 456'); await p.press('[data-fk="installNotes::f::notes"]', 'Tab');
    await p.waitForFunction(() => /Not saved to the forum:/.test(document.querySelector('#saveBar').textContent), null, { timeout: 8000 }).catch(() => {});
    ok(/Not saved to the forum:/.test(await p.innerText('#saveBar')) && /phone number/.test(await p.innerText('#saveBar')), 'a phone number holds it, and the bar says why');
    ok(!/0459/.test(p.store.files.get('stations/540601.json').text), 'nothing private was shared');
    await p.fill('[data-fk="installNotes::f::notes"]', 'Ring the hub before visiting'); await p.press('[data-fk="installNotes::f::notes"]', 'Tab');
    await p.waitForFunction(() => document.querySelector('#saveBar').hidden, null, { timeout: 8000 }).catch(() => {});
    ok(/Ring the hub/.test(p.store.files.get('stations/540601.json').text), 'once it is removed, it is shared again');
    // The same station again: the card says it already has a session, and Sessions finds it.
    await p.newSession(); await p.pick('540601');
    await p.waitForSelector('#dupNote:not([hidden])', { timeout: 8000 });
    ok(/already has (a session|sessions)/.test(await p.innerText('#dupNote')) && /saved to the forum/.test(await p.innerText('#dupNote')), 'picking it again warns that a session already exists');
    await p.click('#dupNote button:has-text("Show its sessions")');
    ok(await p.evaluate(() => document.querySelector('#sessionsDlg').open) && (await p.inputValue('#sessionsSearch')) === '540601', 'which opens Sessions, searched for the station');
    const res = await p.innerText('#sessionsResults');
    ok(/In this browser[\s\S]*Fifteen Mile AL[\s\S]*Saved to the forum[\s\S]*Fifteen Mile AL/.test(res), 'its sessions are listed, here and saved to the forum');
    await p.fill('#sessionsSearch', 'zzz');
    ok(!/Fifteen Mile AL/.test(await p.innerText('#sessionsResults')), 'the search narrows the list');
    await p.fill('#sessionsSearch', 'fifteen');
    await p.click('.pb-panel .sess button:has-text("Open")');
    await p.waitForTimeout(800);
    ok(await p.evaluate(id => SoRT.app.session.id === id, first) && (await p.$$eval('#q-stockFence .opt.on', e => e.length)) === 1, 'Open carries on with that saved session itself');
    // A precedent: another station filled from this one, orange until checked, then green.
    await p.newSession(); await p.pick('540335');
    await p.click('#sessionsBtn'); await p.fill('#sessionsSearch', 'fifteen');
    await p.click('.pb-panel .sess button:has-text("Use as a precedent")');
    await p.waitForTimeout(1500);
    ok((await p.$$('.q.waiting')).length >= 2 && (await p.$$eval('#q-stockFence .opt.on', e => e.map(x => x.className))).join().includes('from-precedent'), 'Use as a precedent fills its answers, each waiting to be checked');
    ok(await p.$eval('#q-stockFence', e => getComputedStyle(e, '::before').backgroundColor) === 'rgb(224, 122, 16)', 'orange until checked');
    await p.click('#q-stockFence .src-ok');
    ok(await p.$eval('#q-stockFence', e => e.classList.contains('checked') && getComputedStyle(e, '::before').backgroundColor !== 'rgb(224, 122, 16)') && /✓ checked · Precedent/.test(await p.innerText('#q-stockFence')), 'then green, marked checked');
    // Water level: the corrosion categories (radios) and the three stainless-steel tick boxes they set.
    await p.newSession(); await p.pick('41506');
    const opts = await p.$$eval('#q-infraOptions .opts:not(.choice) .opt', e => e.map(x => x.textContent.trim()));
    ok(opts.join('|') === 'Stainless steel tower with stainless steel fixtures and fittings|Stainless steel enclosure with stainless steel fixtures and fittings|Stainless steel orifice run (capillary conduit) with stainless steel fixtures and fittings' && await p.$$eval('#q-infraOptions .opts:not(.choice) input', e => e.every(x => x.type === 'checkbox')), 'water level infrastructure options: three tick boxes');
    ok((await p.$$eval('#q-infraOptions .choice .opt', e => e.map(x => x.textContent.trim()))).join('|') === 'C3 and below — standard|C4 — stainless enclosure and orifice run|C5 and CX — all stainless|Custom' && await p.$$eval('#q-infraOptions .choice input', e => e.every(x => x.type === 'radio')), 'and the corrosion categories as radios, with Custom');
    await p.click('#q-infraOptions .choice .opt:has-text("C4")');
    ok((await p.$$eval('#q-infraOptions .opts:not(.choice) .opt.on', e => e.map(x => x.textContent))).join('|') === 'Stainless steel enclosure with stainless steel fixtures and fittings|Stainless steel orifice run (capillary conduit) with stainless steel fixtures and fittings', 'C4 ticks the enclosure and the orifice run');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok(/Corrosion category: C4 — stainless enclosure and orifice run/.test(html) && /Standard galvanised tower/.test(html) && /Stainless steel enclosure with stainless steel fixtures and fittings/.test(html) && /Stainless steel orifice run \(capillary conduit\) with stainless steel fixtures and fittings/.test(html), 'the category and every part go into Word');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async delete(b) {
    // Not connected: a session only in this browser — Delete, then Confirm delete.
    const n = await page(b);
    await n.pick('540601');
    await n.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    const lone = await n.evaluate(() => SoRT.app.session.id);
    await n.click('#sessionsBtn');
    ok((await n.textContent('#sessionsTitle')) === 'Sessions Management', 'the window is called Sessions Management');
    ok(!/Forget/.test(await n.innerText('#sessionsResults')), 'no Forget button any more');
    await n.click('#sessionsResults .sess.current button:has-text("Delete")');
    ok(/only in this browser, so it will be gone for good/.test(await n.innerText('.sess-confirm')) && await n.evaluate(() => document.activeElement.textContent === 'Cancel'), 'Delete asks first, says what goes, and the keyboard lands on Cancel');
    await n.click('.sess-confirm button:has-text("Cancel")');
    ok(!(await n.$('.sess-confirm')) && await n.evaluate(id => !!SoRT.store.load(id), lone), 'Cancel deletes nothing');
    await n.click('#sessionsResults .sess.current button:has-text("Delete")');
    await n.click('.sess-confirm button:has-text("Confirm delete")');
    await n.waitForTimeout(400);
    ok(await n.evaluate(id => !SoRT.store.load(id) && SoRT.app.session.id !== id && !SoRT.store.index().some(x => x.id === id), lone), 'Confirm delete: gone from this browser (not saved back on the way out), a new session on screen');
    await n.context().close();

    // Connected: two computers on the same saved sessions.
    const p = await page(b, { pass: true, autosaveMs: 800, retryMs: 1000 });
    await p.pick('540601');
    await p.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    const file = k => p.store.files.has(`stations/${k}.json`) ? JSON.parse(p.store.files.get(`stations/${k}.json`).text) : null;
    const index = () => JSON.parse(p.store.files.get('index.json').text).stations;
    const first = await p.evaluate(() => SoRT.app.session.id);
    ok(await until(() => (file('540601') || { sessions: [] }).sessions.some(z => z.id === first)), 'a session saved to the forum');
    const q = await page(b, { pass: true, autosaveMs: 800, retryMs: 1000, store: p.store });
    await q.click('#sessionsBtn'); await q.fill('#sessionsSearch', 'fifteen');
    await q.click('.pb-panel .sess button:has-text("Open")');
    ok(await until(() => q.evaluate(id => SoRT.app.session.id === id, first)), 'the other computer has it open');
    // This computer deletes it everywhere.
    await p.click('#sessionsBtn');
    await p.click('#sessionsResults .sess.current button:has-text("Delete")');
    ok(/from this browser and from the forum’s saved sessions/.test(await p.innerText('.sess-confirm')) && await p.isVisible('.sess-confirm button:has-text("Only from this browser")'), 'shared: it says it goes from the forum too, and offers Only from this browser');
    await p.click('.sess-confirm button:has-text("Confirm delete")');
    ok(await until(() => !file('540601').sessions.some(z => z.id === first) && (file('540601').deleted || []).some(d => d.id === first) && !index().some(e => e.key === '540601')), 'Confirm delete: out of the station’s file (noted as deleted) and out of the shared list');
    ok(await p.evaluate(id => !SoRT.store.load(id) && SoRT.app.session.id !== id, first), 'and out of this browser, with a new session on screen');
    ok(!/Fifteen Mile AL/.test(await p.innerText('.pb-panel')), 'the shared list no longer shows it');
    // The other computer, still on it: a change there doesn't share it back.
    await q.keyboard.press('Escape').catch(() => {});
    await q.click('#q-stockFence .opt:has-text("No")');
    ok(await until(() => q.evaluate(() => /Deleted from the forum/.test(document.querySelector('#saveBar').textContent))), 'the other computer says it was deleted from the forum');
    ok(!file('540601').sessions.some(z => z.id === first) && /Deleted from the forum/.test(await q.innerText('#shareChip')), 'and doesn’t share it back by itself');
    await q.click('#saveBar button:has-text("Save it again")');
    ok(await until(() => file('540601').sessions.some(z => z.id === first) && !(file('540601').deleted || []).some(d => d.id === first) && index().some(e => e.key === '540601')), 'Save it again puts it back, in the shared list too');
    // A shared row: Delete reads the station's sessions, then asks.
    p.store.files.set('stations/540601.json', { text: JSON.stringify(Object.assign(file('540601'), { sessions: [{ id: 'earlier-one', source: 'sort-v2', forum: { date: '2026-01-01' }, outcome: 'complete', summary: { answers: {} } }].concat(file('540601').sessions) })), etag: '"two"' });
    await q.click('#sessionsBtn'); await q.fill('#sessionsSearch', 'fifteen');
    await q.click('.pb-panel .sess button:has-text("Delete")');
    await q.waitForSelector('.pb-panel .sess-confirm button:has-text("Confirm delete")', { timeout: 8000 });
    ok(/last session[\s\S]*1 earlier session stays/.test(await q.innerText('.pb-panel .sess-confirm')) && await q.isVisible('.pb-panel .sess-confirm button:has-text("Delete all 2")'), 'a station with two: Confirm delete takes its last one, or Delete all 2');
    await q.click('.pb-panel .sess-confirm button:has-text("Confirm delete")');
    ok(await until(() => file('540601').sessions.map(z => z.id).join() === 'earlier-one' && index().some(e => e.key === '540601' && e.sessions === 1)), 'its last session goes; the earlier one stays, and the list says 1');
    ok(await q.evaluate(id => SoRT.app.session.id !== id && !SoRT.store.load(id), first), 'the session it had open was that one: a new session on screen');
    await q.click('.pb-panel .sess button:has-text("Delete")');
    await q.waitForSelector('.pb-panel .sess-confirm button:has-text("Confirm delete")', { timeout: 8000 });
    await q.click('.pb-panel .sess-confirm button:has-text("Cancel")');
    ok(!(await q.$('.sess-confirm')) && file('540601').sessions.length === 1, 'Cancel on a shared row deletes nothing');
    // Only from this browser: the forum keeps it.
    await p.keyboard.press('Escape').catch(() => {});
    await p.pick('540335');
    await p.click('#q-complexity .opt:has-text("Moderate Complexity Total Rebuild – Type 2")');
    const second = await p.evaluate(() => SoRT.app.session.id);
    ok(await until(() => (file('540335') || { sessions: [] }).sessions.some(z => z.id === second)), 'another session shared');
    await p.click('#sessionsBtn');
    await p.click('#sessionsResults .sess.current button:has-text("Delete")');
    await p.click('.sess-confirm button:has-text("Only from this browser")');
    await p.waitForTimeout(1500);
    ok(await p.evaluate(id => !SoRT.store.load(id) && SoRT.app.session.id !== id, second) && file('540335').sessions.some(z => z.id === second) && !(file('540335').deleted || []).length, 'Only from this browser: gone here, kept by the forum');
    ok(!p.errors.length && !q.errors.length, `no page errors ${p.errors.concat(q.errors).join('; ')}`);
    await q.context().close();
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
  async tasks(b) {
    const p = await page(b, { defsPatch: d => { d.tasks.enabled = true; } });
    await p.pick('41506');
    await p.click('#q-comms .opt:has-text("Local Processing Unit")');
    await p.click('#q-remediation .opt:has-text("Vegetation management")');
    await p.waitForTimeout(400);
    const teams = await p.$$eval('#followups .fu-task select', e => e.map(x => x.selectedOptions[0].textContent));
    // The local TBM: a desktop task until it's entered, never offered to Flood-Net.
    const tbmFu = await p.$$eval('#followups .fu', e => e.filter(x => /DESKTOP TASK/.test(x.textContent)).map(x => ({ desk: !!x.querySelector('.fu-desk'), send: !!x.querySelector('.fu-task') })));
    ok(tbmFu.length === 1 && tbmFu[0].desk && !tbmFu[0].send, 'local TBM: a desktop task, with no Send to Flood-Net');
    ok(teams.includes('Brisbane Hub') && teams.includes('SoRT Forum'), `teams suggested (${teams.join(', ')})`);
    await p.click('#followups .fu-add summary');
    await p.fill('#followups .fu-add input[type=text]', 'Check the gauge board datum');
    await p.selectOption('#followups .fu-add select', 'name:OTE');
    await p.click('#followups .fu-add .btn-primary');
    await p.waitForTimeout(300);
    const [tab] = await Promise.all([p.context().waitForEvent('page'), p.click('#followups .out-acts .btn')]);
    const url = tab.url();
    const data = JSON.parse(Buffer.from(url.split('#tasks=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    await tab.close();
    ok(url.startsWith('https://floodwarning.net/#tasks='), 'opens Flood-Net with the tasks in the address fragment');
    ok(data.v === 1 && data.source === 'sort' && data.station.id === 'bengalla_tm' && data.station.hub === 'brisbane', 'station and session in the hand-off');
    const refs = data.tasks.map(t => t.ref);
    ok(refs.includes('alertIds') && refs.includes('vegetationScope') && refs.includes('custom-1'), `follow-ups and the added task sent (${refs.join(', ')})`);
    ok(!refs.includes('tbmDetails'), 'the TBM desktop task stays out of the hand-off');
    ok(JSON.stringify(data.tasks.find(t => t.ref === 'alertIds').team) === '{"hub":"brisbane"}', 'ALERT IDs task goes to the station’s hub team');
    ok((await p.$$eval('#followups .fu-task .hint', e => e.map(x => x.textContent))).some(t => /sent to Flood-Net/.test(t)), 'marked as sent');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const clip1 = await p.clip();
    ok(/Check the gauge board datum/.test(clip1), 'the forum’s own task is in the Word copy’s follow-up row');
    ok(/Technical staff:<\/b> DESKTOP TASK — get the site’s local TBM from HDB or the hardcopy station file/.test(clip1.replace(/&#39;|&rsquo;|'/g, '’')), 'the TBM desktop task lands in the Word follow-up row');
    await p.click('#q-localTbm .opt:has-text("On hand – AHD value")');
    await p.fill('[data-fk="localTbm::f::value"]', '123.456'); await p.press('[data-fk="localTbm::f::value"]', 'Tab');
    ok(/DESKTOP TASK/.test(await p.innerText('#followups')), 'still a task until its location is described');
    await p.fill('[data-fk="localTbm::f::location"]', 'Brass plug in the concrete pad'); await p.press('[data-fk="localTbm::f::location"]', 'Tab');
    await p.waitForTimeout(300);
    ok(!/DESKTOP TASK/.test(await p.innerText('#followups')), 'value and location entered: the desktop task goes');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const clip2 = await p.clip();
    ok(/Local TBM/.test(clip2) && /On hand – AHD value/.test(clip2) && /TBM value: 123\.456 m/.test(clip2) && /TBM location: Brass plug in the concrete pad/.test(clip2) && !/DESKTOP TASK/.test(clip2), 'and the TBM is in the Word table instead');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async manual(b) {
    const p = await page(b);
    await p.fill('#stationSearch', 'Zzyzx Qqq Creek');
    await p.waitForFunction(() => /No station by that name/.test(document.querySelector('.station-find .hint').textContent), null, { timeout: 20000 });
    await p.click('.station-find .hint button:has-text("Enter it by hand")');
    ok((await p.inputValue('.manual-grid [name=name]')) === 'Zzyzx Qqq Creek', 'the search words carry into the hand form');
    await p.fill('.manual-grid [name=name]', 'Zzyzx Creek AL');
    await p.fill('.manual-grid [name=number]', '599999');
    await p.fill('.manual-grid [name=pos]', '-27.5123, 152.9456');
    await p.selectOption('.manual-grid [name=measures]', 'river');
    await p.fill('.manual-grid [name=alert]', '9001, 9002');
    await p.selectOption('.manual-grid [name=hub]', 'brisbane');
    await p.fill('.manual-grid [name=lga]', 'Somerset');
    await p.click('.manual-grid button:has-text("Use this station")');
    await p.waitForSelector('.station-card', { timeout: 10000 });
    const card = await p.innerText('.station-card');
    ok(/Zzyzx Creek AL/.test(card) && /599999/.test(card) && /entered by hand/.test(card), 'a hand-entered station gets its card');
    ok(/9001, 9002/.test(card) && /Brisbane Hub · Somerset/.test(card) && /-27\.5123, 152\.9456/.test(card), 'with its ALERT IDs, hub, council and position');
    ok(/Water Level/.test(await p.textContent('.seg.on')), 'what it measures picks the scope table');
    ok((await p.$$eval('#q-currentComms .opt.on', e => e.map(x => x.textContent))).join() === 'ERRTS / ALERT VHF radio', 'ALERT IDs make it ERRTS to confirm');
    ok(/You entered -27\.5123, 152\.9456/.test(await p.innerText('#mapCheck')), 'the map asks to check the position entered, not Flood-Net’s');
    await p.click('#q-remediation .opt:has-text("Vegetation management")');
    await p.click('.st-links button:has-text("Edit details")');
    ok((await p.inputValue('.manual-edit [name=lga]')) === 'Somerset', 'Edit details opens with what was entered');
    await p.fill('.manual-edit [name=lga]', 'Somerset Regional');
    await p.click('.manual-edit button:has-text("Save the details")');
    await p.waitForSelector('.station-card', { timeout: 10000 });
    ok(/Somerset Regional/.test(await p.innerText('.station-card')), 'and saves the correction');
    ok((await p.$$eval('#q-remediation .opt.on', e => e.length)) > 0, 'answers kept through the edit');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    ok(/Water Level \(\+\/- Rainfall\) Table — Zzyzx Creek AL \(599999\)/.test(await p.clip()), 'its name and number head the Word table');
    const sent = await p.evaluate(() => SoRT.tasks.payload(SoRT.app, SoRT.tasks.pending(SoRT.app)).station);
    ok(sent.id === '' && sent.number === '599999' && sent.hub === 'brisbane', 'tasks go with its number and hub (no Flood-Net id)');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async particulars(b) {
    const p = await page(b);
    let posted = null, ready = false;
    await p.context().route(/floodwarning\.net\/api\/report/, r => {
      if (r.request().method() === 'POST') { posted = JSON.parse(r.request().postData()); return r.fulfill({ status: 201, contentType: 'application/json', body: '{"to":["github"],"number":999,"url":"https://github.com/cdomotor-g/MegaNet/issues/999"}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ready ? { ready: true, to: ['github'] } : { ready: false, to: [], reason: 'unconfigured' }) });
    });
    await p.context().route(/github\.com\/cdomotor-g\/MegaNet\/issues\/new/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stand-in</p>' }));
    await p.pick('540601');
    await p.click('.st-links button:has-text("Edit details")');
    ok((await p.inputValue('.manual-edit [name=name]')) === 'Fifteen Mile AL', 'Edit details opens with Flood-Net’s particulars');
    await p.fill('.manual-edit [name=name]', 'Fifteen Mile Creek AL');
    await p.fill('.manual-edit [name=lga]', 'Toowoomba Regional Council');
    await p.click('.manual-edit button:has-text("Save the details")');
    await p.waitForSelector('.station-card .st-edits', { timeout: 10000 });
    const note = await p.innerText('.st-edits');
    ok(/Fifteen Mile Creek AL/.test(await p.textContent('.st-name')) && /corrected/.test(await p.innerText('.station-card .st-title')), 'the card shows the corrected name, marked corrected');
    ok(/Station name: “Fifteen Mile Creek AL” — Flood-Net has “Fifteen Mile AL”/.test(note) && /Council: “Toowoomba Regional Council”/.test(note), 'and says what Flood-Net still has');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok(/Rainfall Table — Fifteen Mile Creek AL \(540601\)/.test(html) && !/Table — Fifteen Mile AL \(/.test(html), 'the Word tables use the corrected name');
    const [gh] = await Promise.all([p.context().waitForEvent('page'), p.click('.st-edits button:has-text("Report to Flood-Net")')]);
    const issue = new URL(gh.url()); await gh.close();
    ok(issue.pathname === '/cdomotor-g/MegaNet/issues/new' && /Correct 540601 Fifteen Mile AL/.test(issue.searchParams.get('title')) && /\| Station name \| Fifteen Mile AL \| Fifteen Mile Creek AL \|/.test(issue.searchParams.get('body')), 'Report to Flood-Net: a ready-made issue in its tracker while its report route is off');
    ok(/Reported to Flood-Net/.test(await p.innerText('.st-edits')), 'the card notes it was reported');
    ready = true;
    await p.click('.st-edits button:has-text("Report again")');
    await p.waitForFunction(() => /#999/.test(document.querySelector('.st-edits').textContent), null, { timeout: 10000 });
    ok(posted && posted.type === 'bug' && /Fifteen Mile Creek AL/.test(posted.body), 'with the route on, it files the report itself');
    await p.click('.st-links button:has-text("Refresh from Flood-Net")');
    await p.waitForFunction(() => /refreshed/i.test(document.querySelector('#toast').textContent), null, { timeout: 40000 });
    ok(/Fifteen Mile Creek AL/.test(await p.textContent('.st-name')), 'Refresh from Flood-Net keeps the correction');
    await p.click('.st-edits li:has-text("Station name") button:has-text("use Flood-Net")');
    ok((await p.textContent('.st-name')) === 'Fifteen Mile AL' && /Council/.test(await p.innerText('.st-edits')) && !/Station name/.test(await p.innerText('.st-edits')), '“use Flood-Net’s” puts its value back');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async bureau(b) {
    // Flood-Net's tab, stood in for: it reads SoRT's request and posts made-up
    // marks back to its opener — first with the wrong nonce (ignored), then right.
    const p = await page(b);
    let asked = null;
    await p.context().route(/^https:\/\/floodwarning\.net\/$/, r => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>
      const q = JSON.parse(atob(location.hash.split('=')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const msg = n => ({ type: 'floodnet:benchmarks', v: 1, nonce: n, station: { id: q.station.id, number: q.station.number, name: q.station.name }, printed_on: '2026-10-15',
        benchmarks: [{ ord: 0, level_m: 45.678, datum: 'AHD', on_gauge_m: 2.345, gauge_zero_m: 43.333, gauge_datum: 'AHD', description: 'Test mark one, made up for the check', comment: 'Made-up comment' },
                     { ord: 1, level_m: 12.5, datum: 'STATE', on_gauge_m: 1.1, gauge_zero_m: 11.4, gauge_datum: 'STATE', description: 'Test mark two', comment: null },
                     { ord: 2, level_m: 100, datum: 'ASSUM', on_gauge_m: null, gauge_zero_m: null, gauge_datum: null, description: 'Test mark three', comment: null }] });
      window.__asked = q;
      window.opener.postMessage(msg('wrongnonce123'), '*');
      setTimeout(() => window.opener.postMessage(msg(q.nonce), '*'), 300);
    </script>` }));
    await p.pick('41506');
    ok(/Water Level/.test(await p.textContent('.seg.on')), 'a water level station');
    const box = '#q-localTbm [data-hint="bureau.benchmarks"]';
    ok(/Bureau benchmarks \(HDB\)/.test(await p.innerText(box)) && /Not the State survey marks/.test(await p.innerText(box)), 'the Local TBM offers the Bureau benchmarks, told apart from the State marks');
    const [fn] = await Promise.all([p.context().waitForEvent('page'), p.click(`${box} button:has-text("Get them from Flood-Net")`)]);
    await fn.waitForLoadState('load');
    asked = await fn.evaluate(() => window.__asked);
    ok(asked && asked.v === 1 && asked.source === 'sort' && asked.station.id === 'bengalla_tm' && asked.station.number === '41506' && /^[A-Za-z0-9]{8,}$/.test(asked.nonce), 'it asks Flood-Net for this station’s, by id and number');
    await p.waitForFunction(() => /Bureau benchmarks? from Flood-Net/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await fn.close();
    const list = await p.innerText(`${box} .bbm-list`);
    ok(/BoM-TBM-1/.test(list) && /45\.678 m AHD/.test(list) && /2\.345 m on the gauge \(LGH\)/.test(list) && /BoM-TBM-3/.test(list) && /not AHD or LGH/.test(list), 'the marks are listed, BoM-TBM-1…, with level, datum and height on the gauge');
    ok(await p.$$eval(`${box} .bbm-list li`, e => e.length) === 3, 'only the answer to its own request was taken');
    await p.click(`${box} .bbm-list li:first-child button:has-text("Use")`);
    ok((await p.$$eval('#q-localTbm .opt.on', e => e.map(x => x.textContent))).join() === 'On hand – AHD value', 'Use fills the Local TBM: AHD');
    ok((await p.$eval('[data-fk="localTbm::f::value"]', e => e.value)) === '45.678' && /Test mark one.*2\.345 m on the gauge \(LGH\).*Bureau benchmark BoM-TBM-1, HDB Benchmark Details 15\/10\/2026/.test(await p.$eval('[data-fk="localTbm::f::location"]', e => e.value)), 'with its level, where it is and where that came from');
    ok(!/DESKTOP TASK/.test(await p.innerText('#followups')), 'so no desktop task for the TBM');
    await p.click(`${box} .bbm-list li:nth-child(2) button:has-text("Use")`);
    ok((await p.$$eval('#q-localTbm .opt.on', e => e.map(x => x.textContent))).join() === 'On hand – LGH value' && (await p.$eval('[data-fk="localTbm::f::value"]', e => e.value)) === '1.100', 'a State-datum mark gives its height on the gauge (LGH)');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok(/Bureau benchmarks \(HDB\) — Bengalla TM \(41506\)/.test(html) && /Test mark three/.test(html) && /not State survey marks/.test(html), 'the Word copy has them as their own table');
    ok(/>BoM-TBM-1<\/td>/.test(html) && !/>B1<\/td>/.test(html), 'named BoM-TBM-1… in Word, not B1 (which bridges were too)');
    // A Local TBM filled in before the rename (…Bureau benchmark B1, …) still shows its mark in use.
    await p.evaluate(() => { const a = SoRT.app.session.answers.localTbm; a.fields.location = a.fields.location.replace(/Bureau benchmark BoM-TBM-(\d+),/, 'Bureau benchmark B$1,'); SoRT.app.changed(); });
    ok(/in use/.test(await p.innerText(`${box} .bbm-list li:nth-child(2)`)), 'an older session’s “Bureau benchmark B2” is still shown in use');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async layout(b) {
    const p = await page(b);
    await p.pick('540601');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#map-card')).position === 'fixed'), 'map beside the questions by default');
    await p.click('#layoutBtn');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#map-card')).position !== 'fixed'), 'the switch puts it above the questions');
    await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.station-card', { timeout: 40000 });
    ok(!(await p.evaluate(() => document.body.classList.contains('layout-side'))), 'the choice is remembered');
    await p.click('#layoutBtn');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#map-card')).position === 'fixed'), 'and switches back');
    ok(/left out of the Word tables/.test(await p.innerText('#followups')) || !(await p.$('#followups .fu')), 'follow-ups say ticking takes them out of Word');
    // Beside each other, each pane scrolls on its own and never hands on to the other.
    const pos = () => p.evaluate(() => ({ left: document.querySelector('main.wrap').scrollTop, right: document.querySelector('#map-card').scrollTop, page: scrollY }));
    const q = await (await p.$('#form')).boundingBox();
    await p.mouse.move(q.x + 100, 400); await p.mouse.wheel(0, 600); await p.waitForTimeout(500);
    let at = await pos();
    ok(at.left > 0 && at.right === 0 && at.page === 0, `the questions scroll in their own pane (${JSON.stringify(at)})`);
    const side = await (await p.$('.map-side')).boundingBox();
    await p.mouse.move(side.x + side.width / 2, 700);
    for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 800); await p.waitForTimeout(120); }
    await p.waitForTimeout(400);
    const end = await pos();
    ok(end.right > 0 && end.left === at.left && end.page === 0, `the map pane scrolls to its end without moving the questions (${JSON.stringify(end)})`);
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async help(b) {
    const p = await page(b, { freshHelp: true });
    ok(await p.waitForFunction(() => /New to this page\?/.test(document.querySelector('#toast').textContent), null, { timeout: 8000 }).then(() => true).catch(() => false), 'first visit: a nudge towards Help');
    await p.click('#toast button:has-text("Open help")');
    ok(await p.evaluate(() => document.querySelector('#helpDlg').open), 'the nudge opens the guide');
    const text = await p.innerText('#helpDlg');
    ok(/Starting a new session/.test(text) && /Sessions/.test(text) && /New session/.test(text), 'it says how to start a new session');
    ok(/Start here/.test(text) && /Copy for Word/.test(text) && /Zoom lock/.test(text) && /plain text only/.test(text), 'and covers the basics and the catches');
    await p.click('#helpDlg .help-toc a:has-text("The map")');
    await p.waitForTimeout(700);
    ok(await p.evaluate(() => { const b = document.querySelector('#helpDlg .help-body'); return b.scrollTop > 0; }), 'its contents links jump down the guide');
    await p.click('#helpDlg .dlg-foot .btn-primary');
    ok(!(await p.evaluate(() => document.querySelector('#helpDlg').open)), 'Close closes it');
    await p.reload({ waitUntil: 'load' }); await p.waitForSelector('#stationSearch', { timeout: 20000 });
    await p.waitForTimeout(1800);
    ok(!/New to this page/.test(await p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent)), 'the nudge comes once');
    await p.click('#helpBtn');
    ok(await p.evaluate(() => document.querySelector('#helpDlg').open && document.querySelector('#helpDlg .help-body').scrollTop === 0), '❔ Help (top right) opens it at the top');
    await p.keyboard.press('Escape');
    ok(!(await p.evaluate(() => document.querySelector('#helpDlg').open)), 'Esc closes it');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
    const m = await page(b, { viewport: { width: 390, height: 800 } });
    ok(await m.evaluate(() => { const r = document.querySelector('#helpBtn').getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }), 'on a phone the Help button fits, with no sideways scroll');
    await m.context().close();
  },
  async oldforum(b) {
    const p = await page(b);
    // An older session, saved on a past forum day, as if from last week.
    const old = await p.evaluate(() => {
      const s = SoRT.store.newSession(SoRT.app.defs);
      s.forum.date = '2026-10-01'; s.station = { name: 'Old Gauge', number: '99999', source: 'manual' };
      s.updatedAt = 1000; SoRT.store.save(s, true);
      SoRT.store.rememberForum({ date: SoRT.util.todayIso(), attendees: ['AB'], outOfSession: false });
      return s.id;
    });
    await p.evaluate(id => SoRT.app.openSession(id), old);
    await p.waitForTimeout(300);
    ok(await p.inputValue('#forumDate') === '2026-10-01', 'an older session opens with its own forum date');
    await p.evaluate(() => SoRT.app.newSession()); await p.waitForTimeout(300);
    const after = await p.evaluate(id => ({ at: JSON.parse(localStorage.getItem('sortv2.s.' + id)).updatedAt, dflt: JSON.parse(localStorage.getItem('sortv2.forum')).date }), old);
    ok(after.at === 1000, 'only looking at it leaves its “changed” time alone');
    ok(after.dflt === await p.evaluate(() => SoRT.util.todayIso()), 'and does not drag today’s forum date back to the old one');
    await p.evaluate(id => SoRT.app.openSession(id), old); await p.waitForTimeout(300);
    ok(!(await p.$('#forumAsk')), 'no question while it is only being viewed');
    await p.click('#q-comms .opt >> nth=0'); await p.waitForTimeout(200);
    ok(/forum of 01\/10\/2026/.test(await p.innerText('#forumAsk')), 'the first change asks whether to keep the old forum date');
    ok(await p.inputValue('#forumDate') === '2026-10-01', 'the date is not touched until the user answers');
    await p.click('#forumAsk button:has-text("Move to")'); await p.waitForTimeout(200);
    ok(await p.inputValue('#forumDate') === await p.evaluate(() => SoRT.util.todayIso()), '“Move to” puts it on today’s forum');
    ok(!(await p.$('#forumAsk')), 'and the question is gone');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async cutover(b) {
    // The old address opens v2, keeping what follows it; v1 is kept at /v1/.
    const root = new URL('../', BASE).href;
    const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
    await ctx.route(/raw\.githubusercontent\.com|api\.github\.com|js\.arcgis\.com/, r => r.abort());
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(root + '?from=bookmark#top', { waitUntil: 'load' });
    await p.waitForURL(/\/v2\/\?from=bookmark#top$/, { timeout: 10000 }).catch(() => {});
    ok(new URL(p.url()).pathname.endsWith('/v2/') && /from=bookmark/.test(p.url()) && /#top$/.test(p.url()), `the old address opens v2 and keeps its query and hash (${p.url()})`);
    await p.waitForSelector('#stationSearch', { timeout: 20000 });
    ok(new URL(await p.$eval('#v1Link', a => a.href)).pathname.endsWith('/v1/') && await p.isVisible('#v1Link'), 'Version 1 is linked at the top of v2');
    ok(!/beta/i.test(await p.title()), 'v2 is no longer marked beta');
    await p.click('#v1Link');
    await p.waitForSelector('#rowsContainer .row', { timeout: 20000 });
    ok(/SoRT Forum Scope Builder/.test(await p.textContent('header.app-header h1')), 'v1 opens at /v1/');
    ok(/version 2/.test(await p.textContent('header.app-header .sub')), 'and links back to v2');
    const wl = await p.$('text=/^Water Level/');
    if (wl) { await wl.click(); await p.waitForTimeout(600); }
    ok(/Local TBM/.test(await p.evaluate(() => document.body.innerText)), 'v1 still loads the root definitions.json (Local TBM in its Water Level table)');
    ok(!errs.length, `no page errors ${errs.join('; ')}`);
    await ctx.close();
  },
  async coast(b) {
    // One straight north–south shore, 600 m east of the station (south of the Tropic, far from surf: semi-sheltered).
    const SHORE_LON = 152.95168;
    const shore = { features: [{ attributes: { objectid: 1 }, geometry: { paths: [[[SHORE_LON, -27.8], [SHORE_LON, -27.2]]] } }] };
    let fail = false;
    const p = await page(b, { coast: r => (fail ? r.abort() : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(shore) })) });
    await p.fill('#stationSearch', 'Zzyzx Qqq Creek');
    await p.waitForFunction(() => /No station by that name/.test(document.querySelector('.station-find .hint').textContent), null, { timeout: 20000 });
    await p.click('.station-find .hint button:has-text("Enter it by hand")');
    await p.fill('.manual-grid [name=name]', 'Zzyzx Creek AL');
    await p.fill('.manual-grid [name=pos]', '-27.5123, 152.9456');
    await p.selectOption('.manual-grid [name=measures]', 'river');
    await p.click('.manual-grid button:has-text("Use this station")');
    await p.waitForSelector('.station-card', { timeout: 10000 });
    const sum = await p.innerText('#q-infraOptions .guide-sum');
    ok(/C5 and CX: within 1 km of a tropical shore or a surf beach, or 100 m of a semi-sheltered bay/.test(sum) && /C4: within 10 km of a surf beach, 1 km of a semi-sheltered bay, or 100 m of a quiet bay/.test(sum) && /C3 and below: further away/.test(sum), 'a brief summary of the categories on the card');
    await p.waitForFunction(() => /Suggests/.test((document.querySelector('#coast-infraOptions') || {}).textContent || ''), null, { timeout: 20000 });
    let note = await p.innerText('#coast-infraOptions');
    ok(/Temperate semi-sheltered shore: 600 m/.test(note) && /Surf beach: more than 50 km/.test(note), 'the distances to the sea are measured');
    ok(/Suggests C4 — stainless enclosure and orifice run/.test(note) && /check it, then press ✓/.test(note), 'and suggest C4, filled in to check');
    const onTicks = () => p.$$eval('#q-infraOptions .opts:not(.choice) .opt.on', e => e.map(x => x.textContent.split(' with ')[0]).join('|'));
    const onCat = () => p.$$eval('#q-infraOptions .choice .opt.on', e => e.map(x => x.textContent.split(' — ')[0]).join('|'));
    ok(await onCat() === 'C4' && await onTicks() === 'Stainless steel enclosure|Stainless steel orifice run (capillary conduit)', 'the C4 radio and its two ticks are on');
    ok(await p.$eval('#q-infraOptions', e => e.classList.contains('waiting')) && /Map/.test(await p.innerText('#q-infraOptions .q-tools')), 'orange, marked Map, until checked');
    await p.click('#q-infraOptions .src-ok');
    ok(await p.$eval('#q-infraOptions', e => e.classList.contains('checked')) && /The answer below matches/.test(await p.innerText('#coast-infraOptions')), 'then checked, and the suggestion agrees');
    // Ticks and radios follow each other.
    await p.click('#q-infraOptions .opts:not(.choice) .opt:has-text("tower")');
    ok(await onCat() === 'C5 and CX', 'ticking the tower too is exactly C5 and CX');
    await p.click('#q-infraOptions .opts:not(.choice) .opt:has-text("enclosure")');
    ok(await onCat() === 'Custom' && await onTicks() === 'Stainless steel tower|Stainless steel orifice run (capillary conduit)', 'any other change of ticks goes to Custom');
    await p.click('#q-infraOptions .choice .opt:has-text("C3 and below")');
    ok(await onCat() === 'C3 and below' && await onTicks() === '' && /Unticked parts go into Word as: standard galvanised tower, aluminium enclosure, galvanised orifice run \(capillary conduit\)/.test(await p.innerText('#q-infraOptions')), 'C3 and below unticks them all: the standard parts');
    await p.click('#q-infraOptions .choice .opt:has-text("Custom")');
    ok(await onCat() === 'Custom' && await onTicks() === '', 'Custom keeps the ticks as they are');
    note = await p.innerText('#coast-infraOptions');
    ok(/The answer below is Custom: keep it if the forum knows better/.test(note), 'the card says the answer differs from the suggestion');
    await p.click('#coast-infraOptions button:has-text("Use C4")');
    ok(await onCat() === 'C4' && await onTicks() === 'Stainless steel enclosure|Stainless steel orifice run (capillary conduit)', '“Use C4” puts the suggestion back');
    // The guide: the categories, the distances table with this site's column, the grades.
    await p.click('#q-infraOptions .guide-btn');
    await p.waitForSelector('#guideDlg[open]', { timeout: 5000 });
    const guide = await p.innerText('#guideDlg');
    ok(/Corrosion and the infrastructure options/.test(guide) && /AS 4312/.test(guide) && /Stainless steel tower, enclosure and orifice run/.test(guide), 'the guide opens, with the categories and their materials');
    ok(/Temperate semi-sheltered\tAdelaide, Brisbane, Perth\tunder 100 m\t100 m – 1 km\tover 1 km\t600 m/.test(guide) && /Surf\tSydney, Wollongong, Newcastle, Gold Coast\tunder 1 km\t1 km – 10 km\tover 10 km/.test(guide), 'the distances by kind of shore, with this site’s');
    ok(await p.$$eval('#guideDlg .guide-matrix td.hit', e => e.map(x => x.textContent).join()) === '100 m – 1 km,over 10 km' && await p.$$eval('#guideDlg .guide-matrix td.decides', e => e.map(x => x.textContent).join()) === '100 m – 1 km', 'where this site sits for each shore is marked, and the one that decides it stands out');
    ok(/CX — Extreme/.test(guide) && /This site \(-27\.5123, 152\.9456\): C4/.test(guide), 'AS 4312’s grades, and what this site comes to');
    ok(/How far from the shore — OTE’s instruction/.test(guide) && /AS 4312:2019 Table 4\.1 and OTE’s instruction compared/.test(guide), 'OTE’s distances and the standard’s own table, both shown');
    ok(await p.$$eval('#guideDlg .guide-cmp td.cmp-stricter', e => e.length) === 6 && await p.$$eval('#guideDlg .guide-cmp td.cmp-looser', e => e.length) === 0 && /OTE is never less strict than the standard/.test(guide), 'the six bands where OTE is stricter are shaded; it is never less strict');
    ok(/AS 4312: C3\s*OTE: C4/.test(await p.innerText('#guideDlg .guide-cmp tr[data-shore="surf"] td:nth-child(6)')) && /Surf, 1–10 km: AS 4312 says C3 \(C3 and below\); OTE says C4 — stainless enclosure and orifice run\./.test(guide) && /Tropical quiet, 0\.5–1 km: AS 4312 says C3 \(C3 and below\); OTE says C5 and CX — all stainless — 2 categories apart\./.test(guide), 'and each difference is written out (surf 1–10 km: C3 against C4)');
    await p.click('#guideDlg .dlg-foot button:has-text("Close")');
    ok(!(await p.$('#guideDlg')), 'and closes');
    // The card's map button opens the guide at this site's own map (the map library is blocked here, so it says so).
    ok(!/Show on map/.test(await p.innerText('#coast-infraOptions')), 'no button draws on the main map any more');
    await p.click('#coast-infraOptions button:has-text("Map of these distances")');
    await p.waitForSelector('#guideDlg[open] #guideMap', { timeout: 5000 });
    ok(/This site’s distance to the sea/.test(await p.innerText('#guideDlg .guide-body')) && await p.waitForFunction(() => /couldn’t load here/.test(document.querySelector('#guideMap').textContent), null, { timeout: 30000 }).then(() => true).catch(() => false), '“Map of these distances” opens the guide at the site’s own map');
    await p.keyboard.press('Escape');
    // Word: the category, then every part (standard where it isn't ticked).
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok(/<b>Corrosion category: C4 — stainless enclosure and orifice run\.<\/b>/.test(html) && /• Standard galvanised tower\.<br>• Stainless steel enclosure with stainless steel fixtures and fittings\.<br>• Stainless steel orifice run \(capillary conduit\) with stainless steel fixtures and fittings\./.test(html) && !/Aluminium enclosure/.test(html), 'Word: the category as a bold line, then each part as a bullet, each a sentence');
    // Relocating: the new location is measured; a person's answer stands.
    await p.click('#q-relocation .opt:has-text("Yes")');
    await p.fill('#q-relocation input[aria-label="Relocation — New Location (coordinates)"]', '-27.5123, 152.9355');
    await p.press('#q-relocation input[aria-label="Relocation — New Location (coordinates)"]', 'Tab');
    await p.waitForFunction(() => /new location/.test((document.querySelector('#coast-infraOptions') || {}).textContent || '') && /Suggests C3/.test(document.querySelector('#coast-infraOptions').textContent), null, { timeout: 20000 });
    note = await p.innerText('#coast-infraOptions');
    ok(/Temperate semi-sheltered shore: 1\.6 km/.test(note) && /The answer below is C4/.test(note) && await onCat() === 'C4', 'the new location is measured (1.6 km: C3) and the answer chosen stands');
    // A rounded position (2 decimal places, ±557 m) 600 m from the shore could be C3 or C5: it says so, until the position is someone's.
    await p.newSession();
    await p.fill('#stationSearch', 'Zzyzx Qqq Creek');
    await p.waitForFunction(() => /No station by that name/.test(document.querySelector('.station-find .hint').textContent), null, { timeout: 20000 });
    await p.click('.station-find .hint button:has-text("Enter it by hand")');
    await p.fill('.manual-grid [name=name]', 'Zzyzx Creek AL');
    await p.fill('.manual-grid [name=pos]', '-27.51, 152.9456');
    await p.selectOption('.manual-grid [name=measures]', 'river');
    await p.click('.manual-grid button:has-text("Use this station")');
    await p.waitForFunction(() => /Suggests/.test((document.querySelector('#coast-infraOptions') || {}).textContent || ''), null, { timeout: 20000 });
    ok(/rounded \(good to about ±557 m\), which is enough to make it C3 and below or C5 and CX/.test(await p.innerText('#coast-infraOptions')), 'a rounded position warns when it could change the category');
    await p.fill('#q-coords input[aria-label="Instrumentation Coordinates — Existing"]', '-27.51, 152.9456');
    await p.press('#q-coords input[aria-label="Instrumentation Coordinates — Existing"]', 'Tab');
    await p.waitForTimeout(400);
    ok(!/rounded/.test(await p.innerText('#coast-infraOptions')), 'and stops once a person has given the position');
    // No coastline service: no suggestion, and it says so.
    fail = true;
    await p.newSession();
    await p.fill('#stationSearch', 'Zzyzx Qqq Creek');
    await p.waitForFunction(() => /No station by that name/.test(document.querySelector('.station-find .hint').textContent), null, { timeout: 20000 });
    await p.click('.station-find .hint button:has-text("Enter it by hand")');
    await p.fill('.manual-grid [name=name]', 'Zzyzx Creek AL');
    await p.fill('.manual-grid [name=pos]', '-27.6123, 152.9456');
    await p.selectOption('.manual-grid [name=measures]', 'river');
    await p.click('.manual-grid button:has-text("Use this station")');
    await p.waitForFunction(() => /Couldn’t reach/.test((document.querySelector('#coast-infraOptions') || {}).textContent || ''), null, { timeout: 20000 });
    ok(await onCat() === '' && /no suggestion/.test(await p.innerText('#coast-infraOptions')), 'without the coastline there is no suggestion, and the card says why');
    // The Rainfall table keeps its own (footing) options and no corrosion guide.
    await p.click('.tpl-pick .seg:has-text("Rainfall")');
    ok(!(await p.$('#q-infraOptions .guide-sum')) && /Full footing/.test(await p.innerText('#q-infraOptions')), 'Rainfall’s infrastructure options are unchanged');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async soil(b) {
    // Queensland's acid sulfate soil maps, answered here: `mode` says what they hold at the site.
    let mode = 'potential';
    const REPORT = 'https://resources.information.qld.gov.au/soils/reports/sites?project=SEA&site=600';
    const answer = (layer, lon, lat) => {
      if (mode === 'down') return null;
      const f = [];
      if (layer === 1902 && mode === 'potential') f.push({ attributes: { map_code: 'S2', map_code_meaning: 'Potential ASS starting at 1 to 2m', project_code: 'SEAM' } });
      if (layer === 2052 && mode === 'atlasLow') f.push({ attributes: { probclass: 'C', probclass_def: 'Extremely low probability of occurrence (1-5%)', mapscale: '1:2M' } });
      if (layer === 1850 && mode === 'potential') f.push({ attributes: { project_code: 'SEA', site_id: 600, core_depth_m: 3, laboratory_data_available: 'Yes', site_report_url: REPORT }, geometry: { x: lon + 0.002, y: lat } });
      return { features: f };
    };
    const p = await page(b, { soil: r => {
      const u = new URL(r.request().url()), layer = Number(u.pathname.match(/MapServer\/(\d+)\/query/)[1]);
      const [lon, lat] = u.searchParams.get('geometry').split(',').map(Number);
      const a = answer(layer, lon, lat);
      return a ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(a) }) : r.abort();
    } });
    const byHand = async (pos, measures) => {
      await p.fill('#stationSearch', 'Zzyzx Qqq Creek');
      await p.waitForFunction(() => /No station by that name/.test(document.querySelector('.station-find .hint').textContent), null, { timeout: 20000 });
      await p.click('.station-find .hint button:has-text("Enter it by hand")');
      await p.fill('.manual-grid [name=name]', 'Zzyzx Creek AL');
      await p.fill('.manual-grid [name=pos]', pos);
      await p.selectOption('.manual-grid [name=measures]', measures || 'river');
      await p.click('.manual-grid button:has-text("Use this station")');
      await p.waitForSelector('.station-card', { timeout: 10000 });
    };
    const risk = () => p.$$eval('#q-assSoil .choice .opt.on', e => e.map(x => x.textContent.split(' — ')[0]).join('|'));
    const ticks = () => p.$$eval('#q-assSoil .opts:not(.choice) .opt.on input', e => e.map(x => x.value).join('|'));
    const contractor = () => p.$$eval('#followups .fu', e => e.filter(x => /Contractor/.test(x.textContent)).map(x => x.textContent));
    await byHand('-27.5123, 152.9456');
    await p.waitForFunction(() => /Suggests/.test((document.querySelector('#soil-assSoil') || {}).textContent || ''), null, { timeout: 20000 });
    const box = await p.innerText('#soil-assSoil');
    ok(/Queensland 1:25 000 map: Potential ASS starting at 1 to 2m/.test(box) && /Nearest tested core: 200 m — cored to 3 m, lab results/.test(box) && /site report ↗/.test(box),
      'the card says what the finest soil map says, and the nearest tested core with its report');
    ok(/Suggests Likely or present — test, and manage it/.test(box) && await risk() === 'Likely or present' && await ticks() === 'soil_test|manage_disturbed|materials_to_suit'
      && await p.$eval('#q-assSoil', e => e.classList.contains('waiting')), 'and suggests Likely or present, all three steps ticked, orange until checked');
    ok((await p.inputValue('#q-assSoil input[aria-label="Acid sulfate soil — What the maps say"]')) === 'Potential ASS starting at 1 to 2m (Queensland 1:25 000 map); nearest tested core 200 m away, with lab results.',
      'what the maps say is filled in for Word');
    const fu = await contractor();
    ok(fu.length === 1 && /Test the soil for acid sulfate soil/.test(fu[0]) && /Contractor task — goes to the contractor in the Word scope table, not sent to Flood-Net/.test(fu[0]) && !/Send as a task/.test(fu[0]),
      'it raises a contractor task, kept to the Word scope and never offered to Flood-Net');
    ok(/Harmless while wet and undisturbed/.test(await p.innerText('#q-assSoil .guide-sum')) && !(await p.$('#q-assSoil .preset-std')),
      'a brief summary on the card, and none of the corrosion question’s wording');
    // The risk and the steps follow each other, as the corrosion category's do.
    await p.click('#q-assSoil .choice .opt:has-text("Possible")');
    ok(await risk() === 'Possible' && await ticks() === 'soil_test' && (await contractor()).length === 1, 'Possible ticks the soil test alone; the contractor task stays');
    await p.click('#q-assSoil .choice .opt:has-text("Not expected")');
    ok(await risk() === 'Not expected' && await ticks() === '' && (await contractor()).length === 0, 'Not expected ticks nothing, and the contractor task goes');
    await p.click('#q-assSoil .opts:not(.choice) .opt:has-text("Soil testing")');
    ok(await risk() === 'Possible', 'ticking the soil test alone is exactly Possible');
    await p.click('#soil-assSoil button:has-text("Use Likely or present")');
    ok(await risk() === 'Likely or present' && /The answer below matches/.test(await p.innerText('#soil-assSoil')), '“Use” puts the suggestion back');
    // The guide.
    await p.click('#q-assSoil .guide-btn');
    await p.waitForSelector('#guideDlg[open]', { timeout: 5000 });
    const guide = await p.innerText('#guideDlg');
    ok(/Who does what/.test(guide) && /The contractor tests the soil/.test(guide) && /Not mapped is not the same as absent/.test(guide) && /Potential ASS starting at 1 to 2m/.test(guide),
      'the guide: this site, who does what, how it is worked out, its limits');
    await p.click('#guideDlg .dlg-foot button:has-text("Close")');
    // Word.
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok(/<b>Risk: Likely or present — test, and manage it\.<\/b><br>• Soil testing for acid sulfate soil \(pH and sulfur\) where the footing and trenches go, before works — by the contractor\./.test(html)
      && /What the maps say: Potential ASS starting at 1 to 2m \(Queensland 1:25 000 map\); nearest tested core 200 m away, with lab results\./.test(html),
      'Word: the risk in bold, each step a bullet, and what the maps say');
    ok(/<b>Contractor:<\/b> Test the soil for acid sulfate soil/.test(html), '…and the contractor task in Follow-up Actions');
    // Only the national atlas, extremely low: Not expected.
    mode = 'atlasLow';
    await p.newSession(); await byHand('-27.6123, 152.9456');
    await p.waitForFunction(() => /Suggests/.test((document.querySelector('#soil-assSoil') || {}).textContent || ''), null, { timeout: 20000 });
    ok(/National atlas \(1:2M, inferred, not checked on the ground\): Extremely low probability/.test(await p.innerText('#soil-assSoil')) && await risk() === 'Not expected',
      'with no Queensland map there, the national atlas decides — extremely low is Not expected');
    // The maps don't answer: no suggestion, and the card says why.
    mode = 'down';
    await p.newSession(); await byHand('-27.7123, 152.9456');
    await p.waitForFunction(() => /Couldn’t reach/.test((document.querySelector('#soil-assSoil') || {}).textContent || ''), null, { timeout: 20000 });
    ok(await risk() === '' && /no suggestion/.test(await p.innerText('#soil-assSoil')), 'without the soil maps there is no suggestion, and the card says why');
    // The Rainfall table asks it too.
    await p.click('.tpl-pick .seg:has-text("Rainfall")');
    ok(!!(await p.$('#q-assSoil')), 'the Rainfall table asks it too');
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
    // Bridges: only those on the map, numbered BR1… nearest first; who manages each, and who to call.
    await p.waitForFunction(() => SoRT.mapView._M.bridges.length && SoRT.mapView._M.bridges.every(b => b.asked), null, { timeout: 30000 }).catch(() => {});
    const br = await p.evaluate(() => {
      const M = SoRT.mapView._M, W = M.view.width, H = M.view.height;
      const inView = b => { const s = M.view.toScreen(new M.esri.Graphic({ geometry: { type: 'point', longitude: b.lon, latitude: b.lat } }).geometry); return !!s && s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H; };
      return { all: M.bridges.length, shown: M.shown.map(b => ({ ref: b.ref, d: b.d, on: inView(b) })), off: M.bridges.filter(b => !b.ref).map(inView),
        stored: SoRT.app.session.map.bridges.map(b => b.ref), first: SoRT.app.session.map.bridges[0] || null };
    });
    ok(br.shown.length > 0 && br.shown.every((b, i) => b.ref === `BR${i + 1}` && b.on && (!i || b.d >= br.shown[i - 1].d)), `bridges on the map numbered BR1… nearest first (${br.shown.map(b => b.ref).join(', ')} of ${br.all})`);
    ok(br.off.every(v => !v) && br.stored.join() === br.shown.map(b => b.ref).join(), 'bridges off the map get no number and stay out of what Word is given');
    ok(br.first && br.first.who === 'Transport and Main Roads' && /structure 7646/.test(br.first.why) && br.first.contact && /Transport and Main Roads/.test(br.first.contact.name) && /\d/.test(br.first.contact.phone),
      `the TMR bridge: managed by TMR, its structure, and TMR's district to call (${JSON.stringify(br.first && br.first.contact)})`);
    ok(/BR1/.test(await p.innerText('.map-side')) && !/\bB1\b/.test(await p.innerText('.map-side')), 'the list says BR1, not B1');
    ok(await p.evaluate(() => { const lg = document.querySelector('.map-legend'); return !!lg && !lg.closest('.map-frame') && lg.getBoundingClientRect().top >= document.querySelector('.map-frame').getBoundingClientRect().bottom - 1; }), 'the key is under the map, not over it');
    ok(/Bridges? BR1/.test(await p.innerText('.map-legend')) && /Contours: 5 m LiDAR/.test(await p.innerText('.map-legend')), 'the key names the bridges on the map and the contours');
    await p.click('[data-ps="bridgeAttach"] .opt:has-text("Yes")');
    ok(/structure 7646/.test(await p.$eval('[data-fk="ps::bridgeAttach.detail"]', e => e.value)), 'bridge detail filled into Property Services');
    await p.click('.loc[data-pin="relocation.newLocation"] button:has-text("Place")');
    await p.waitForTimeout(300);
    const box = await (await p.$('#mapView')).boundingBox();
    await p.mouse.click(box.x + box.width / 2 + 120, box.y + box.height / 2 - 80);
    await p.waitForTimeout(1200);
    ok((await p.$$eval('#q-relocation .opt.on', e => e.map(x => x.textContent))).join() === 'Yes', 'placing the relocation site answers Relocation');
    ok(/^\d+$/.test(await p.$eval('[data-fk="relocation::f::distance"]', e => e.value)), 'relocation distance measured');
    // Flood-Net's position, once the pin is moved: on the live map, never in the picture.
    const moved = await p.evaluate(() => { const st = SoRT.app.session.station; return `${(st.lat + 0.0018).toFixed(6)}, ${st.lon.toFixed(6)}`; });
    const posIn = p.locator('.map-side .loc input').first();
    await posIn.fill(moved); await posIn.press('Enter');
    await p.waitForTimeout(1500);
    const ghost = await p.evaluate(() => { const g = SoRT.mapView._M.gl.ghost; return { n: g.graphics.length, label: (g.graphics.toArray().find(x => x.symbol && x.symbol.type === 'text') || {}).symbol ? g.graphics.toArray().find(x => x.symbol.type === 'text').symbol.text : '' }; });
    ok(ghost.n === 2 && /Flood-Net position \(.* away\) — not in the Word picture/.test(ghost.label), `moving the pin marks Flood-Net's position, saying it isn't in the picture (${ghost.label})`);
    const used = await p.evaluate(async () => {
      const M = SoRT.mapView._M, real = M.view.takeScreenshot.bind(M.view); let layers = null;
      M.view.takeScreenshot = o => { layers = (o && o.layers) || null; return real(o); };
      try { await SoRT.mapView.picture(); } finally { M.view.takeScreenshot = real; }
      return layers ? { has: !!layers.length, ghost: layers.includes(M.gl.ghost), nearby: layers.includes(M.gl.nearby), pins: layers.includes(M.gl.pins) } : null;
    });
    ok(used && used.has && !used.ghost && !used.nearby && used.pins, `the Word picture is taken without it (or the other stations), with the pins (${JSON.stringify(used)})`);
    ok(await p.evaluate(() => SoRT.mapView._M.gl.ghost.visible === false) && !(await p.isChecked('#mapMount .map-tools label:has-text("Flood-Net position") input')), 'it is hidden on the map unless Flood-Net position is ticked');
    await p.click('#mapMount .map-tools label:has-text("Flood-Net position") input');
    ok(await p.evaluate(() => SoRT.mapView._M.gl.ghost.visible === true), 'ticking it shows it');
    await p.click('#mapMount .map-tools label:has-text("Flood-Net position") input');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 90000 });
    const html = await p.clip();
    ok(/<img/.test(html), 'map picture copied');
    const pic = await p.evaluate(async () => { const r = SoRT.app.picture; const i = new Image(); i.src = r.dataUrl; await i.decode(); return { h: i.naturalHeight, map: r.mapHeight }; });
    ok(pic.map && pic.h > pic.map + 20, `the picture's key is below the map, inside the picture (${pic.map} px of map, ${pic.h} px in all)`);
    ok(/Bridges on the map — Abergowrie Bridge AL \(532028\)/.test(html) && />BR1<\/td>/.test(html) && /structure 7646/.test(html) && /TMR’s register of State-controlled bridges/.test(html), 'the bridges table: on the map only, who manages each');
    await p.$eval('#preview', e => e.scrollIntoView({ block: 'center' }));
    ok(await p.waitForFunction(() => !!document.querySelector('#preview img[alt="Site map"]'), null, { timeout: 30000 }).then(() => true).catch(() => false), 'the preview shows the map picture');
    ok(/<div align="center"[^>]*><img[^>]*alt="Site map"/.test(html), 'the copied map picture is centred for Word');
    const mid = await p.evaluate(() => { const c = b => b.left + b.width / 2; return [c(document.querySelector('#preview img[alt="Site map"]').getBoundingClientRect()), c(document.querySelector('#preview table').getBoundingClientRect())]; });
    ok(Math.abs(mid[0] - mid[1]) < 2, `the preview's map picture is centred like the tables (${mid.map(Math.round).join(' vs ')})`);
    ok(/State survey marks near Abergowrie Bridge AL \(532028\)/.test(html), 'State survey marks table copied, headed with the station');
    ok(!/close-up/.test(html) && await p.evaluate(() => document.querySelector('.map-closeups').hidden), 'a relocation close by: no close-ups');
    ok(await p.evaluate(() => SoRT.mapView._M.layers.road.layers.getItemAt(0).minScale) >= 100000, 'the road reserve is drawn out to 1:100,000, not only close in');
    // A relocation over a kilometre away: a close-up of each end beside the map, and in Word.
    const far = await p.evaluate(() => { const st = SoRT.app.session.station; return `${(st.lat - 0.01).toFixed(6)}, ${(st.lon + 0.002).toFixed(6)}`; });
    await p.fill('.loc[data-pin="relocation.newLocation"] input', far); await p.press('.loc[data-pin="relocation.newLocation"] input', 'Enter');
    ok(await p.waitForFunction(() => document.querySelectorAll('.map-closeups:not([hidden]) .mc-frame').length === 2, null, { timeout: 20000 }).then(() => true).catch(() => false), 'a relocation 1 km away: two close-ups under the map');
    // Auto-fit: typing the far relocation re-framed the map so both pins are in view.
    ok(await p.waitForFunction(() => { const M = SoRT.mapView._M, W = M.view.width, H = M.view.height; return M.pins.filter(x => x.shown && x.ok).every(x => { const s = M.view.toScreen(new M.esri.Graphic({ geometry: { type: 'point', longitude: x.lon, latitude: x.lat } }).geometry); return !!s && s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H; }); }, null, { timeout: 10000 }).then(() => true).catch(() => false), 'a relocation pin put in far away: the map re-fits so every pin is in view');
    ok(/Close-up A/.test(await p.innerText('.map-closeups')) && /Close-up B/.test(await p.innerText('.map-closeups')) && /1\.\d km from the current location/.test(await p.innerText('.map-closeups')), 'each named, and why they are there');
    await p.waitForTimeout(4000);
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 90000 });
    const html2 = await p.clip();
    ok(/alt="Close-up A"/.test(html2) && /alt="Close-up B"/.test(html2), 'both close-ups copied into Word under the map');
    await p.fill('.loc[data-pin="relocation.newLocation"] input', moved); await p.press('.loc[data-pin="relocation.newLocation"] input', 'Enter');
    ok(await p.waitForFunction(() => document.querySelector('.map-closeups').hidden, null, { timeout: 10000 }).then(() => true).catch(() => false), 'the relocation brought close again: the close-ups go');
    // Zoom lock: on by default; the wheel scrolls past the map instead of zooming it.
    await p.evaluate(() => { document.querySelector('#map-card').scrollTop = 0; scrollTo(0, 0); });
    await p.waitForTimeout(400);
    const zoom = () => p.evaluate(() => SoRT.mapView._M.view.zoom);
    const scrolled = () => p.evaluate(() => document.querySelector('#map-card').scrollTop + scrollY);
    ok(await p.getAttribute('#zoomLock', 'aria-pressed') === 'true' && /🔒/.test(await p.innerText('#zoomLock')), 'zoom lock on when the page opens');
    const fr = await (await p.$('.map-frame')).boundingBox();
    await p.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2);
    let z0 = await zoom(), s0 = await scrolled();
    await p.mouse.wheel(0, 400); await p.waitForTimeout(900);
    ok(Math.abs((await zoom()) - z0) < 0.01, 'locked: the wheel doesn’t zoom the map');
    ok((await scrolled()) > s0, 'locked: the wheel scrolls on past the map');
    ok(await p.evaluate(() => document.querySelector('.map-lockhint').classList.contains('show')), 'and says why the map didn’t zoom');
    await p.evaluate(() => { document.querySelector('#map-card').scrollTop = 0; scrollTo(0, 0); });
    await p.waitForTimeout(400);
    await p.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2);
    z0 = await zoom();
    await p.keyboard.down('Control'); await p.mouse.wheel(0, -300); await p.keyboard.up('Control'); await p.waitForTimeout(1200);
    p.ctrlZooms = Math.abs((await zoom()) - z0) > 0.01;
    ok(p.ctrlZooms, 'locked: Ctrl + wheel still zooms the map');
    await p.click('#zoomLock');
    ok(await p.getAttribute('#zoomLock', 'aria-pressed') === 'false' && /🔓/.test(await p.innerText('#zoomLock')), 'the button unlocks it');
    await p.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2);
    z0 = await zoom(); s0 = await scrolled();
    await p.mouse.wheel(0, 400); await p.waitForTimeout(1200);
    const z1 = await zoom(), s1 = await scrolled();
    ok(z1 < z0 - 0.01 && s1 === s0, `unlocked: the wheel zooms the map, the page stays put (zoom ${z0.toFixed(2)} → ${z1.toFixed(2)}, scroll ${s0} → ${s1})`);
    // A new session starts the map back at the whole of Queensland.
    await p.newSession(); await p.waitForTimeout(1500);
    const v = await p.evaluate(() => { const w = SoRT.mapView._M.view; return { lat: w.center.latitude, lon: w.center.longitude, zoom: w.zoom }; });
    ok(v.lat < -15 && v.lat > -24 && v.lon > 142 && v.lon < 150 && v.zoom < 7, `a new session puts the map back on Queensland (centre ${v.lat.toFixed(1)}, ${v.lon.toFixed(1)}, zoom ${v.zoom.toFixed(1)})`);
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    await p.context().close();
  },
  async pictures(b) {
    // (Shared 0.8 s after a change: after the browser's own save, 0.4 s, which dates the change.)
    const p = await page(b, { pass: true, autosaveMs: 800 });
    await p.pick('41506');
    await p.click('#q-stockFence .opt:has-text("Yes (standard")');
    // A paste on an element: a made-up snip (a canvas) and/or words. → was it taken over?
    const paste = (sel, o) => p.evaluate(async ([sel, o]) => {
      const dt = new DataTransfer();
      if (o.text) dt.setData('text/plain', o.text);
      if (o.w) {
        const c = document.createElement('canvas'); c.width = o.w; c.height = o.h; const g = c.getContext('2d');
        if (o.noise) { const im = g.createImageData(o.w, o.h); for (let i = 0; i < im.data.length; i++) im.data[i] = i % 4 === 3 ? 255 : Math.random() * 256 | 0; g.putImageData(im, 0, 0); }
        else { g.fillStyle = '#fff'; g.fillRect(0, 0, o.w, o.h); g.fillStyle = '#c00'; g.font = '28px sans-serif'; g.fillText(o.label || 'SNIP', 20, o.h / 2); }
        dt.items.add(new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'snip.png', { type: 'image/png' }));
      }
      // Found after the picture is made: the form may have been drawn afresh meanwhile.
      const el = sel ? document.querySelector(sel) : document.body;
      if (el.focus) el.focus();
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, [sel, o || {}]);
    const toast = re => p.waitForFunction(r => new RegExp(r).test(document.querySelector('#toast').textContent), re.source, { timeout: 15000 }).then(() => true, () => false);
    const refs = code => p.evaluate(c => ((SoRT.app.session.answers[c] || {}).pictures || []).map(x => Object.assign({}, x)), code);
    const NOTES = '[data-fk="installNotes::f::notes"]';
    // Each file sent to the store, and whether it names a picture (for the order they go in).
    await p.evaluate(() => { const put = SoRT.shared.putFile; window.__sent = []; SoRT.shared.putFile = (path, text, ...r) => { window.__sent.push([path, /"pictures"/.test(text)]); return put(path, text, ...r); }; });
    ok(await paste(NOTES, { w: 320, h: 180, label: 'GAUGE HUT' }), 'a snip pasted into a question’s text box is taken as a picture');
    await p.waitForSelector('#q-installNotes .pic img', { timeout: 10000 }).catch(() => {});
    const [pic] = await refs('installNotes'), id = pic && pic.id;
    ok(/^[0-9a-f]{16}$/.test(id || '') && pic.w === 320 && pic.h === 180 && /^image\/(png|jpeg)$/.test(pic.type), `the session keeps a reference to it (${id}, ${pic && pic.type})`);
    ok(await p.$eval('#q-installNotes .pic img', e => e.naturalWidth === 320).catch(() => false) && /no landholder names/.test(await p.innerText('#q-installNotes .pic-hint')), 'its thumbnail is on the card, with the reminder that pictures are shared');
    await p.waitForTimeout(700);
    ok(await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sortv2.')).every(k => !/base64|data:image/.test(localStorage.getItem(k)))), 'the picture itself is not in localStorage');
    ok(await p.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('pic-cap')), 'the new picture’s caption box has the cursor');
    await p.fill('#q-installNotes .pic-cap', 'Gauge hut from the north'); await p.press('#q-installNotes .pic-cap', 'Tab');
    ok(!(await paste('#q-installNotes .pic-cap', { text: 'just words' })) && !(await paste(NOTES, { text: 'Words from Excel', w: 200, h: 60 })) && (await refs('installNotes')).length === 1, 'words pasted are left alone — even words that come with a picture of themselves');
    await paste(NOTES, { w: 320, h: 180, label: 'GAUGE HUT' });
    ok(await toast(/already on this question/) && (await refs('installNotes')).length === 1, 'the same picture twice on a question is added once');
    await p.click('#station .sec-head h2');
    await paste(null, { w: 100, h: 50 });
    ok(await toast(/Click into the question the picture belongs to, then paste/), 'a picture pasted outside every question says where to paste it');
    await paste('#q-complexity input', { w: 1600, h: 1600, noise: true });
    ok(await toast(/too big/) && !(await refs('complexity')).length, 'a picture still too big once made smaller is refused, in plain words');
    // 📋 Add picture: from the clipboard; and a picture file dropped on a card.
    await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#0a6'; g.fillRect(0, 0, 400, 300);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await new Promise(r => c.toBlob(r, 'image/png')) })]);
    });
    await p.click('#q-demolition .pic-add');
    await p.waitForSelector('#q-demolition .pic img', { timeout: 10000 }).catch(() => {});
    ok((await refs('demolition')).length === 1, '📋 Add picture takes the picture on the clipboard');
    await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#36c'; g.fillRect(0, 0, 240, 400);
      const dt = new DataTransfer(); dt.items.add(new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'photo.png', { type: 'image/png' }));
      document.querySelector('#q-accessibility .q-label').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await p.waitForSelector('#q-accessibility .pic img', { timeout: 10000 }).catch(() => {});
    ok((await refs('accessibility')).length === 1, 'a picture file dropped on a question is added to it');
    await p.click('#q-accessibility .pic-del');
    ok(!(await refs('accessibility')).length && !(await p.$('#q-accessibility .pic')), '✕ removes a picture (after asking)');
    await p.click('#q-demolition .pic-view');
    ok(await p.waitForSelector('#picDlg[open] img', { timeout: 5000 }).then(() => true, () => false) && (await p.innerText('#picDlg h2')) === await p.evaluate(() => SoRT.app.ctx.byCode.demolition.label) && !/null/.test(await p.innerText('#picDlg')), 'a thumbnail opens the picture larger (no caption: the question’s name only)');
    await p.click('#picDlg .icon-btn');
    await p.click('#q-demolition .opt >> nth=0'); await p.click('#q-demolition .q-clear');
    ok((await refs('demolition')).length === 1 && !!(await p.$('#q-demolition .pic img')), 'Clear empties the answer and leaves its pictures');
    // Word: under the row's answer, sized to fit the answer column, its caption in italics.
    ok(await p.waitForSelector('#preview img[alt="Picture: Gauge hut from the north"]', { timeout: 8000 }).then(() => true, () => false), 'the preview shows it');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    const html = await p.clip();
    ok(/<img src="data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]{200,}" width="320" height="180" alt="Picture: Gauge hut from the north"[^>]*><br><i>Gauge hut from the north<\/i>/.test(html), 'Copy for Word has the picture (a data: URL) at its own size, the caption in italics under it');
    ok(/<img src="data:image\/[a-z]+;base64,[^"]+" width="379" height="284" alt="Picture"/.test(html), 'a wider one is scaled to fit the answer column, keeping its shape');
    const text = await p.evaluate(async () => { for (const it of await navigator.clipboard.read()) if (it.types.includes('text/plain')) return (await it.getType('text/plain')).text(); return ''; });
    ok(/\[Picture: Gauge hut from the north\]/.test(text) && /\[Picture: no caption\]/.test(text), 'and the plain-text copy says where each picture is');
    // Saved to the forum: each picture its own file, sent before the station's file that names it.
    ok(await until(() => p.store.files.has(`stations/pic-${id}.json`) && (p.store.files.get('stations/41506.json') || { text: '' }).text.includes('Gauge hut from the north')), 'the picture is saved to the forum, and the station’s file names it');
    const f = p.store.files.has(`stations/pic-${id}.json`) ? JSON.parse(p.store.files.get(`stations/pic-${id}.json`).text) : {};
    ok(f.schema === 'sort-picture/1' && f.id === id && f.w === 320 && f.h === 180 && String(f.data).length > 200 && !/data:/.test(f.data), 'as its own file: sort-picture/1, the bytes in base64');
    const stFile = JSON.parse((p.store.files.get('stations/41506.json') || { text: '{"sessions":[]}' }).text);
    const sent = await p.evaluate(() => window.__sent), picAt = sent.findIndex(x => x[0] === `stations/pic-${id}.json`);
    ok(picAt >= 0 && picAt < sent.findIndex(x => x[0] === 'stations/41506.json' && x[1])
      && ((((stFile.sessions.slice(-1)[0] || {}).session || {}).answers || {}).installNotes || {}).pictures[0].id === id, `sent before the station’s file, which carries the reference (${sent.map(x => x[0].replace('stations/', '') + (x[1] ? '+' : '')).join(', ')})`);
    ok(!/pic-/.test((p.store.files.get('index.json') || { text: '' }).text), 'the shared list (index.json) doesn’t list pictures');
    ok(await p.evaluate(i => SoRT.pictures.bundle(SoRT.app.session).then(x => !!(x && x[i] && x[i].data)), id), 'Download session carries the pictures');
    // Reload: back from this browser (IndexedDB), nothing fetched.
    const onSession = await p.evaluate(() => SoRT.pictures.idsOf(SoRT.app.session));
    ok(onSession.length === 2 && await until(() => onSession.every(i => p.store.files.has(`stations/pic-${i}.json`)), 15000), 'both pictures still on the session are shared');
    await p.waitForFunction(() => /✓ Saved/.test(document.querySelector('#shareChip').textContent), null, { timeout: 15000 }).catch(() => {});
    let mark = p.store.log.length;
    await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.station-card', { timeout: 40000 });
    await p.waitForSelector('#q-installNotes .pic img', { timeout: 10000 }).catch(() => {});
    const back = { img: !!(await p.$('#q-installNotes .pic img')), cap: await p.inputValue('#q-installNotes .pic-cap').catch(() => null), asked: p.store.log.slice(mark).filter(x => /pic-/.test(x)) };
    ok(back.img && back.cap === 'Gauge hut from the north' && !back.asked.length, `after a reload the picture is still on the card, from this browser (${JSON.stringify(back)})`);
    // This browser's copy gone: back from the forum's store.
    ok(await p.evaluate(() => new Promise(r => { localStorage.removeItem('sortv2.pics.shared'); const d = indexedDB.deleteDatabase('sortv2'); d.onsuccess = () => r(true); d.onerror = () => r(false); setTimeout(() => r(false), 5000); })), 'this browser’s pictures deleted');
    mark = p.store.log.length;
    await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.station-card', { timeout: 40000 });
    await p.waitForSelector('#q-installNotes .pic img', { timeout: 15000 }).catch(() => {});
    ok(!!(await p.$('#q-installNotes .pic img')) && p.store.log.slice(mark).includes(`GET files/stations/pic-${id}.json`), 'and it comes back from the forum’s store');
    ok(!p.errors.length, `no page errors ${p.errors.join('; ')}`);
    // Another computer, the same store: Sessions → Open fetches the session's pictures.
    const q = await page(b, { pass: true });
    for (const [k, v] of p.store.files) q.store.files.set(k, v);
    await q.evaluate(() => SoRT.playbook.loadIndex());
    await q.click('#sessionsBtn'); await q.fill('#sessionsSearch', 'bengalla');
    await q.click('.pb-panel .sess button:has-text("Open")');
    await q.waitForSelector('#q-installNotes .pic img', { timeout: 20000 }).catch(() => {});
    ok(!!(await q.$('#q-installNotes .pic img')) && (await q.inputValue('#q-installNotes .pic-cap')) === 'Gauge hut from the north' && !!(await q.$('#q-demolition .pic img')), 'another computer opening the shared session gets its pictures');
    ok(!q.errors.length, `no page errors there ${q.errors.join('; ')}`);
    await q.context().close();
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
