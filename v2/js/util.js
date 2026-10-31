/* SoRT v2 — util.js
   Small shared helpers: DOM building, escaping, ids, dates, and the one
   coordinate parser (carried over from v1 unchanged in behaviour, so "a valid
   coordinate" means the same thing in the form, on the map and in Word).
   Classic script: everything hangs off globalThis.SoRT so the page works from
   GitHub Pages or a downloaded copy, and Node can load the same files for the
   definitions check (v2/tools/check-definitions.mjs). */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Escape, keeping the user's line breaks as <br> (Word keeps them too).
  const escLines = s => esc(String(s == null ? '' : s).replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
  // One line for the plain-text copy: breaks become "; ".
  const flat = s => String(s == null ? '' : s).replace(/\s*(?:\r\n|\r|\n)+\s*/g, '; ').trim();

  // h('div', {class:'x', onclick: fn}, child, 'text', [more]) → element.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    const add = c => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function uuid() {
    if (G.crypto && G.crypto.randomUUID) return G.crypto.randomUUID();
    const b = new Uint8Array(16);
    (G.crypto || {}).getRandomValues ? G.crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const x = Array.from(b, n => n.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  function debounce(fn, ms) {
    let t = null;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
    d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
    return d;
  }
  const clone = x => JSON.parse(JSON.stringify(x));

  // Dates: stored ISO (yyyy-mm-dd), shown and copied as dd/mm/yyyy.
  const pad2 = n => String(n).padStart(2, '0');
  function todayIso() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function dmy(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
  }
  function fmtClock(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  }
  function fmtWhen(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${fmtClock(ts)}`;
  }

  /* ---------------- coordinates (v1's parser) ---------------- */
  const QLD_BOUNDS = { latMin: -29.5, latMax: -9.0, lonMin: 137.9, lonMax: 153.6 };
  const inRange = (lat, lon) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  const inQld = (lat, lon) => lat >= QLD_BOUNDS.latMin && lat <= QLD_BOUNDS.latMax && lon >= QLD_BOUNDS.lonMin && lon <= QLD_BOUNDS.lonMax;
  function looksLikeDms(s) {
    if (/[°'"′″]/.test(s)) return true;
    if (/\d\s*[NSEW]\b/i.test(s)) return true;
    if (/\d+\s*d\s*\d+\s*m/i.test(s)) return true;
    return (s.match(/-?\d+(?:\.\d+)?/g) || []).length >= 5;
  }
  function dmsSign(str) {
    const m = String(str).match(/([NSEW])(?=[\s,]|$)/i);
    if (m) return /[SW]/i.test(m[1]) ? -1 : 1;
    return /^\s*-/.test(str) ? -1 : 1;
  }
  function parseDmsAxis(str) {
    const s = String(str).trim();
    if (!s) return null;
    const parts = (s.replace(/[°'"′″]/g, ' ').replace(/[a-zA-Z]/g, ' ').match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (!parts.length) return null;
    const d = parts[0] || 0, m = parts[1] || 0, sec = parts[2] || 0;
    if (m >= 60 || sec >= 60) return null;
    return (d + m / 60 + sec / 3600) * dmsSign(s);
  }
  function splitDmsPair(s) {
    const t = s.trim();
    const ns = t.match(/^(.*?[NS](?=[\s,]|$))\s*[, ]?\s*(.*)$/i);
    if (ns && ns[2].trim()) return [ns[1], ns[2]];
    if (t.includes(',')) { const p = t.split(','); if (p.length === 2) return [p[0], p[1]]; }
    const nums = t.match(/-?\d+(?:\.\d+)?/g) || [];
    if (nums.length >= 2 && nums.length % 2 === 0) {
      const half = nums.length / 2; let seen = 0, idx = 0;
      t.replace(/-?\d+(?:\.\d+)?/g, (m, off) => { if (seen === half && !idx) idx = off; seen++; return m; });
      if (idx) return [t.slice(0, idx), t.slice(idx)];
    }
    return null;
  }
  function parseCoord(input) {
    const raw = (input == null ? '' : String(input)).trim();
    if (!raw) return { ok: false, empty: true, lat: null, lon: null };
    let lat = null, lon = null, format = 'decimal';
    if (looksLikeDms(raw)) {
      format = 'dms';
      const pair = splitDmsPair(raw);
      if (!pair) return { ok: false, error: 'Couldn’t read that as coordinates.' };
      lat = parseDmsAxis(pair[0]); lon = parseDmsAxis(pair[1]);
      if (lat == null || lon == null) return { ok: false, error: 'Couldn’t read that DMS coordinate.' };
    } else {
      const nums = raw.replace(/[°]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
      if (nums.length < 2) return { ok: false, error: 'Enter latitude and longitude (e.g. -27.4710, 153.0234).' };
      if (nums.length > 2) return { ok: false, error: 'Too many numbers — expected latitude, longitude.' };
      lat = Number(nums[0]); lon = Number(nums[1]);
    }
    if (!isFinite(lat) || !isFinite(lon)) return { ok: false, error: 'Couldn’t read that as coordinates.' };
    if (!inRange(lat, lon)) {
      if (inRange(lon, lat)) return { ok: false, error: 'Latitude/longitude look swapped.', swap: { lat: lon, lon: lat } };
      return { ok: false, error: 'Latitude must be -90..90 and longitude -180..180.' };
    }
    const out = { ok: true, lat, lon, format };
    if (!inQld(lat, lon) && inQld(lon, lat)) { out.swap = { lat: lon, lon: lat }; out.warn = 'These look swapped for a Queensland site.'; }
    else if (!inQld(lat, lon)) out.warn = 'Outside the usual Queensland range — double-check.';
    return out;
  }
  // Up to six decimal places (≈0.1 m), trailing zeros dropped — never adds
  // precision a coarse coordinate does not have.
  const r6 = n => Math.round(n * 1e6) / 1e6;
  const formatCoord = (lat, lon) => `${r6(lat)}, ${r6(lon)}`;
  // How many decimal places a recorded coordinate carries, and what that means
  // on the ground (one decimal place of latitude is ~11 km; each more is 10× finer).
  function coordPrecision(lat, lon) {
    const dp = n => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
    const places = Math.min(dp(lat), dp(lon));
    const metres = 111320 / Math.pow(10, places) / 2;   // half a step, roughly
    return { places, metres };
  }
  function haversineM(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const p1 = a.lat * rad, p2 = b.lat * rad, dp = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function bearingDeg(a, b) {
    const rad = Math.PI / 180, p1 = a.lat * rad, p2 = b.lat * rad, dl = (b.lon - a.lon) * rad;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = deg => COMPASS[Math.round(deg / 22.5) % 16];
  function fmtDist(m) {
    if (m == null || !isFinite(m)) return '';
    return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
  }

  // Bounded fetch: nothing external may hang the page.
  async function fetchJson(url, opts) {
    const o = Object.assign({ timeoutMs: 15000 }, opts || {});
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), o.timeoutMs) : null;
    try {
      const res = await fetch(url, Object.assign({}, o.init || {}, ctl ? { signal: ctl.signal } : {}));
      const text = await res.text();
      let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
      if (!res.ok) { const e = new Error((body && (body.detail || body.error || body.message)) || `HTTP ${res.status}`); e.status = res.status; e.body = body; throw e; }
      return body;
    } catch (e) {
      if (e && e.name === 'AbortError') { const x = new Error('timed out'); x.timeout = true; throw x; }
      throw e;
    } finally { if (t) clearTimeout(t); }
  }

  // localStorage that never throws (private windows, blocked storage).
  const LS = {
    get(k) { try { return G.localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { G.localStorage.setItem(k, v); return true; } catch (_) { return false; } },
    del(k) { try { G.localStorage.removeItem(k); } catch (_) { /* ignore */ } },
    json(k, dflt) { const s = LS.get(k); if (s == null) return dflt; try { return JSON.parse(s); } catch (_) { return dflt; } },
    keys() { try { return Object.keys(G.localStorage); } catch (_) { return []; } }
  };

  S.util = { esc, escLines, flat, h, $, $$, uuid, debounce, clone, todayIso, dmy, fmtClock, fmtWhen,
    parseCoord, formatCoord, coordPrecision, haversineM, bearingDeg, compass, fmtDist, fetchJson, LS, inQld };
})(typeof window !== 'undefined' ? window : globalThis);
