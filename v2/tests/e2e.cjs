#!/usr/bin/env node
/* SoRT v2 — end-to-end checks in headless Chromium.

     cd SoRT && python3 -m http.server 8642 --bind 127.0.0.1 &
     node v2/tests/e2e.cjs [scenario ...]        # all scenarios when none named

   Scenarios: station, copy, playbook, editor, tasks, layout, help, map. They use the live Flood-Net
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
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1360, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  if (o.token) await ctx.addInitScript(() => { try { localStorage.setItem('sort.github', JSON.stringify({ token: 'fake', login: 'tester' })); } catch (e) { /* */ } });
  let defsText = require('fs').readFileSync(require('path').join(__dirname, '..', 'definitions.json'), 'utf8');
  if (o.defsPatch) { const d = JSON.parse(defsText); o.defsPatch(d); defsText = JSON.stringify(d); }
  const gh = fakeGithub(defsText);
  await ctx.route(/api\.github\.com/, gh.handler);
  await ctx.route(o.map ? /raw\.githubusercontent\.com/ : /raw\.githubusercontent\.com|js\.arcgis\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('dialog', d => (d.type() === 'prompt' ? d.accept('Test change') : d.accept()));
  await p.goto(BASE, { waitUntil: 'load' });
  // A clean browser — but past the first-visit Help nudge, so its toast never
  // lands on top of a toast a check is waiting for (the help scenario wants it).
  await p.evaluate(fresh => { for (const k of Object.keys(localStorage)) if (k.startsWith('sortv2.')) localStorage.removeItem(k); if (!fresh) localStorage.setItem('sortv2.helpSeen', '1'); }, !!o.freshHelp);
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
    // The radio path: every saved figure is stale today, so it's shown, flagged, and not used as an answer.
    ok(/Radio path\s*→ Toowoomba AL \(−?\d/.test(await p.innerText('.station-card')), 'radio path on the station card');
    const fm = await p.innerText('#q-fadeMargin [data-hint="station.fadeMargin"]').catch(() => '');
    ok(/Fifteen Mile AL → Toowoomba AL \([+−]?[\d.]+ dB\) → /.test(fm), 'fade margin question shows the path to base, hop by hop');
    ok(/Stale/.test(fm) ? /not a pass or fail/.test(fm) : true, 'stale figures are flagged as a rough guide');
    ok(/Measured on site/.test(fm), 'the attenuator test measured on site is shown');
    ok(/stations&station=fifteen_mile_al/.test(await p.getAttribute('#q-fadeMargin .hint-link', 'href')), 'and links to the station on Flood-Net’s map');
    ok(/Stale/.test(fm) ? !(await p.$$eval('#q-fadeMargin .opt.on', e => e.length)) : true, 'stale figures don’t answer the question');
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
  async tasks(b) {
    const p = await page(b, { defsPatch: d => { d.tasks.enabled = true; } });
    await p.pick('41506');
    await p.click('#q-comms .opt:has-text("Local Processing Unit")');
    await p.click('#q-remediation .opt:has-text("Vegetation management")');
    await p.waitForTimeout(400);
    const teams = await p.$$eval('#followups .fu-task select', e => e.map(x => x.selectedOptions[0].textContent));
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
    ok(JSON.stringify(data.tasks.find(t => t.ref === 'alertIds').team) === '{"hub":"brisbane"}', 'ALERT IDs task goes to the station’s hub team');
    ok((await p.$$eval('#followups .fu-task .hint', e => e.map(x => x.textContent))).some(t => /sent to Flood-Net/.test(t)), 'marked as sent');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 60000 });
    ok(/Check the gauge board datum/.test(await p.clip()), 'the forum’s own task is in the Word copy’s follow-up row');
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
    await p.click('.loc[data-pin="relocation.newLocation"] button:has-text("Place")');
    await p.waitForTimeout(300);
    const box = await (await p.$('#mapView')).boundingBox();
    await p.mouse.click(box.x + box.width / 2 + 120, box.y + box.height / 2 - 80);
    await p.waitForTimeout(1200);
    ok((await p.$$eval('#q-relocation .opt.on', e => e.map(x => x.textContent))).join() === 'Yes', 'placing the relocation site answers Relocation');
    ok(/^\d+$/.test(await p.$eval('[data-fk="relocation::f::distance"]', e => e.value)), 'relocation distance measured');
    await p.click('.top .copy-btn');
    await p.waitForFunction(() => /Copied|failed/i.test(document.querySelector('#toast').textContent), null, { timeout: 90000 });
    const html = await p.clip();
    ok(/<img/.test(html), 'map picture copied');
    await p.$eval('#preview', e => e.scrollIntoView({ block: 'center' }));
    ok(await p.waitForFunction(() => !!document.querySelector('#preview img[alt="Site map"]'), null, { timeout: 30000 }).then(() => true).catch(() => false), 'the preview shows the map picture');
    ok(/Survey marks near Abergowrie Bridge AL \(532028\)/.test(html), 'survey marks table copied, headed with the station');
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
