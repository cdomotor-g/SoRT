# SoRT Roadmap

Planned enhancements for the SoRT Forum Scope Builder. This document is a
**plan only** — none of the items below are implemented yet. Each item lists the
intent, the touch points in the current codebase, open questions, and rough
acceptance criteria so the work can be picked up later.

> Current codebase at time of writing: a single-page app (`index.html`) with all
> table/row definitions in `definitions.json`. Definitions load in this order —
> central Supabase store → local browser edits → a remembered/`?defs=` URL →
> the bundled `definitions.json`. Reloads already use `fetch(url, { cache:"no-store" })`.

## Status legend

| Status | Meaning |
| --- | --- |
| 📋 Planned | Agreed, not started. |
| 🚧 In progress | Being built. |
| ✅ Done | Shipped. |

---

## 1. "Property Services" section 📋

Add a new section to the **bottom of the SORT tables** called **Property
Services**. It is a richer, map-aware block rather than a plain option table.

### Scope

- **Coordinates** — capture latitude/longitude for the station/site. Should
  reuse or align with the existing coordinate fields already in
  `definitions.json` (the `coords` "Instrumentation Coordinates" row and the
  `relocation` row's "New Location (coordinates)" field) rather than duplicating
  them inconsistently.
- **Embedded map** — a map view showing the current coordinates.
- **Questions** — a set of Property Services questions, including at least:
  - "Will soil be turned?"
  - "Will the station be relocated?"
  - _(additional questions to be defined by the user)_
- **Relocation pin-point** — when a relocation is indicated, let the user drop /
  drag a pin on the map to set the **new location**, and have the map write that
  pinned lat/long back into the relocation coordinate field.
- **"Check QLDGlobe" button** — opens a **new window/tab** to Queensland Globe
  with the section's coordinates **preloaded** so the operator lands on the site
  location.

### Touch points

- `index.html` — new section rendering + map widget + button wiring.
- `definitions.json` — new table/section definition (or a new row `type`) for
  Property Services; align coordinate fields with existing `coords` /
  `relocation` entries.

### Open questions / to define with user

- **Remaining questions** beyond "will soil be turned" / "will the station be
  relocated" — exact wording and answer types (yes/no vs. free text).
- **Map provider** — the app is currently dependency-free (no build step, no
  external libraries). A map + interactive pin implies either a JS map library
  (e.g. Leaflet) or an embedded provider iframe. Decide whether to take on that
  dependency and how it degrades offline / in `file://` mode.
- **QLDGlobe deep-link format** — confirm the exact URL scheme that preloads
  coordinates in Queensland Globe (which query params / zoom / marker it
  accepts) before wiring the button.
- **Copy-to-Word behaviour** — how (and whether) the Property Services answers,
  coordinates, and map appear in the table copied into Word.
- **Data shape** — how Property Services answers are stored alongside the other
  table answers, and whether they publish through the central store like the
  rest.

### Acceptance criteria (draft)

- A "Property Services" section appears at the bottom of the scope tables.
- Coordinates can be entered and are shown on an embedded map.
- The defined questions render and their answers are captured.
- A relocation pin can be placed on the map and its coordinates flow into the
  relocation field.
- "Check QLDGlobe" opens a new window at the correct location with coordinates
  preloaded.

---

## 2. Station picker backed by `stations.json` 📋

Introduce a new **`stations.json`** file (a directory of known stations) and let
the user **type-ahead / click to select** their station of interest. Selecting a
station **propagates its data — such as coordinates — into the (new) Property
Services section**.

### Scope

- New **`stations.json`** file in the repo listing stations and their metadata
  (at minimum: station id/name and coordinates; other fields TBD).
- A **searchable picker** in the app (type to filter, click to select).
- On selection, **auto-populate** the Property Services coordinates (and any
  other mapped fields) from the chosen station.

### Touch points

- `stations.json` — **new file**, repo root (next to `definitions.json`), so it
  can change without touching code.
- `index.html` — loader for `stations.json`, the picker UI, and the wiring that
  copies selected station data into the Property Services fields (Item 1).
- Ties directly into Item 1 (the fields it populates) and Item 3 (how it is
  refreshed).

### Open questions / to define with user

- **`stations.json` schema** — exact field list per station (id, display name,
  coordinates, region, station type, comms, …?).
- **Load source & precedence** — is `stations.json` bundled only, or also
  fetched from the central store / a URL like `definitions.json`? How does it
  behave offline?
- **Match key** — how a selected station maps onto Property Services fields
  (which fields get auto-filled, and whether the user can override them after).

### Acceptance criteria (draft)

- `stations.json` exists and is loaded by the app.
- The user can type to filter and click to select a station.
- Selecting a station fills the Property Services coordinates (and any other
  mapped fields) automatically.

---

## 3. "Load from GitHub" button 📋

Add a **"Load from GitHub"** button that **clears the browser cache and reloads
the definitions from the repo** — both the existing **`definitions.json`** and
the new **`stations.json`**.

### Scope

- A button (near the existing "Reload latest" controls) that:
  1. **Kills the browser cache** for the definitions/stations resources.
  2. **Re-fetches `definitions.json`** from the GitHub repo.
  3. **Re-fetches `stations.json`** from the GitHub repo.
  4. Re-renders the app with the freshly loaded data.

### Touch points

- `index.html` — new button + handler. The codebase already fetches with
  `fetch(url, { cache:"no-store" })` and has a `loadFromUrl(...)` /
  `reloadFromRemote(...)` pattern to build on. This adds an explicit
  GitHub-repo source and extends the reload to cover `stations.json`.

### Open questions / to define with user

- **Repo URL** — the exact raw GitHub URL(s) / branch to pull from (e.g. raw
  `main`), and whether it is configurable.
- **Cache strategy** — `cache:"no-store"` plus a cache-busting query param, and
  whether any Service Worker / app cache also needs clearing.
- **Precedence vs. central store** — how a manual "Load from GitHub" interacts
  with the existing Supabase central-store load order, and what happens to
  unpublished local edits (warn / discard like "Reload latest" does today).

### Acceptance criteria (draft)

- A "Load from GitHub" button is present.
- Clicking it bypasses the browser cache and reloads both `definitions.json` and
  `stations.json` from the repo.
- The UI reflects the freshly loaded definitions and station list.

---

## Sequencing & dependencies

1. **Item 1 (Property Services)** establishes the fields, map, and QLDGlobe link.
2. **Item 2 (stations.json picker)** depends on Item 1's fields to populate.
3. **Item 3 (Load from GitHub)** depends on `stations.json` from Item 2 existing,
   and extends the existing reload flow to cover it.

A natural build order is **1 → 2 → 3**, though `stations.json`'s schema (Item 2)
should be sketched early because Item 1's coordinate auto-fill and Item 3's
reload both reference it.
