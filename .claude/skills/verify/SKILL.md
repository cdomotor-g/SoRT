---
name: verify
description: Build/launch/drive recipe for verifying SoRT changes end-to-end in a browser.
---

# Verifying SoRT

Zero-build static app: `index.html` + `definitions.json`. No deps, no bundler.

## Launch

```bash
python3 -m http.server 8642 --bind 127.0.0.1 &   # serve from the repo root
```

## Drive (headless Chromium via Playwright)

- `npm install playwright` in a scratch dir; launch with
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` —
  the npm-installed Playwright wants a newer browser revision than the
  pre-installed one, so the explicit path is required.
- **Block GitHub** to exercise the bundled `definitions.json` (and to keep
  the run hermetic) — boot reads the published copy from GitHub first:
  `await ctx.route(/api\.github\.com|raw\.githubusercontent\.com/, r => r.abort())`.
  With GitHub blocked, boot falls back to a saved localStorage draft
  (`sort.definitions.v1`) and then to `definitions.json`. To drive
  publishing, stub `api.github.com` instead — `tests/github-publish.test.mjs`
  has a fake that answers like the real contents API.
- Grant `permissions: ['clipboard-read','clipboard-write']` to test the
  "Copy table for Word" flow, then read `navigator.clipboard.readText()`.

## Flows worth driving

- Builder: `#rowsContainer .row` cards, tabs, progress bar, copy button.
- Manage Tables: `.mode-btn[data-mode="manage"]`; row editors are
  `#rowEditors .ed-row` — click `.ed-row-head` to expand. Common rows
  live in `#commonRowList`.
- Table Map: `.mode-btn[data-mode="map"]`, grid `table.map-grid`.
- Source chip `#sourceLabel` shows which definitions source loaded.
- Site Map side panel: `#siteMapBtn` opens it; `.smap-pin-list .smap-pin[data-pin-key]`
  lists every `mapPin` row of the active table, entered or not (`.smap-pin--empty`),
  and `.smap-pin-input` + Enter writes back into the form. The Esri CDN is unreachable
  from the sandbox, so drive it against a stand-in view — see
  `tests/map-location-entry.test.mjs` for the recipe.
- Header buttons: `#loadRepoBtn` (stub `https://api.github.com/**` and
  `https://raw.githubusercontent.com/**` with `ctx.route`; the outcome shows
  in the `#appToast` toast) and `#clearCacheBtn` (accept its `confirm`; the
  page reloads). Any `route()` switches Chromium's HTTP cache off, so a
  real-cache check needs a context with no routes — see
  `tests/header-cache-repo.test.mjs`.

## Gotchas

- Edits persist to localStorage on a **300ms debounce** — automation
  that edits and reloads immediately loses the draft. Wait ≥400ms after
  the last edit before reloading if you're testing persistence.
- Row editors remember expanded state (`_open`); clicking an already-open
  head collapses it. Check for the `open` class before clicking.
- Headless Chromium in this container renders some emoji monochrome
  (font fallback); that's the environment, not the app.
