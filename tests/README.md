# Tests

The app is a zero-build static page (`index.html` + `definitions.json`), so the
tests drive the real page in a headless browser rather than importing modules.

## `reopen-coords.test.mjs` — A3 regression

Guards the "stale coordinates when the modal is reopened" defect: on every open
the pins must re-resolve from app state, and if the **anchor** coordinate moved,
the previous manual framing is dropped so the view re-centres on the new
location. A non-anchor change (or no change) must leave the framing alone.

It exercises the real `syncPinsForReopen` / `refreshPins` / `resolveMapPins` /
`parseCoord` code paths after a genuine `input` event on the coordinate field. It
is hermetic: it never opens the WebGL view and never calls the QLD services or the
Esri CDN (the A3 logic makes no network requests), and it does not stub any QLD
service response. The central store is blocked so the bundled `definitions.json`
loads.

### Run

```bash
# one-time: install Playwright somewhere (a scratch dir is fine)
npm install playwright

# then, from the repo root:
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/reopen-coords.test.mjs
```

- `PLAYWRIGHT_PKG` — absolute path to the installed `playwright` package. Omit it
  if `playwright` is resolvable as a normal dependency from the repo.
- `PW_CHROMIUM` — optional; pin the Chromium binary (useful when the npm-installed
  Playwright wants a different browser revision than the one on disk).

Exit code `0` and `A3 regression test: OK` means all checks passed.

## `pin-writeback.test.mjs` — B1/B4 regression

Guards the data-editing features, which write to the user's coordinates:

- **B1** — dropping a dragged pin writes the rounded coordinate back to the
  originating scope row's field, shows an undo toast, and undo restores the
  previous value.
- **B4** — the relocation-distance suggestion appears when both endpoints parse
  and, on *use this*, writes a geodesic distance into the empty Distance field
  (never silently overwriting a typed value), also undoable.

It drives the real `finalizePinDrag` / `undoPinMove` / `renderDistanceSuggestion`
code by simulating the drop with a stand-in graphic — no WebGL view and nothing
stubbed on the QLD side. Same invocation as above:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/pin-writeback.test.mjs
```

## `road-filter.test.mjs` — invisible-road-reserve regression

Guards `resolveRoadWhere()`: a candidate DCDB field must be validated against
road parcels **near the site** (a ~2 km envelope around the anchor pin), never
by a state-wide count alone. The original defect: `UPPER(tenure) LIKE '%ROAD%'`
matched 202 parcels across all of Queensland — none near the site — so the
road layer "applied" cleanly and drew nothing. The test also pins the fallback:
when nothing matches locally, the **largest** state-wide match wins (not the
first non-zero) and the diagnostics flag that nothing matched at this location.

Unlike the other two tests this one **does** stub the QLD cadastre endpoint (via
Playwright network interception) — that service is exactly what is unreachable
from CI, and the resolution logic is pure request/response. The page code runs
unmodified. Same invocation as above:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/road-filter.test.mjs
```

## `map-visuals.test.mjs` — Site Map appearance + build-progress regression

Guards the Site Map's visual behaviour:

- the road reserve carries a **50%-transparent sandy fill** (emulating the QLD
  Globe view), not the old outline-only symbology;
- contours **default to 5 m** (1 m still selectable), and the contour line is
  **warmer and slightly thicker** so it reads over the aerial base map;
- the live contour-sublayer name probe resolves the **"N metre"** spellings the
  QLD service uses (the old `\bN\s*m\b` probe missed them, which would have left
  the new 5 m default with no id);
- the **build-progress bar** at the bottom of the map starts at zero, advances
  through its milestones, trickles while the map is drawing, completes and hides
  when it settles, resets to zero on a change, and **never captures pointer
  events** (so the map is never locked while it loads).

It drives the real page globals (`SITE_MAP_CONFIG`, `contourRenderer`,
`buildSiteMapModal`, `mapBuild*`) and is fully hermetic — the central store, the
Esri CDN and every QLD host are blocked, and the progress lifecycle is exercised
directly, so no WebGL view or network is needed. The timing-sensitive assertions
poll (`waitForFunction`) rather than sleep, so the run is not flaky. Same
invocation as above:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-visuals.test.mjs
```
