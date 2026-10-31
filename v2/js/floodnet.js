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
  const acma = id => get(`/stations/${encodeURIComponent(id)}/acma`, null, { timeoutMs: 12000 });

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
  function freqText(mhz) { return mhz == null ? '' : `${Number(mhz).toFixed(3)} MHz`; }

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
      txFrequency: null, repeater: null, acma: [], acmaLicence: '', fadeMargin: null,
      lastHeard: ((tel.health || {}).last_seen_at) || null,
      fetchedAt: Date.now(), app: (d.links || {}).app || `https://floodwarning.net/?station=${encodeURIComponent(id)}`
    };
    // A repeater's own radio record.
    if (nr.repeater && nr.repeater.status === 'ok') {
      facts.repeater = { rx: nr.repeater.rx_mhz, tx: nr.repeater.tx_mhz, passRanges: rangesText(nr.repeater.pass_ranges), acma: nr.repeater.acma_licence || '', owner: idn.owner || '' };
      if (nr.repeater.acma_licence) facts.acma.push({ licence: nr.repeater.acma_licence, what: `repeater ${freqText(nr.repeater.rx_mhz)} RX / ${freqText(nr.repeater.tx_mhz)} TX`, from: 'Flood-Net' });
    }
    ((nr.frequencies || {}).items || []).forEach(f => { if (f.acma_licence) facts.acma.push({ licence: f.acma_licence, what: `${f.label || 'channel'} ${freqText(f.rx_mhz)}`, from: 'Flood-Net' }); });
    facts.acmaLicence = (facts.acma[0] || {}).licence || '';
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
    // ACMA register licences at the site, where Flood-Net serves them.
    try {
      const a = await acma(facts.id);
      const list = (a && (a.licences || a.register || a.items)) || [];
      list.slice(0, 6).forEach(l => {
        const no = l.licence || l.licence_no || l.number;
        if (!no || facts.acma.some(x => x.licence === no)) return;
        facts.acma.push({ licence: no, what: [l.licensee || l.client, l.f_mhz ? freqText(l.f_mhz) : (l.frequencies_mhz ? l.frequencies_mhz.map(freqText).join(', ') : '')].filter(Boolean).join(' · '),
          from: 'ACMA register', distanceM: l.distance_m });
      });
      if (!facts.acmaLicence && facts.acma[0]) facts.acmaLicence = facts.acma[0].licence;
    } catch (_) { /* no ACMA route (yet) — the licence is typed in */ }
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
    const put = (code, part) => { pre[code] = Object.assign({ src: 'floodnet', fields: {} }, pre[code] && pre[code].src === 'floodnet' ? pre[code] : {}, part); };
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
      else if (other) put('frequency', { value: other.code });
    }
    if (has('acmaLicence') && st.acmaLicence) put('acmaLicence', { fields: { licenceNo: st.acmaLicence } });
    if (has('repeaterRadio') && st.repeater) put('repeaterRadio', { fields: {
      rx: st.repeater.rx != null ? Number(st.repeater.rx).toFixed(4).replace(/0$/, '') : '',
      tx: st.repeater.tx != null ? Number(st.repeater.tx).toFixed(4).replace(/0$/, '') : '',
      passRanges: st.repeater.passRanges || '', owner: st.repeater.owner || '' } });
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

  // Hints shown under a question (q.hintFrom).
  function hint(st, key) {
    if (!st) return null;
    if (key === 'station.fadeMargin' && st.fadeMargin) {
      const fm = st.fadeMargin, parts = [];
      fm.modelled.forEach(m => parts.push(`modelled ${m.db > 0 ? '+' : ''}${m.db} dB to ${m.to}${m.verdict ? ` (${m.verdict})` : ''}`));
      if (fm.measured) parts.push(`last measured on site ${fm.measured.db} dB (${U().dmy(fm.measured.date)})`);
      return parts.length ? `Flood-Net: ${parts.join('; ')}.` : null;
    }
    if (key === 'station.acma' && st.acma && st.acma.length) {
      return `Licences Flood-Net knows of here: ${st.acma.map(a => `${a.licence}${a.what ? ' (' + a.what + ')' : ''}`).join('; ')}.`;
    }
    if (key === 'station.txFrequency' && st.txFrequency) {
      return `Flood-Net: the repeaters passing its ALERT IDs (${st.txFrequency.from.join(', ')}) listen on ${freqText(st.txFrequency.mhz)}${st.txFrequency.others.length ? '; others: ' + st.txFrequency.others.join(', ') : ''}. Inferred — confirm.`;
    }
    return null;
  }

  S.floodnet = { API, search, dossier, record, near, acma, stationFacts, suggestTemplate, applyPrefill, hint, commsGuess, freqText, KIND_LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
