/* SoRT v2 — floodnet.js
   Station particulars from Flood-Net's public, read-only API
   (https://floodwarning.net/api/v1 — docs/agent-api.md in the MegaNet repo).
   CORS is open and no key is needed; requests carry ?client=sort-v2 (a query
   parameter rather than the X-FloodNet-Client header, so the browser sends no
   preflight). Nothing is ever written back.

   One station costs 2–5 requests: the search, its dossier, and the record of up
   to three repeaters that pass its ALERT addresses (to infer the frequency it
   transmits on — Flood-Net records frequencies on repeaters, not field
   stations). Answers are cached for the tab's life. If the API can't be
   reached, the station is typed in by hand and nothing else is affected. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;

  const API = 'https://floodwarning.net/api/v1';
  const CLIENT = 'sort-v2';
  const cache = new Map();

  function url(path, params) {
    const u = new URL(API + path);
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
    u.searchParams.set('client', CLIENT);
    return u.toString();
  }
  async function get(path, params, opts) {
    const key = url(path, params);
    if (cache.has(key)) return cache.get(key);
    const p = U().fetchJson(key, Object.assign({ timeoutMs: 15000 }, opts || {}));
    cache.set(key, p);
    try { return await p; } catch (e) { cache.delete(key); throw e; }
  }

  const search = (q, limit) => get('/stations', { q, limit: limit || 8 });
  const dossier = id => get(`/stations/${encodeURIComponent(id)}/dossier`);
  const record = id => get(`/stations/${encodeURIComponent(id)}`);
  const near = (lat, lon, radiusKm, limit) => get('/stations', { near: `${lat},${lon}`, radius_km: radiusKm || 3, limit: limit || 50 });
  // Licences at the site (Flood-Net's ACMA route). Optional: an older API
  // without it answers 404 and the caller carries on without.
  const acma = (id, freq) => get(`/stations/${encodeURIComponent(id)}/acma`, freq ? { freq_mhz: freq } : null, { timeoutMs: 12000 });

  const KIND_LABEL = { rain: 'Rain', river: 'River', repeater: 'Repeater', base: 'Base' };

  // What is on site now, as far as Flood-Net can tell.
  function commsGuess(d) {
    const nr = d.networks_and_radio || {}, tel = d.telemetry || {};
    const alert = Object.keys(nr.alert_ids || {}).length > 0 || ((tel.sensors || {}).items || []).some(s => s.alert_id != null);
    const sat = !!(nr.satcom && nr.satcom.enabled);
    if (alert && sat) return { code: 'unknown', why: 'Flood-Net records both ALERT IDs and a satellite terminal' };
    if (alert) return { code: 'errts', why: 'it has ALERT IDs in Flood-Net' };
    if (sat) return { code: 'satellite', why: `Flood-Net records a satellite terminal${nr.satcom.provider ? ' (' + nr.satcom.provider + ')' : ''}` };
    const sensors = ((tel.sensors || {}).items || []).length;
    if (sensors) return { code: 'cellular', why: 'no ALERT IDs or satellite terminal in Flood-Net, so most likely an IP logger on cellular' };
    return { code: 'unknown', why: 'Flood-Net has no telemetry recorded for it' };
  }

  function rangesText(list) {
    return (list || []).map(r => (r.low === r.high ? `${r.low}` : `${r.low}–${r.high}`)).join(', ');
  }
  // ALERT channels sit 6.25 kHz apart: four decimals where they matter, never fewer than three.
  function freqText(mhz) { return mhz == null ? '' : `${Number(mhz).toFixed(4).replace(/0$/, '')} MHz`; }

  /* The station's radio as Flood-Net's path model has it set up (the dossier's
     rm_system): transmit power, antenna, its gain and height. Flood-Net works
     the fade margins out from these, so they are worth a check against what is
     really on site — the TX power question starts from the power here. */
  function radioSystemFacts(rm) {
    if (!rm || (rm.tx_power_w == null && !rm.antenna_type && rm.antenna_gain_dbi == null)) return null;
    const ant = String(rm.antenna_type || '').replace(/\.ant$/i, '');
    return { name: rm.name || '', txPowerW: rm.tx_power_w != null ? Number(rm.tx_power_w) : null, antenna: ant,
      gainDbi: rm.antenna_gain_dbi != null ? Number(rm.antenna_gain_dbi) : null, heightM: rm.antenna_height_m != null ? Number(rm.antenna_height_m) : null,
      lineLossDb: rm.line_loss_db != null ? Number(rm.line_loss_db) : null };
  }
  const wattText = w => `${Number(w)} W`;
  function radioText(r) {
    const ant = [r.antenna && `${r.antenna} antenna`, r.gainDbi != null && `${r.gainDbi} dBi`, r.heightM != null && `at ${r.heightM} m`].filter(Boolean).join(' ');
    return [r.txPowerW != null && `TX ${wattText(r.txPowerW)}`, ant, r.lineLossDb != null && `line loss ${r.lineLossDb} dB`].filter(Boolean).join(' · ') + (r.name ? ` — “${r.name}” in Flood-Net’s radio model` : ' — from Flood-Net’s radio model');
  }

  // The facts SoRT keeps about a station (session.station), from its dossier.
  async function stationFacts(id) {
    const d = await dossier(id);
    const idn = d.identity || {}, loc = d.location || {}, nr = d.networks_and_radio || {}, tel = d.telemetry || {};
    const sls = ((d.service_level || {}).entries || (d.service_level || {}).items || [])[0] || null;
    const addresses = [];
    ((tel.sensors || {}).items || []).forEach(s => { if (s.alert_id != null && !addresses.some(a => a.id === s.alert_id)) addresses.push({ id: s.alert_id, type: s.type }); });
    Object.entries(nr.alert_ids || {}).forEach(([k, v]) => { if (!addresses.some(a => a.id === v)) addresses.push({ id: v, type: k }); });
    const guess = commsGuess(d);
    const facts = {
      source: 'floodnet', id: idn.id || id, number: idn.station_number || '', name: idn.name || id,
      awrc: idn.awrc_number || '', proposed: !!idn.proposed,
      lat: loc.lat, lon: loc.lon, precision: loc.lat != null ? U().coordPrecision(loc.lat, loc.lon) : null,
      elevation: loc.elevation_ahd_m != null ? { m: loc.elevation_ahd_m, source: loc.elevation_source } : null,
      kinds: idn.kinds || [], roles: idn.roles || [],
      hubId: (loc.hub || {}).id || '', hubName: (loc.hub || {}).name || '', lga: loc.lga || '', basin: loc.basin || '', stream: loc.stream || '',
      owner: (sls && sls.owner) || idn.owner || '', sls: sls ? { gaugeType: sls.gauge_type, dataType: sls.data_type, priority: sls.priority, owner: sls.owner } : null,
      alertIds: addresses, satcom: !!(nr.satcom && nr.satcom.enabled),
      commsGuess: guess.code, commsWhy: guess.why,
      txFrequency: null, radioSystem: radioSystemFacts(nr.rm_system), repeater: null, acma: null, acmaLicence: '', acmaHolder: '', fadeMargin: null,
      lastHeard: ((tel.health || {}).last_seen_at) || null,
      fetchedAt: Date.now(), app: (d.links || {}).app || `https://floodwarning.net/?station=${encodeURIComponent(id)}`
    };
    // A repeater's own radio record.
    if (nr.repeater && nr.repeater.status === 'ok') {
      facts.repeater = { rx: nr.repeater.rx_mhz, tx: nr.repeater.tx_mhz, passRanges: rangesText(nr.repeater.pass_ranges), acma: nr.repeater.acma_licence || '', owner: idn.owner || '' };
    }
    // Fade margin: what Flood-Net modelled, and what was last measured on site.
    const links = ((nr.link_margins || {}).links || []).filter(l => l.margin_db != null);
    const visits = ((d.inspections || {}).recent_visits || []);
    let measured = null;
    for (const v of visits) {
      const fm = v.fade_margin_db_by_phase || {};
      const db = fm.this_visit != null ? fm.this_visit : (fm.after != null ? fm.after : fm.before);
      if (db != null) { measured = { db, date: v.date }; break; }
    }
    if (links.length || measured) facts.fadeMargin = {
      modelled: links.slice(0, 2).map(l => ({ to: (l.other_station || {}).name || '', db: l.margin_db, verdict: l.verdict || '', km: l.distance_km })),
      measured
    };
    // The radio path to base, with each hop's saved fade margin (it supersedes
    // fadeMargin above, which stays for sessions saved before it).
    facts.radioPath = radioPathFacts(d.radio_path);
    // Frequency: the repeaters that pass its addresses listen on it.
    const rpt = (((nr.repeaters_listening || {}).repeaters) || []).slice(0, 3);
    if (rpt.length && !facts.repeater) {
      const got = await Promise.all(rpt.map(r => record(r.id).then(x => ({ name: r.name, rx: ((x.station || {}).repeater || {}).rx_mhz })).catch(() => null)));
      const seen = got.filter(g => g && g.rx != null);
      if (seen.length) {
        const counts = {};
        seen.forEach(g => { counts[g.rx] = (counts[g.rx] || 0) + 1; });
        const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        facts.txFrequency = { mhz: Number(best), from: seen.filter(g => String(g.rx) === best).map(g => g.name),
          others: seen.filter(g => String(g.rx) !== best).map(g => `${g.name} ${freqText(g.rx)}`) };
      }
    } else if (facts.repeater && facts.repeater.tx != null) {
      facts.txFrequency = { mhz: facts.repeater.tx, from: ['its own repeater record'], others: [] };
    }
    // ACMA licences (Flood-Net's /acma route): what Flood-Net records for the
    // station, what the ACMA register has at the site on its channel, and the
    // repeaters that relay it. Matched to the inferred frequency for a field
    // station. Optional: without the route the licence is simply typed in.
    try {
      const a = await acma(facts.id, facts.txFrequency ? facts.txFrequency.mhz : null);
      const holder = l => (l && (l.trading_name || l.name)) || '';
      const rec = ((a.recorded || {}).licences || []).map(l => ({ licence: l.register_licence || l.licence,
        what: [l.label || (l.recorded_on === 'repeater' ? 'repeater pair' : ''), l.rx_mhz ? freqText(l.rx_mhz) : ''].filter(Boolean).join(' '),
        holder: holder(l.licensee), status: l.status || (l.in_register ? '' : 'not in the register'), expiry: l.expiry || '', expired: !!l.expiry_passed }));
      const reg = ((a.register || {}).licences || []).filter(l => l.matches_station_frequency || l.recorded_by_floodnet)
        .filter(l => !rec.some(r => r.licence === l.licence)).slice(0, 4)
        .map(l => ({ licence: l.licence, what: (l.frequencies_mhz || []).map(freqText).join(', '), holder: holder(l.licensee),
          site: (l.site || {}).name || '', distanceM: (l.site || {}).distance_m, status: l.status || '', expiry: l.expiry || '', expired: !!l.expiry_passed }));
      const relayed = (((a.relayed_by || {}).repeaters) || []).slice(0, 3).map(r => ({ name: r.name, rx: r.rx_mhz,
        licences: (r.licences || []).map(l => l.register_licence || l.licence).slice(0, 2) }));
      const reg0 = a.register || {};
      facts.acma = { recorded: rec, register: reg, relayed, radiusM: reg0.radius_m || 500,
        nearest: reg0.nearest_site ? { name: reg0.nearest_site.name, distanceM: reg0.nearest_site.distance_m } : null,
        extract: a.register_extract ? { date: a.register_extract.source_date, stale: !!a.register_extract.stale } : null };
      const first = rec[0] || reg[0];
      if (first) { facts.acmaLicence = first.licence; facts.acmaHolder = first.holder; }
    } catch (_) {
      // No ACMA route: fall back to what the dossier itself records.
      const own = [];
      if (facts.repeater && facts.repeater.acma) own.push({ licence: facts.repeater.acma, what: 'repeater pair', holder: '' });
      ((nr.frequencies || {}).items || []).forEach(f => { if (f.acma_licence) own.push({ licence: f.acma_licence, what: `${f.label || 'channel'} ${freqText(f.rx_mhz)}`, holder: '' }); });
      facts.acma = { recorded: own, register: [], relayed: [], extract: null };
      if (own[0]) facts.acmaLicence = own[0].licence;
    }
    return facts;
  }

  // Which station type (template) suits this station, from each template's `suggest`.
  function suggestTemplate(defs, st) {
    if (!st) return null;
    const ts = defs.templates || [];
    const ownerOk = t => t.suggest && t.suggest.ownerMatches && new RegExp(t.suggest.ownerMatches, 'i').test(st.owner || '');
    const roleOk = t => t.suggest && t.suggest.roles && t.suggest.roles.some(r => (st.roles || []).includes(r));
    const kindOk = t => t.suggest && t.suggest.kinds && t.suggest.kinds.some(k => (st.kinds || []).includes(k))
      && !(t.suggest.notKinds || []).some(k => (st.kinds || []).includes(k));
    return (ts.find(roleOk) || ts.find(ownerOk) || ts.find(kindOk) || {}).id || null;
  }

  // Put Flood-Net's answers into session.prefill for the session's template.
  // Never touches session.answers: anything a person chose stays.
  function applyPrefill(defs, session) {
    const st = session.station;
    const pre = session.prefill;
    // Drop earlier Flood-Net suggestions first (a different station, or a refresh).
    Object.keys(pre).forEach(k => { if (pre[k] && pre[k].src === 'floodnet') delete pre[k]; });
    if (!st) return;
    const qs = S.schema.templateQuestions(defs, session.template);
    const has = c => qs.find(q => q.code === c);
    const put = (code, part) => {
      if (pre[code] && !['floodnet', 'map'].includes(pre[code].src)) return;   // an earlier session's or a precedent's answer stands
      pre[code] = Object.assign({ src: 'floodnet', fields: {} }, pre[code] && pre[code].src === 'floodnet' ? pre[code] : {}, part);
    };
    if (has('coords') && st.lat != null) {
      const pos = st.checked ? U().formatCoord(st.checked.lat, st.checked.lon) : U().formatCoord(st.lat, st.lon);
      put('coords', { fields: { existing: pos }, src: st.checked ? 'map' : 'floodnet' });
    }
    if (has('currentComms') && st.commsGuess && st.commsGuess !== 'unknown') put('currentComms', { value: st.commsGuess });
    if (has('frequency') && st.txFrequency) {
      const q = has('frequency');
      const want = Number(st.txFrequency.mhz).toFixed(3);
      const opt = S.schema.flatOptions(q.options).find(o => o.label.startsWith(want));
      const other = S.schema.flatOptions(q.options).find(o => o.other);
      if (opt) put('frequency', { value: opt.code });
      else if (other) put('frequency', { value: other.code, other: freqText(st.txFrequency.mhz) });
    }
    // TX power, as Flood-Net's radio model has the station (1 W, 5 W…): the matching answer, or Other with the figure.
    if (has('txPower') && st.radioSystem && st.radioSystem.txPowerW != null && st.commsGuess !== 'cellular' && st.commsGuess !== 'satellite') {
      const q = has('txPower'), w = st.radioSystem.txPowerW, flat = S.schema.flatOptions(q.options);
      const opt = flat.find(o => !o.other && parseFloat(o.label) === w && /w\b/i.test(o.label));
      const other = flat.find(o => o.other);
      if (opt) put('txPower', { value: opt.code });
      else if (other) put('txPower', { value: other.code, other: wattText(w) });
    }
    if (has('acmaLicence') && st.acmaLicence) put('acmaLicence', { fields: { licenceNo: st.acmaLicence, holder: st.acmaHolder || '' } });
    if (has('repeaterRadio') && st.repeater) put('repeaterRadio', { fields: {
      rx: st.repeater.rx != null ? Number(st.repeater.rx).toFixed(4).replace(/0$/, '') : '',
      tx: st.repeater.tx != null ? Number(st.repeater.tx).toFixed(4).replace(/0$/, '') : '',
      passRanges: st.repeater.passRanges || '', owner: st.repeater.owner || '' } });
    // Fade Margin >20 dB, only once Flood-Net has worked the station's own hops
    // out afresh (stale figures read far too low). Its own hop is what an
    // attenuator test at the station measures: the best of its first hops.
    const fmq = has('fadeMargin'), rp = st.radioPath;
    if (fmq && rp && rp.status === 'ok' && S.schema.option(fmq, 'yes') && S.schema.option(fmq, 'no')) {
      const firsts = rp.repeaters.map(r => r.first).filter(Boolean);
      const fresh = firsts.filter(x => x.db != null && !x.stale);
      if (fresh.some(x => x.db > 20)) put('fadeMargin', { value: 'yes' });
      else if (firsts.length && fresh.length === firsts.length) put('fadeMargin', { value: 'no' });
    }
    // Station type, where the kinds make the answer plain.
    const stq = has('stationType');
    if (stq) {
      const kinds = st.kinds || [];
      const rain = kinds.includes('rain'), river = kinds.includes('river');
      const want = rain && river ? /^rain gauge \/ water level$/i : rain ? /^rain gauge$/i : river ? /^water level$/i : null;
      const opt = want && S.schema.flatOptions(stq.options).find(o => want.test(o.label.trim()));
      if (opt) put('stationType', { value: stq.type === 'multi' ? [opt.code] : opt.code });
    }
  }

  /* The radio path to base, as the dossier carries Flood-Net's /radio-path: the
     best route with each hop's saved fade margin, the repeaters that pass the
     station's ALERT IDs (its possible first hops), and the attenuator tests
     measured on site. A saved margin can be stale — worked out with an older
     model, or an end of the hop has changed since — so it is kept with that
     flag, and said in words, never read as a pass or fail. */
  function radioPathFacts(rp) {
    if (!rp) return null;
    if (rp.status !== 'ok') return { status: rp.status || 'unknown', summary: (rp.summary || [])[0] || rp.reason || '' };
    const names = {}, full = {};
    (rp.hops || []).forEach(x => {
      if (x.from) names[x.from.id] = x.from.name;
      if (x.to) names[x.to.id] = x.to.name;
      if (x.from && x.to) full[`${x.from.id}>${x.to.id}`] = x;
    });
    const learn = r => {   // names along a route, from its "A → B → C" and its ids
      if (!r || !r.route || !r.stations) return;
      const ns = r.route.split(' → ');
      if (ns.length === r.stations.length) r.stations.forEach((id, i) => { if (!names[id]) names[id] = ns[i]; });
    };
    const items = (rp.repeaters || {}).items || [];
    learn(rp.best_path);
    items.forEach(it => { names[it.id] = it.name; ((it.to_base || {}).routes || []).forEach(learn); });
    const hop = x => {
      if (!x) return null;
      const f = full[`${x.from}>${x.to}`] || {};
      return { from: names[x.from] || x.from, to: names[x.to] || x.to, db: x.status === 'ok' && x.margin_db != null ? x.margin_db : null,
        stale: !!x.stale, at: f.computed_at || null, why: (f.stale_reasons || []).map(r => r.reason) };
    };
    const b = rp.best_path && rp.best_path.status === 'ok' ? rp.best_path : null;
    const model = rp.model || {};
    return {
      status: 'ok', startsAs: rp.starts_as || '',
      best: b ? { route: b.route || '', base: (b.base || {}).name || '', km: b.distance_km, complete: !!b.complete, hops: (b.hops || []).map(hop) } : null,
      repeaters: items.slice(0, 5).map(it => ({ name: it.name, km: it.distance_km, first: it.first_hop ? hop(it.first_hop) : null, routes: (it.to_base || {}).routes_found || 0 })),
      oldModel: Object.keys(model.saved_models || {}).some(m => m !== model.current),
      tests: ((rp.measured || {}).tests || []).map(t => ({ date: t.date, db: t.this_visit_db != null ? t.this_visit_db : t.original_db }))
        .filter(t => t.db != null).slice(0, 3),
      summary: (rp.summary || [])[0] || ''
    };
  }
  const dbText = v => (v == null ? 'not modelled' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} dB`);
  // "A → B (−22.8 dB) → C (+5.2 dB)": each hop's margin after the station it reaches.
  function pathText(rp, fromName) {
    const hs = (rp.best && rp.best.hops) || [];
    return [hs.length ? hs[0].from : fromName].concat(hs.map(x => `${x.to} (${dbText(x.db)})`)).join(' → ');
  }
  const STALE_WORDS = { model: 'worked out with an older model', moved: 'a station has moved since', height: 'a ground height has changed since',
    antenna: 'an antenna has changed since', radio: 'a radio has changed since', frequency: 'the frequency has changed since', unreadable: 'the saved inputs can’t be checked' };
  function radioPathHint(st, rp) {
    const lines = [], b = rp.best;
    if (b && b.hops.length) lines.push({ text: `Radio path to base (Flood-Net): ${pathText(rp, st.name)}${b.complete ? '' : ' — not every hop is modelled yet'}.` });
    else if (rp.startsAs === 'base station') lines.push({ text: 'Flood-Net: a base station — there is no radio path on from it.' });
    else lines.push({ text: `Flood-Net: ${rp.summary || 'no radio path to a base station found.'}` });
    const stale = b ? b.hops.filter(x => x.stale) : [];
    if (stale.length) {
      const when = stale.map(x => x.at).filter(Boolean).sort()[0];
      const why = [...new Set([].concat(...stale.map(x => x.why)))].map(r => STALE_WORDS[r] || r);
      lines.push({ warn: true, title: why.length ? `Why: ${why.join('; ')}.` : null,
        text: `Stale — ${stale.length === b.hops.length ? 'every figure was' : `${stale.length} of ${b.hops.length} figures were`} saved${when ? ' ' + U().dmy(when) : ''}${rp.oldModel ? ' with Flood-Net’s older model, which reads far too low' : ', and a station or its radio has changed since'}: a rough guide, not a pass or fail.` });
    }
    if (rp.tests.length) {
      const [t, ...earlier] = rp.tests;
      lines.push({ text: `Measured on site: its reports still reached base through ${t.db} dB of added loss (${U().dmy(t.date)})${earlier.length ? `; earlier ${earlier.map(x => `${x.db} dB (${U().dmy(x.date)})`).join(', ')}` : ''}.` });
    }
    const firstTo = b && b.hops[0] ? b.hops[0].to : null;
    const others = rp.repeaters.filter(r => r.first && r.name !== firstTo);
    if (others.length) lines.push({ text: `Also passed by ${others.map(r => `${r.name} (${Math.round(r.km)} km, ${r.first.db == null ? 'not modelled' : dbText(r.first.db) + (r.first.stale ? ', stale' : '')})`).join('; ')}.` });
    return { lines, link: { href: `https://floodwarning.net/?tab=stations&station=${encodeURIComponent(st.id)}`, label: 'On Flood-Net’s Stations map ↗',
      title: 'Opens the station on Flood-Net’s Stations map, where Path tools can work a hop out afresh' } };
  }

  // Hints shown under a question (q.hintFrom): a sentence, or { lines, link }.
  function hint(st, key) {
    if (!st) return null;
    if (key === 'station.fadeMargin' && st.radioPath && st.radioPath.status === 'ok') return radioPathHint(st, st.radioPath);
    if (key === 'station.fadeMargin' && st.fadeMargin) {
      const fm = st.fadeMargin, parts = [];
      fm.modelled.forEach(m => parts.push(`modelled ${m.db > 0 ? '+' : ''}${m.db} dB to ${m.to}${m.verdict ? ` (${m.verdict})` : ''}`));
      if (fm.measured) parts.push(`last measured on site ${fm.measured.db} dB (${U().dmy(fm.measured.date)})`);
      return parts.length ? `Flood-Net: ${parts.join('; ')}.` : null;
    }
    // No path to show (a base station, a station without ALERT IDs): Flood-Net's reason.
    if (key === 'station.fadeMargin' && st.radioPath && st.radioPath.summary) return `Flood-Net: ${st.radioPath.summary}`;
    if (key === 'station.acma' && st.acma) {
      const A = st.acma, parts = [];
      const one = l => `${l.licence}${l.what ? ' (' + l.what + ')' : ''}${l.holder ? ' — ' + l.holder : ''}${l.expired ? ', EXPIRED' : ''}`;
      if (A.recorded.length) parts.push(`Flood-Net records ${A.recorded.map(one).join('; ')}.`);
      if (A.register.length) parts.push(`In the ACMA register at the site on its channel: ${A.register.map(l => one(l) + (l.distanceM != null ? ` at ${U().fmtDist(l.distanceM)}` : '')).join('; ')}.`);
      else if (!A.recorded.length) parts.push(`No licence in the ACMA register within ${U().fmtDist(A.radiusM || 500)}${A.nearest ? ` (nearest registered site ${A.nearest.name}, ${U().fmtDist(A.nearest.distanceM)})` : ''}.`);
      if (A.relayed.length) parts.push(`Relayed by ${A.relayed.map(r => `${r.name}${r.rx ? ' (' + freqText(r.rx) + ')' : ''}${r.licences.length ? ', licence ' + r.licences.join(', ') : ', no licence recorded'}`).join('; ')}.`);
      if (A.extract) parts.push(`Register extract of ${U().dmy(A.extract.date)}${A.extract.stale ? ' — check anything newer on the ACMA register' : ''}.`);
      return parts.length ? parts.join(' ') : null;
    }
    if (key === 'station.txPower' && st.radioSystem && st.radioSystem.txPowerW != null) {
      return `Flood-Net: ${radioText(st.radioSystem)}. That is how its fade margins were worked out — confirm it is what is on site.`;
    }
    if (key === 'station.txFrequency' && st.txFrequency) {
      return `Flood-Net: the repeaters passing its ALERT IDs (${st.txFrequency.from.join(', ')}) listen on ${freqText(st.txFrequency.mhz)}${st.txFrequency.others.length ? '; others: ' + st.txFrequency.others.join(', ') : ''}. Inferred — confirm.`;
    }
    return null;
  }

  S.floodnet = { API, search, dossier, record, near, acma, stationFacts, radioPathFacts, pathText, dbText, suggestTemplate, applyPrefill, hint, commsGuess, freqText, radioText, KIND_LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
