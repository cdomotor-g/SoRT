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
