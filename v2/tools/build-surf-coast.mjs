#!/usr/bin/env node
/* SoRT v2 — build-surf-coast.mjs
   Writes v2/data/surf-coast.json: the stretches of Queensland's coastline that
   face open ocean surf, for the corrosion suggestion on the Infrastructure
   options question (js/coast.js). Everything else on the coast is sheltered or
   quiet water, which js/coast.js gets live from the same QSpatial layer.

     node v2/tools/build-surf-coast.mjs            # fetch, classify, write
     node v2/tools/build-surf-coast.mjs --debug    # also writes the classified segments for checking

   How a stretch is judged "surf": from each piece of coastline, thirteen rays
   go out every 15° from north round through east to south, 80 km each. If four
   or more reach open water without crossing land, and at least one of those
   is between east-north-east and south-east (where the swell comes from), the
   piece faces the open ocean. That takes in the beaches tucked behind a
   headland and facing north — Coolangatta, Greenmount and Rainbow Bay behind
   Point Danger, Noosa's Laguna Bay — which the swell wraps into. A bay shore
   (Moreton Bay, the Broadwater, Pumicestone Passage, the Great Sandy Strait,
   Hervey Bay) looks across water at an island or the far shore: what open
   water it sees is to the north, through the bay's mouth, not the swell's. North of Agnes Water
   the Great Barrier Reef shelters the coast, so the search stops at 24°S.

   Source: QSpatial "Coastline" (Oceans/CoastalWaters, layer 17), © State of
   Queensland, CC BY 4.0. Re-run it only if that layer changes a lot. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'data', 'surf-coast.json');
const LAYER = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Oceans/CoastalWaters/MapServer/17';
const BOX = { xmin: 151.6, ymin: -28.3, xmax: 153.75, ymax: -24.0 };   // Point Danger to Agnes Water, and the islands
const TILE = 0.25;                  // degrees per query
const RAY_M = 80000, RAY_START_M = 25, BEARINGS = Array.from({ length: 13 }, (_, i) => i * 15), OPEN_NEEDED = 4;   // north round to south, every 15°
const SWELL = [60, 135];            // and at least one of them between east-north-east and south-east, where the swell comes from
const MIN_RUN_M = 400;              // a surf stretch shorter than this is dropped (a rock, a groyne)
const FLIP_M = 250;                 // a gap or blip shorter than this takes its neighbours' class
const SIMPLIFY_M = 8;
const DEBUG = process.argv.includes('--debug');

// A local flat projection in metres (good to ~2 % over this box: fine for rays).
const LAT0 = -26.2, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574;
const px = lon => (lon - 153) * KX, py = lat => lat * KY;
const unx = x => x / KX + 153, uny = y => y / KY;

async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j;
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

async function fetchCoast() {
  const feats = new Map();
  for (let x = BOX.xmin; x < BOX.xmax - 1e-9; x += TILE) {
    for (let y = BOX.ymin; y < BOX.ymax - 1e-9; y += TILE) {
      let offset = 0;
      for (;;) {
        const q = new URLSearchParams({
          f: 'json', where: "feature_type IN ('Coastline','Coastline Junction')", outFields: 'objectid,feature_type',
          geometry: `${x},${y},${x + TILE},${y + TILE}`, geometryType: 'esriGeometryEnvelope', inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', outSR: '4326',
          maxAllowableOffset: '0.00003', geometryPrecision: '6', resultOffset: String(offset), resultRecordCount: '1000'
        });
        const j = await getJson(`${LAYER}/query?${q}`);
        (j.features || []).forEach(f => { if (f.geometry && !feats.has(f.attributes.objectid)) feats.set(f.attributes.objectid, f); });
        if (!j.exceededTransferLimit) break;
        offset += (j.features || []).length;
      }
      process.stdout.write('.');
    }
  }
  process.stdout.write('\n');
  return [...feats.values()];
}

// Segments, in metres, each knowing its path and position so neighbours can be skipped.
function segmentsOf(feats) {
  const segs = [];
  feats.forEach((f, fi) => (f.geometry.paths || []).forEach((p, pi) => {
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const s = { x1: px(a[0]), y1: py(a[1]), x2: px(b[0]), y2: py(b[1]), path: `${fi}:${pi}`, i, junction: f.attributes.feature_type === 'Coastline Junction' };
      s.len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (s.len > 0) segs.push(s);
    }
  }));
  return segs;
}

// A grid of 2 km cells over the segments.
function gridOf(segs, cell) {
  const g = new Map();
  const key = (cx, cy) => cx * 100000 + cy;
  segs.forEach((s, idx) => {
    const x0 = Math.floor(Math.min(s.x1, s.x2) / cell), x1 = Math.floor(Math.max(s.x1, s.x2) / cell);
    const y0 = Math.floor(Math.min(s.y1, s.y2) / cell), y1 = Math.floor(Math.max(s.y1, s.y2) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = key(cx, cy); if (!g.has(k)) g.set(k, []); g.get(k).push(idx);
    }
  });
  return { g, cell, key };
}

function crosses(ax, ay, bx, by, s) {
  const d = (bx - ax) * (s.y2 - s.y1) - (by - ay) * (s.x2 - s.x1);
  if (d === 0) return false;
  const t = ((s.x1 - ax) * (s.y2 - s.y1) - (s.y1 - ay) * (s.x2 - s.x1)) / d;
  const u = ((s.x1 - ax) * (by - ay) - (s.y1 - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Does a ray from (x, y) on bearing b reach RAY_M without crossing the coast?
function rayOpen(x, y, bearing, me, segs, grid) {
  const r = bearing * Math.PI / 180, dx = Math.sin(r), dy = Math.cos(r);
  const ax = x + dx * RAY_START_M, ay = y + dy * RAY_START_M, bx = x + dx * RAY_M, by = y + dy * RAY_M;
  const seen = new Set();
  const steps = Math.ceil(RAY_M / (grid.cell / 2));
  for (let k = 0; k <= steps; k++) {
    const sx = ax + (bx - ax) * k / steps, sy = ay + (by - ay) * k / steps;
    const cx = Math.floor(sx / grid.cell), cy = Math.floor(sy / grid.cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const list = grid.g.get(grid.key(cx + ox, cy + oy));
      if (!list) continue;
      for (const idx of list) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const s = segs[idx];
        if (s.path === me.path && Math.abs(s.i - me.i) <= 1) continue;
        if (crosses(ax, ay, bx, by, s)) return false;
      }
    }
  }
  return true;
}

// Douglas–Peucker on [x, y] points in metres.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], L = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

async function main() {
  console.log('Fetching the coastline from QSpatial…');
  const feats = await fetchCoast();
  const segs = segmentsOf(feats);
  console.log(`${feats.length} features, ${segs.length} segments`);
  const grid = gridOf(segs, 2000);
  let n = 0;
  segs.forEach(s => {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    let open = 0, swell = false;
    for (const b of BEARINGS) {
      if (rayOpen(mx, my, b, s, segs, grid)) { open++; if (b >= SWELL[0] && b <= SWELL[1]) swell = true; }
      if (open >= OPEN_NEEDED && swell) break;
    }
    s.surf = open >= OPEN_NEEDED && swell && !s.junction;
    if (++n % 20000 === 0) process.stdout.write(`${n} `);
  });
  process.stdout.write('\n');

  // Runs along each path: smooth short blips, then keep the long surf runs.
  const byPath = new Map();
  segs.forEach(s => { if (!byPath.has(s.path)) byPath.set(s.path, []); byPath.get(s.path).push(s); });
  const lines = [];
  byPath.forEach(list => {
    list.sort((a, b) => a.i - b.i);
    const runs = [];
    list.forEach(s => { const r = runs[runs.length - 1]; if (r && r.surf === s.surf && r.end === s.i) { r.segs.push(s); r.len += s.len; r.end = s.i + 1; } else runs.push({ surf: s.surf, segs: [s], len: s.len, end: s.i + 1 }); });
    runs.forEach((r, i) => { if (r.len < FLIP_M && runs[i - 1] && runs[i + 1] && runs[i - 1].surf === runs[i + 1].surf) r.surf = runs[i - 1].surf; });
    const merged = [];
    runs.forEach(r => { const m = merged[merged.length - 1]; if (m && m.surf === r.surf && m.end === r.segs[0].i) { m.segs.push(...r.segs); m.len += r.len; m.end = r.end; } else merged.push(Object.assign({}, r, { segs: r.segs.slice() })); });
    merged.filter(r => r.surf && r.len >= MIN_RUN_M).forEach(r => {
      const pts = [[r.segs[0].x1, r.segs[0].y1]].concat(r.segs.map(s => [s.x2, s.y2]));
      lines.push(simplify(pts, SIMPLIFY_M).map(([x, y]) => [Math.round(unx(x) * 1e5) / 1e5, Math.round(uny(y) * 1e5) / 1e5]));
    });
  });
  const km = lines.reduce((t, l) => t + l.reduce((a, p, i) => i ? a + Math.hypot(px(p[0]) - px(l[i - 1][0]), py(p[1]) - py(l[i - 1][1])) : 0, 0), 0) / 1000;
  const out = {
    about: 'The stretches of Queensland coastline that face open ocean surf (Point Danger to Agnes Water), for the corrosion suggestion on the Water Level table. Made by v2/tools/build-surf-coast.mjs; see its header for how.',
    source: 'QSpatial Coastline (Oceans/CoastalWaters, layer 17), © State of Queensland, CC BY 4.0',
    made: new Date().toISOString().slice(0, 10),
    lines
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`${lines.length} surf stretches, ${Math.round(km)} km, ${lines.reduce((t, l) => t + l.length, 0)} points → ${OUT}`);
  if (DEBUG) {
    const dbg = segs.map(s => [unx(s.x1), uny(s.y1), unx(s.x2), uny(s.y2), s.surf ? 1 : 0].map((v, i) => i < 4 ? Math.round(v * 1e5) / 1e5 : v));
    writeFileSync(join(process.env.DEBUG_DIR || HERE, 'surf-coast-debug.json'), JSON.stringify(dbg));
    console.log('debug segments written');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
