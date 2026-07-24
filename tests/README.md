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

## `pin-coord-entry.test.mjs` — §C2 coordinate text-entry

Guards editing a pin's coordinate from the **text field** in the Site Map panel
(the keyboard counterpart to the B1 drag): typing a coordinate and committing it
(Enter / blur / the **Set** button) writes the canonical value back to the
originating scope row's field, offers undo, and validates through the SAME
`parseCoord` path as every other coordinate — so DMS and swapped-pair fixes work,
a bad value is refused with an inline message (nothing written, the typed text
kept for correction), *invalid* pins are editable, and clearing the field removes
the pin (undoably).

Fully hermetic like `pin-writeback.test.mjs` — no WebGL view, no QLD services, no
Esri CDN. Same invocation as the others.

## `rail-road-source.test.mjs` — §C1 rail + §A7 road-parcel parity

Guards two schema-driven resolvers, with only the external ArcGIS REST endpoints
stubbed (as in `road-filter.test.mjs`; the page code runs unmodified):

- **Rail (`resolveRailLayers`)** reads the *Transportation/OtherTransport* layer
  list and keeps only the railway sublayers — heavy rail, light rail, sidings,
  sugar-cane — never the aviation / port sublayers that share the service, and
  never the group layers; it falls back to the metadata ids if the probe can't run.
- **Road source (`resolveRoadSource`)** prefers the cadastre's own dedicated road
  **polygon** sublayer, drawn whole (the same selection QLD Globe's *Road parcel*
  layer shows), validated site-locally and never a "road labels" layer — and falls
  back to the previous parcel + `LIKE '%ROAD%'` heuristic when no such sublayer
  exists (so it can only ever match QLD Globe better, never worse).

Same invocation as the others.

## `map-copy-recenter.test.mjs` — blank-copy + re-centre-on-reopen regression

Guards two Site Map defects that only bite on the live WebGL view but whose logic
can be driven with a **stand-in view** (no WebGL, no QLD services, no Esri CDN):

- **Copy — native-size capture.** The copied/pasted map image must be captured at
  the view's **native framebuffer** size. Passing `takeScreenshot` an explicit
  width/height makes it **resample**: a size larger than the view re-renders the
  scene and the raster base layers (imagery + contours) come back **blank** for
  the tiles that aren't ready yet — the "copied map is just pins on white" defect
  — while passing the CSS-pixel `view.width` down-samples on a high-DPI display.
  The test asserts `takeViewScreenshot` passes **no** size at all (a 1:1
  framebuffer read), and that the off-screen copy view is built at the export
  width so its native capture is already high-res.
- **Re-centre on re-open.** When the modal re-opens, its map container goes
  `display:none` → visible, so the re-show resize can interrupt the framing
  `goTo`, which used to be swallowed — leaving the **old** centre on screen. The
  test asserts `whenViewDisplayed` waits until the container has a real size, and
  that `fitView` **retries** a `goTo` that was interrupted so the new anchor
  lands (while still leaving a user-adjusted view alone).

It drives the real `takeViewScreenshot` / `whenViewDisplayed` / `fitView` code by
stubbing `siteMap.view` + `siteMap.esri`, and is fully hermetic. Same invocation:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-copy-recenter.test.mjs
```

## `map-copy-suspended-view.test.mjs` — blank-map-on-copy (suspended view) regression

Guards the "Site Map copy exports pins + legend but **no map**" defect. The Site
Map modal is hidden with `.hidden { display:none }`, and per the Esri docs a
`MapView` whose container is `display:none` is **suspended** — it stops rendering
and updating. So when the common workflow (open the map, frame it, **close it**,
tick *Include map*, *Copy table for Word*) reaches the copy, the view is
suspended: the base layers (imagery, contours, road, rail, labels) have stopped
drawing, while `view.graphics` (the pins) still paint from geometry in memory and
the legend/stamp are composited on afterwards — pins + legend + no map. It stayed
silent because a suspended view reports `updating === false` (it has simply
stopped), so the old `whenOnce(() => !view.updating)` gate resolved instantly on
an empty frame, and the old all-black probe never fired on a **transparent** frame
that a white base fill then turned into a plausible pale "map".

This is a DOM/CSS problem, not a service problem, so it **is** reproducible
without `js.arcgis.com` or the QLD hosts. The test drives the real functions
against stand-in views and asserts:

- **`beginCaptureVisibility`** parks the overlay in the one hidden state
  (`visibility:hidden` via `.smap-capturing`) that keeps `suspended === false` —
  laid out at full size, invisible, click-through — and restores `.hidden` after;
- **`whenCaptureReady`** does **not** resolve while the view is suspended (unlike
  the old `!updating` gate), resolves once it un-suspends and every layer view is
  idle, and is **bounded** so a stuck-retrying layer can never hang the copy;
- **`takeViewScreenshot`** reads the native framebuffer (no resample);
- **`rasterStats`** measures the **raw** raster — a full-coverage many-colour
  frame passes; a pins-on-transparent frame reads low coverage / few colours;
- **`compositeScreenshot`** exports a real capture but **throws** on a near-empty
  one rather than paste pins-on-white into a scope document;
- the **diagnostics** name the frame coverage and the suspension state (the only
  debugging surface on the target machine — there is no DevTools);
- **Escape** is ignored while a capture has briefly un-hidden the overlay.

Fully hermetic — no WebGL view, no QLD services, no Esri CDN. Same invocation:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-copy-suspended-view.test.mjs
```
