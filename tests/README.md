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
service response. GitHub is blocked so the bundled `definitions.json`
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

It also guards **A8 — the intersections**. A road reserve runs through its
intersections, but the DCDB stores each one as its own parcel, typed
`Unlinked parcel or inter…` rather than anything matching `%ROAD%`, so every
intersection drew as an unfilled hole boxed in by the road parcels that stopped
at it. `resolveRoadWhere` now probes a second pattern on the same field and ORs
it in only when it validates; the test pins all three outcomes: intersections
present (ORed in and counted in the report), none present (the filter is left
exactly as it was), and a match so large it cannot be intersections (rejected,
rather than painting the rest of the cadastre as road reserve).

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
`buildSiteMapModal`, `mapBuild*`) and is fully hermetic — GitHub, the
Esri CDN and every QLD host are blocked, and the progress lifecycle is exercised
directly, so no WebGL view or network is needed. The timing-sensitive assertions
poll (`waitForFunction`) rather than sleep, so the run is not flaky. Same
invocation as above:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-visuals.test.mjs
```

## `map-build-progress.test.mjs` — §A6.1 "the bar finished before the contours"

Guards the defect where the bottom-of-map build-progress bar ran to 100% and hid
itself while the LiDAR contours were still drawing. `view.updating` was the only
completion signal, and it is **false** during the gap between "the view is ready"
and "the contour layer reaches the map" — every layer loader resolves its service
metadata over the network before it adds anything — so the bar saw a quiet view,
waited its 300 ms and completed over a map whose slowest layer had not started.
The same gap sits after a pan (the re-fetch for the new extent starts a beat after
the view stops moving) and after a re-open (the modal's `display:none` **suspends**
the view, so every layer has to redraw).

Completion is now gated on outstanding **work** as well as on quiet. The test
drives the real `mapBuild*` globals and asserts:

- a tracked layer that hasn't drawn **holds** the bar even though the view has
  gone quiet — the reported symptom — and releasing it completes and hides it;
- the hold follows the layer's **layer view**, not its load: released only after
  `lv.updating` has been false for a beat, and **re-armed** if the layer starts
  fetching again (contours arriving in batches);
- a layer that never arrives (failed load, pulled from the map, no layer view)
  releases immediately, and every wait is bounded, so nothing can wedge the bar;
- a pan/re-open registers the live layers (`mapBuildTrackRedraw`) so the bar waits
  for the redraw; restarting a cycle mid-load **keeps** the layer that hasn't
  drawn; a superseded load can't release the load that replaced it;
- each finished layer advances the bar, contours by the largest step;
- the real **`buildView`** registers all five operational layers with the progress
  bar *before* their loads start.

Hermetic — the store, the Esri CDN and every QLD host are blocked, and the view
and its layer views are stand-ins, so no WebGL and no network are needed. Same
invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-build-progress.test.mjs
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

## `map-capture-button.test.mjs` — §7.5 "capture what you can actually see"

The two tests above fix the *mechanics* of a blank copied map (a suspended view;
a resampling `takeScreenshot`). This one guards the change that stops a blank map
reaching a document at all: the capture is made **from the map the user is looking
at**, and handed straight back to them to look at.

Drives the real `captureVisibleMap` / `renderCaptureCard` / `renderOnMapFurniture`
/ `renderMapStateChip` against a stand-in view whose `takeScreenshot` returns
either a rich (full-coverage, many-colour) raster or the pins-on-transparent
failure signature, and asserts:

- **a real capture** returns a PNG, caches it tagged `source:"capture"` with a
  timestamp, arms *"Include site map in copied output"*, and shows the **exact
  PNG as a thumbnail** — the whole point: a blank one is visible in the modal;
- **a blank frame** is refused — nothing returned, nothing cached, nothing put on
  the clipboard — with a message naming what to wait for, and the button left
  usable for a retry;
- **the legend lives on the map**, not the side panel, one row per shown pin with
  its coordinate (B3), and the contour caption tracks the contours toggle **on
  screen and in the export** (`contourStampText` is the single source for both);
- **staleness is its own state**: after an invalidation the cache is dropped but
  `source` is kept, so the card and the toolbar chip say *"the map has changed
  since you captured it"* — a different message from *"nothing captured"* — and
  the stale thumbnail is removed;
- **the guards** refuse a capture with no view and with no pins showing, in plain
  language;
- **the tidied toolbar**: the chip is hidden while the tick box is off, reports
  readiness when on, the old toolbar *Copy map image* button is gone, and the
  capture button is inside the modal;
- **the diagnostics** name which picture the copy would use and how it was made
  (`captured by the user` vs `built automatically`).

Fully hermetic — no WebGL view, no QLD services, no Esri CDN. Same invocation:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-capture-button.test.mjs
```

## `map-auto-capture.test.mjs` — §7.6 "the tick box is enough"

The test above guards that a capture the user *makes* is honest. This one guards
that they don't have to make one at all: ticking **Include site map in copied
output** is the whole instruction, and the picture makes itself.

Drives the real `ensureMapPicture` / `scheduleAutoCapture` / `getMapImageForCopy`
/ `copyTable` against the same stand-in view (rich raster vs. the
pins-on-transparent failure signature), with **real pins typed into the
coordinate field** — the automatic path resolves pins from app state, not from a
stub — and asserts:

- **ticking the box** makes a picture straight away, tagged `source:"auto"`, with
  the chip moving *"made automatically on copy"* → *"Making the map picture…"* →
  *"✓ Map picture ready (made automatically …)"*;
- **Copy with nothing captured** puts an `<img>` in the copied HTML, 📸 never
  pressed, and says in the status line that the picture was made automatically;
- **one capture at a time**: two callers share one run and one `takeScreenshot`;
- **a blank live-view frame** falls back to a fresh off-screen rebuild instead of
  giving up on the picture, and logs the fallback for the diagnostics;
- **staleness re-arms itself**, debounced (a burst of edits schedules one capture,
  not one each) and only while the Site Map is shut;
- **a capture the user framed is never overwritten** — the automatic path hands
  that picture back untouched, with no second `takeScreenshot`;
- **unticked changes nothing**: no captures, nothing scheduled, and the copy is
  the map-free output it always was (§7.4, §8);
- **no coordinates is not a failure** — nothing captured, nothing reported as
  broken, and the copy still says why there is no map;
- **a genuine failure IS reported**: both routes are tried, the chip says so and
  points at the Site Map, and the tables still copy.

Fully hermetic — no WebGL view, no QLD services, no Esri CDN (`loadEsri` is
stubbed). Same invocation:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/map-auto-capture.test.mjs
```

## `field-default-text.test.mjs` — default text + line breaks into Word

Guards the two free-text changes:

- **Default text.** A free-text field can carry boiler-plate (`fields[].default`,
  set in *Manage Tables*) that lands **in the input** in the Scope Builder for the
  end user to edit in place. The test asserts the default survives normalisation
  and export, seeds builder state and the on-screen inputs, that a *pristine*
  default does not count towards the progress bar (only an edited one does), that
  **Clear** and the new *↺ Restore default text* link hand the wording back, that
  a default added later fills only fields the user has never touched — never a
  field they deliberately emptied — and that the row editor's *Default text* box
  writes/clears the definition and flags multi-line boiler-plate on a single-line
  **Text** field (which cannot hold line breaks).
- **Line breaks into Word.** The copied HTML escaped values but left newlines
  bare, and HTML treats a bare newline as a space — so the breaks users type to
  separate chunks of scope text vanished on paste. The test asserts the copy now
  emits `<br>` (a blank line becomes `<br><br>`), that markup in a value is still
  escaped around them, and that the plain-text/TSV fallback keeps one table row on
  one line by collapsing breaks to `; `.

Hermetic — GitHub is blocked and nothing else is fetched (no map, no
QLD services, no Esri CDN); the definitions under test are applied through the
app's own `applyDefinitions`. Same invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/field-default-text.test.mjs
```

## `github-publish.test.mjs` — GitHub as the definitions store

The published definitions are `definitions.json` in the repo; Supabase is gone.
The test runs the app against a **fake GitHub** (network interception, built to
answer like the real REST API) and asserts:

- **Startup** reads the file from the contents API (raw), as the *published*
  copy, and remembers its exact text — the base Publish checks against. The
  retired Supabase store is never contacted.
- **Nothing to publish** — a copy identical to GitHub's, bar the date stamp, is
  not committed (and no token is asked for).
- **Connecting** — Publish with no token opens *Connect to GitHub*, whose link
  pre-fills a fine-grained token (name, owner, one-year expiry, Contents write)
  and says which repository to pick. An empty, rejected (401) or **read-only**
  token is refused with the reason and nothing is kept; the write check is an
  empty, unreferenced git blob, never a commit. *Remember* picks localStorage vs
  sessionStorage, and *Disconnect* forgets the token.
- **A publish, end to end** — a commit-message prompt, then a GET of the current
  file (JSON, for its sha) and a PUT, both with the token; the commit carries the
  typed message, targets `main`, quotes the sha it replaces, and its content is
  **exactly** what Export would download, UTF-8 intact through base64 (emoji,
  en dashes). Afterwards the definitions are the published copy, no draft is left,
  and the editor stays on the table being worked on.
- **Never overwriting someone else's edit** — a file changed on GitHub since it
  was loaded is refused before anything is written (edits kept; *Reload latest*
  then re-apply works), and GitHub's own 409 reads the same. A draft resumed in a
  later session publishes against the version it was **made from**, so a change
  made on GitHub overnight is caught too; a draft with no known base asks before
  replacing the file.
- **A published file broken by a hand edit** (valid JSON, but unusable) —
  *Reload latest* reports it and changes nothing: the unpublished draft and its
  base survive, and the edits stay on screen.
- **Tokens that stop working** — a 403 explains the token needs *Contents: Read
  and write* (and keeps it); a 401 says it was rejected, forgets it and shows
  GitHub as not connected, keeping the edits. A connected token is sent on reads
  too, and a rejected one doesn't stop anyone reading (retried without it).

Hermetic — GitHub is the fake, raw.githubusercontent.com is blocked, and nothing
else is fetched. Same invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium \
  node tests/github-publish.test.mjs
```

## `header-cache-repo.test.mjs` — the *Load from repo* and *Clear cache* buttons

Guards the two header buttons.

- **Load from repo** reads `definitions.json` from the GitHub contents API (asking
  for the raw file, anonymously when nothing is connected) and falls back to
  `raw.githubusercontent.com`, cache-busted, when the API is rate-limited. The
  test asserts it is applied as the **published** copy (origin `remote`, the
  source chip, no draft left behind, nothing pending in Manage Tables), that
  answers on rows that still exist carry over, that it **asks before throwing
  away unpublished edits** (and not when there are none), and that an unreachable
  GitHub, a response that isn't a definitions file, or a host that never answers
  (the per-request timeout) leaves everything exactly as it was, with a message
  naming each route's failure.
- **Clear cache** asks first; *Cancel* changes nothing. *OK* removes every
  `sort.*` key except the theme and the GitHub connection — other apps' keys on
  the same origin survive — even with an edit's autosave still pending,
  re-fetches the page with `cache:"reload"` before reloading, and the fresh page
  says so (and loads the published copy from GitHub).
- **Against a real HTTP cache.** Network interception switches Chromium's cache
  off, so the last section runs in a second browser with no interception (only
  `127.0.0.1` resolves) and serves the app the way GitHub Pages does
  (`max-age=600` + ETag). It shows the problem — after a deploy, an ordinary
  visit still gets the old page — and that Clear cache brings up the new one, for
  good.

Hermetic — both GitHub hosts are stubbed, the retired Supabase store must never
be contacted, and the real-cache section never leaves 127.0.0.1. Same
invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium \
  node tests/header-cache-repo.test.mjs
```

## `word-column-widths.test.mjs` — the one-character-wide first column

Guards the column widths of both copied tables. Pasted into Word, the left-hand
column (*Item*, and the Property Services label column) collapsed to about one
character wide and had to be dragged out by hand on every row. The cause is
Word's **autofit**, which re-computes column widths over pasted HTML and only
stands down when the table is declared fixed *and* every column has an explicit
width — the old copy was `width:100%` with a single `width:28%` (38% in Property
Services) on one cell per body row, and nothing at all on the header cells or the
full-width `colspan="2"` rows.

The test drives the real `buildHtmlTable` / `buildPropertyServicesHtml` and parses
the emitted HTML with the browser's own parser (not by regex), asserting that both
tables carry `table-layout:fixed`, an absolute table width, a `<colgroup>` with a
`<col>` per column, and a width on **every** cell — `colspan="2"` cells at the full
table width, two-column rows at the **1/3 : 2/3** split the user asked for — with
the cm CSS width and the px `width` attribute agreeing, the column widths adding
up to the table width, and no percentage cell width left anywhere.

Hermetic — GitHub is blocked and nothing else is fetched (no map, no
QLD services, no Esri CDN). Same invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium \
  node tests/word-column-widths.test.mjs
```

## `map-reopen-refit.test.mjs` — "the map opens where the last station was"

Guards the framing on re-open. The MapView is kept alive between opens by design,
and the first manual pan/zoom latches `siteMap.userHasAdjustedView` so `fitView`
leaves the framing alone. That flag used to survive a **close**, so scoping one
station, closing the modal and opening it again for the next one landed on the
previous station's framing. Clearing it only when the anchor *coordinate* changed
(the A3 rule) missed every other case — a different anchor row, no previous anchor
to compare against, or simply wanting the pins re-framed.

Every open now re-frames on the pins showing at that moment. The test drives the
real `openSiteMap` / `fitView` against a stand-in view and asserts:

- `fitView({force:true})` re-frames a manually adjusted view and lands on the
  anchor pin, while plain `fitView()` still honours it (no surprise mid-session
  re-frame — the behaviour `map-copy-recenter.test.mjs` also pins);
- `openSiteMap` drops the manual framing and frames **once**, passing `force`, so
  the warm-on-close capture restoring the flag mid-open cannot strand the old view;
- a second open — the reported workflow, two scoping sessions without closing the
  tool — re-frames again;
- **Reset view** and **Fit all pins** are still there for mid-session re-framing.

Calling `fitView` was not enough on its own, so the test also covers **A9**, the
two reasons the re-frame did not reach the screen:

- `openSiteMap` frames the **interactive** view, never the off-screen capture's
  throwaway. Capture-on-close rebuilds the map off-screen in the background and
  points the module's view/layers/diagnostics at its own view while it does; a
  re-open in that window framed the throwaway, and the capture then handed the
  interactive view back untouched — still on the last station. The open now calls
  `siteMap.offscreenRestore` first, and `fitView({view})` / `drawPins(view)` let
  the capture work from its own reference instead of the module pointer;
- `fitView` **confirms** the framing landed. A goTo issued while the modal is
  still being re-shown can be dropped or interrupted, so it re-frames until the
  anchor is actually in the middle of the view — bounded by
  `SITE_MAP_CONFIG.frameAttempts`, and a rejected goTo always counts as a miss.

Hermetic — GitHub, the Esri CDN and every QLD host are blocked, and no
WebGL view is created. Same invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium \
  node tests/map-reopen-refit.test.mjs
```

## `map-location-entry.test.mjs` — every location in the Site Map panel, entered or not

Users skip the scope form and expect to make the first coordinate entry in the
Site Map. The side panel used to list only the locations that already held a
value, so on a fresh table there was nothing to type into. It now lists every
location the active table declares a `mapPin` for, entered or not, and only
those. The test drives the real `openSiteMap` / `resolveMapPins` / `refreshPins`
/ `renderSiteMapPanel` / `commitPinCoordEntry` code with real keyboard and mouse
input, and asserts:

- **Per station type** — Rainfall lists the current location and the relocation
  site and nothing else (no river line / orifice on a rain-only station). The Water
  Level and DLGWV tables add the river-line termination and its relocation, and
  Repeater / Gateway adds the TBRG location. The relocation gate still applies:
  no relocation entry while Relocation is "No", and one while it is unanswered.
- **A fresh table** — every entry is an empty field with a disabled, unticked box
  and a note naming the table row it fills. The panel says that entries made there
  go into the table, nothing is drawn, and the cursor starts in the first
  location.
- **The first entry, back into the form** — typing a coordinate and pressing Enter
  writes the canonical value to the scope row. The form field, the row preview, the
  progress count and the Property Services mirror all show it. The pin is drawn
  (not left switched off, as a location that had nothing to draw used to be) and
  the map frames it. The toast says the value was added to the table, and Undo
  takes the location back to "not entered". River-line entries land in the
  water-level table's own rows and its Property Services "Subsidiary (orifice
  line)".
- **Moving on in one click** — committing rebuilds the list, which used to swallow
  the click on the next location's field. Focus now lands on the field that was
  clicked, and Tab moves on to the Set button.
- **Rebuilds never commit** — Chrome fires `blur` on a focused field while the
  rebuild is removing it, and it used to commit the field's old text (after an
  undo it put the undone value straight back). Text still being typed survives a
  rebuild, with the caret kept, and is not written until the user commits it.
  Escape abandons it.
- **Only a change is written** — tabbing through a field whose table text is not
  in canonical form (more decimals, DMS) leaves that text alone: no toast and no
  re-frame.
- **A bad value fixed on the map shows its pin**, and the **Word copy** carries a
  location entered only on the map, in the scope table and in Property Services.
- **Diagnostics** count the locations (placed / unreadable / not entered yet), and
  a table with no location rows says so.

Hermetic: GitHub, the Esri CDN and every QLD host are blocked, and the map view is
a stand-in that records drawn pins and `goTo` calls (no WebGL). Same invocation as
the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium \
  node tests/map-location-entry.test.mjs
```

## `ps-comments.test.mjs` — custom comments in the Property Services table

Guards the free-text comments users can add to the Property Services table:

- **+ Add comment on a row.** Every answerable row (question, free text,
  coordinate group, date) carries a collapsible comment box — section headers do
  not. The test types into the boxes the way a user does and asserts the comment
  is stored against its row, that it lands in that row's answer cell in Word on
  its own line under the answer (a coordinate group gets its own *Comment* row
  inside the group instead), and that the plain-text fallback joins answer and
  comment with `; `. A comment is not an answer: a highlighted row stays
  highlighted.
- **Additional comments.** The box at the foot of the table is copied as its own
  row just above the fixed Note, escaped and with its line breaks kept — and left
  out of Word entirely while blank.
- **Lifecycle.** Comments survive a re-render and `reconcileState` (a row holding
  one re-renders open, labelled *Comment added*), reach the clipboard through the
  real **Copy for Word**, and **Reset this table** clears them. With no comments
  the copied Property Services table is byte-identical to before the feature.

Hermetic — GitHub is blocked and nothing else is fetched (no map, no QLD
services, no Esri CDN); it drives the bundled `definitions.json` on the Water
Level table, which carries every row kind. Same invocation as the others:

```bash
PLAYWRIGHT_PKG=/abs/path/to/node_modules/playwright \
PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome \
  node tests/ps-comments.test.mjs
```
