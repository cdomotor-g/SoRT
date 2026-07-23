# SoRT — Forum Scope Builder

A single-page tool for building SORT Forum remediation scope tables and copying
them straight into Word. It has three modes:

- **Scope Builder** — click through a table, fill in the rows, copy the result.
- **Manage Tables** — a CRUD editor for the table/row definitions themselves,
  including a library of **common rows** shared across tables.
- **Table Map** — a grid of *common rows × tables*; tick a box to add that row
  to a table, untick to remove it, all in one view.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole application (no build step, no dependencies). |
| `definitions.json` | Seed / offline copy of the table, row, and option definitions. Also used to first-load the central store, and as the fallback when the store can't be reached. |

The definitions used to be hard-coded inside `index.html`. They now live outside
the app so they can change without touching the code. The **recommended** setup
is a single **central store** (a Supabase row) that everyone reads and that
editors publish to — see [Central store (Supabase)](#central-store-supabase).
With no store configured the app still works fully offline from
`definitions.json` + Import/Export.

## How definitions are loaded

At startup the app picks the first source that is available:

1. **Central store** — the master Supabase row (when `SUPABASE` is configured in
   `index.html`). This is the source of truth; it always wins on load, so every
   user gets the latest published definitions automatically.
2. **Local edits** saved in your browser (only when no store is configured, or
   as an *unpublished draft* you choose to resume).
3. A **URL** you previously loaded from, or one passed as `?defs=<url>`.
4. The bundled **`definitions.json`** sitting next to `index.html`.
5. If none load, an empty state offers **Import** / **Load from URL** / start blank.

> With the central store on, the master row is fetched over HTTPS regardless of
> how the page is opened — so it even works from a `file://` copy. The bundled
> `definitions.json` is only used if the store is unreachable (offline).

## Editing definitions (Manage Tables)

The editor lets you:

- Add / rename / duplicate / reorder / delete **tables**.
- Add / edit / duplicate / reorder / delete **rows**, including brand-new tables
  built from scratch.
- Set each row's **selection type**: single choice (radio), multiple choice
  (checkbox), or no options (free-text fields only).
- Give a row a **custom option list** or point it at a **shared option set**
  (e.g. the Comms / Accessibility / Demolition lists reused across tables — edit
  them in one place).
- Give a row an **icon** — shown beside the item name in the Scope Builder (and
  in the Table Map). Click **Choose icon…** in the row editor to pick one from
  the built-in palette, or type/paste any emoji. Icons are a visual aid in the
  app only; they are not included in the table copied into Word.
- Add free-text **fields** and an amber **approval note**.

Options are entered one per line. A line starting with `### ` becomes a
non-selectable heading/divider.

### Common rows (shared across tables)

Rows that belong in more than one table (Comms Option, Accessibility, Site
Assessment Photos, …) can be defined **once** and reused, so a change flows to
every table that uses them instead of being re-typed table by table.

- The **Common rows** panel at the bottom of *Manage Tables* is the library:
  add / edit / duplicate / reorder / delete a common row there, exactly like a
  normal row. Each editor shows which tables currently use it.
- Inside a table, a common row appears as a locked **shared** card — reorder it
  or remove it from that table, but edit the definition from the library.
- To turn an existing one-off row into a common row, expand it in the table
  editor and click the **✦** ("make common") button — it moves into the library
  and stays in that table as a reference.
- Add a common row to a table from the table editor's **"add common row"**
  dropdown, or from the **Table Map**.

### Table Map

The **Table Map** tab shows a grid: **common rows** down the side, **tables**
across the top. Each cell is a checkbox — tick it to include that row in that
table, untick it to remove it. It's the fastest way to see and change, at a
glance, which shared rows appear where. (Only common rows appear in the map; a
table's own one-off rows stay in *Manage Tables*.) Changes save to your browser
and, with the central store on, go live for everyone when you **Publish**.

### Publishing your changes

**With the central store on (recommended):**

1. Make your changes in **Manage Tables** (auto-saved in your browser as you go).
2. Click **Publish to central store**.

That's it — the master row is updated and everyone else picks it up the next
time they open the app. No files to download, rename, or upload, and no "reset"
step for other users. Extras you get for free:

- **Reload latest** — throw away your local edits and reload the published copy.
- **Conflict guard** — if someone else published while you were editing, Publish
  is refused with a prompt to reload and re-apply, so nobody silently clobbers
  another edit.
- **Resume draft** — if you close the tab mid-edit, your unpublished draft is
  offered back next time (you can resume or discard it).
- **History / rollback** — every publish is archived (see the setup section), so
  a bad change can be rolled back.

**With no store configured (offline mode):** edits are saved in your browser
only. Click **Export JSON**, upload the file to your shared location as
`definitions.json`, and others use **Reset to published file** to pick it up.

## Property Services (second table)

A separate **Property Services Instruction** table renders at the bottom of the
Scope Builder for every station type and is copied into Word as its **own second
table** — so a copy/paste lands the scope table and the Property Services table
as two tables in the report.

- **Pre-filled from the scope answers above, but overridable.** Current
  coordinates, the relocation answer, and the relocation coordinates mirror the
  matching scope rows (`coords`, `riverCoords`, `relocation`). The mirror is live
  *until you edit the field* — the first manual change detaches it (shown as
  **Overridden**, with a **Reset to scope value** link to re-link it). This
  one-way flow (scope → Property Services, never the reverse) is the deliberately
  safe interaction model.
- **Relocation preselected.** "Is the equipment being relocated?" is preselected
  from the Relocation answer above, with an in-app note explaining the link. That
  note is **not** copied into Word.
- **Highlighted until answered.** "Turning of soil?" and "Will the orifice line
  be replaced?" are not auto-derived; they are highlighted until you answer them.
  The orifice/"Water Level site details only" rows are only *required* on the
  Water Level table.
- **Auto date**, and a fixed **Note** (the Property Services due-diligence text)
  that *is* copied into Word.
- **Managed in its own tab.** The **Property Services** tab edits the table's
  title, note, questions and coordinate rows. Its shape lives under
  `definitions.json → propertyServices` and publishes through the central store
  like the rest (a built-in default is used if the loaded definitions do not yet
  carry one).

## Central store (Supabase)

The central store is a single row in a free [Supabase](https://supabase.com)
project. No Azure / M365 app registration and no per-user accounts are required —
the app talks to Supabase's REST API with the public **anon** key, and
[Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
controls what that key may do.

### One-time setup

1. Create a free Supabase project.
2. In the **SQL Editor**, run the following. Paste the current contents of
   `definitions.json` where indicated to seed the first row.

   ```sql
   -- Master table: one row holds the whole definitions document.
   create table definitions (
     id         int primary key,
     doc        jsonb        not null,
     version    int          not null default 1,
     updated_at timestamptz  not null default now()
   );

   -- Archive of every past version, for audit / rollback.
   create table definitions_history (
     history_id  bigint generated always as identity primary key,
     id          int,
     doc         jsonb,
     version     int,
     archived_at timestamptz default now()
   );
   -- SECURITY DEFINER lets this trigger write to the (RLS-locked) history
   -- table on behalf of the anon caller, without exposing that table.
   create function log_definitions_history() returns trigger
   language plpgsql
   security definer
   set search_path = public
   as $$
   begin
     insert into definitions_history(id, doc, version)
     values (old.id, old.doc, old.version);
     return new;
   end;
   $$;
   create trigger definitions_history_trg
     before update on definitions
     for each row execute function log_definitions_history();

   -- Seed the single master row (id = 1). Paste definitions.json below.
   insert into definitions (id, doc, version) values (1, '<PASTE definitions.json HERE>'::jsonb, 1);

   -- Row Level Security: allow the public anon key to read and update the row.
   alter table definitions enable row level security;
   create policy "read definitions"   on definitions for select using (true);
   create policy "update definitions" on definitions for update using (true) with check (true);
   ```

3. In **Project Settings → API**, copy the **Project URL** and the **anon /
   public** key.
4. Open `index.html` and fill in the `SUPABASE` block near the top:

   ```js
   const SUPABASE = {
     url:     "https://YOURPROJECT.supabase.co",
     anonKey: "eyJhbGciOi...",   // the public anon key
     table:   "definitions",
     rowId:   1,
     publishPassphrase: ""       // optional; see below
   };
   ```

5. Host `index.html` anywhere your users can reach (GitHub Pages, a web server,
   a SharePoint page, even a shared drive). Done.

### Notes on access & security

- The **anon key is meant to be public** — it ships in the browser. RLS is what
  protects the data, so the policies above are the real access control. To make
  the store **read-only for everyone** and manage edits yourself, drop the
  `update` policy; to lock writes to signed-in editors, replace `using (true)`
  with a check against `auth.role()` / `auth.uid()` and turn on Supabase Auth
  (email magic-link works without any app registration).
- `publishPassphrase` adds a prompt before publishing. It is a speed-bump to
  stop accidental edits, **not** real security (anyone with the anon key can
  still write per your RLS policy). Leave it `""` to let any editor publish.
- **Rollback:** every publish copies the previous document into
  `definitions_history`. To restore one, copy its `doc` back onto the master row
  (`update definitions set doc = (...), version = version + 1 where id = 1;`).

### Troubleshooting

- **Publish fails with `new row violates row-level security policy for table
  "definitions_history"`** — the history trigger can't write to the RLS-locked
  history table. Make the trigger function `SECURITY DEFINER` (re-run the
  `create or replace function log_definitions_history() …` block above; it swaps
  the function in place, no other changes needed).
- **`HTTP 401: Invalid API key` / `No API key found`** — the `anonKey` or `url`
  in the `SUPABASE` block is wrong, mismatched, or a placeholder. Re-copy both
  from Project Settings → API (URL must have no trailing slash).

## Definition format

```jsonc
{
  "version": 1,
  "meta": { "appTitle": "…", "updated": "YYYY-MM-DD" },
  "optionSets": {
    "comms": ["Option one", "Option two"]        // reusable, referenced by rows
  },
  "sharedRows": [                                 // "common" rows reused by tables
    {
      "id": "comms",                             // unique among sharedRows
      "item": "Comms Option",
      "type": "single",
      "optionSet": "comms"
    }
  ],
  "tables": [
    {
      "id": "rainfall",                           // unique internal key
      "label": "Rainfall Table",                  // tab label
      "title": "Rainfall Table",                  // printed title in the copied table
      "rows": [
        {
          "id": "stationType",                    // unique within the table
          "item": "Station Type",                 // row name (left column)
          "icon": "🌧",                           // optional, shown beside the item in the app
          "instruction": "(Choose relevant option)",
          "type": "single",                       // "single" | "multi" | "none"
          "options": ["Rain Gauge"],              // inline list …
          // "optionSet": "comms",                // … OR reference a shared set
          "note": "Requires GM approval",         // optional amber note
          "fields": [                             // optional free-text inputs
            { "key": "detail", "label": "Detail", "type": "text" }  // or "textarea"
          ],
          "mapPin": {                             // optional: this row carries a coordinate for the Site Map
            "field": "detail",                    // which of the row's `fields` holds the lat/long
            "label": "Current location",          // pin label
            "colour": "red",                      // red|orange|blue|purple|green|teal (or a #rrggbb)
            "defaultOn": true,                    // pin ticked by default on the map
            "anchor": true,                       // this pin is the default map centre
            "requires": { "row": "relocation", "not": "No" }  // optional gate (see below)
          }
        },
        { "shared": "comms" }                     // reference to a sharedRows entry
      ]
    }
  ]
}
```

A table row is therefore **either** an inline row (the object shape above)
**or** a reference `{ "shared": "<id>" }` pointing at a `sharedRows` entry with
that `id`. References are resolved at render time, so one shared definition can
appear in any number of tables; each table still collects its own answers.

### `mapPin` — declaring a coordinate row for the Site Map

Any row that holds a coordinate can declare a **`mapPin`** so it becomes a pin on
the **Site Map** (see below). This is what makes adding a new coordinate row a
*definitions* edit rather than a code change — nothing in the app hardcodes which
rows are coordinates. `mapPin` fields:

| Key | Meaning |
| --- | --- |
| `field` | **Required.** The `fields` key that holds the lat/long (e.g. `existing`). |
| `label` | The pin's label in the panel, popup and legend. |
| `colour` | `red`, `orange`, `blue`, `purple`, `green`, `teal`, or a `#rrggbb`. |
| `defaultOn` | Whether the pin is ticked by default (default `true`). |
| `anchor` | `true` marks this pin as the default map centre. One row should be the anchor. |
| `requires` | Optional gate — show the pin only when another row's answer meets a condition: `{ "row": "<rowId>", "not": "No" }` (show unless that row's answer is "No") or `{ "row": "<rowId>", "equals": "Yes" }`. Evaluated generically; no row id is special-cased in code. |

Edit a row's pin in **Manage Tables** (the *Site Map pin* section of the row
editor, available for both table rows and common rows). Documents that predate
`mapPin` are handled gracefully: if a loaded definition set declares **no** pin
at all, the app seeds the well-known coordinate rows (`coords`, `relocation`,
`riverCoords`, `riverRelocation`) with sensible defaults so the map works out of
the box — exactly as it seeds a default Property Services block. Publish once to
bake those defaults (or your own) into the central store.

## Site Map

The **Site Map** button (next to *Copy table for Word*) opens a modal showing the
current table's coordinates over Queensland Government aerial imagery, 1 m LiDAR
contours, and the road reserve (cadastral parcels filtered to road). Pins come
from every row with a `mapPin` (above): `coords` always, `relocation` when it is
not "No", and — on the Water Level table — `riverCoords` / `riverRelocation`.

- **Framing** — the view is *constructed at the anchor pin's coordinate* (not a
  default state/CBD extent that a later `goTo` corrects), so it opens on the site
  even if a slow service delays everything else. The "Loading map…" overlay clears
  the instant the view is ready (`view.when()`), and the imagery / contour / road
  layers stream in underneath — a map missing one layer is still usable.
- **Map diagnostics** — a collapsed *Map diagnostics* disclosure in the side panel
  reports, per external dependency (Esri CDN, imagery, contours, cadastre lookup,
  road layer), whether it **loaded / failed / timed out** and how long it took,
  plus the view centre vs. the anchor pin, the scale, and the active-pin count.
  Press **Copy diagnostics** to copy it as plain text. This is the primary channel
  for debugging the map on a locked-down PC with no browser DevTools — if the map
  misbehaves, open it, copy, and paste it back. Every external call is bounded by
  a timeout (see `SITE_MAP_CONFIG.timeouts`), so no service can ever hang the modal.
- **Row-selection panel** — tick/untick which pins show; the view re-fits as you
  do (until you pan or zoom, after which **Reset view** restores auto-fit). Each
  pin's coordinate is shown next to its label, and travels into the exported image.
- **Contour interval** — 1 m / 5 m / 10 m, defaulting to 1 m, with an on/off
  toggle for a fast imagery-and-pins map. Outside LiDAR coverage the map falls
  back to a coarser interval and says which one it is showing (1 m LiDAR only
  exists over the eastern/SEQ coverage area).
- **Move pins** — a toolbar toggle (off by default). While on, drag a pin to a
  new location: the coordinate is rounded to 6 dp, written back to the scope
  row's field, and a toast shows how far it moved with a one-click **Undo**. The
  scope field shows the new value on close — no silent rewrites, no accidental
  nudges (the mode is explicit).
- **Measure** — Esri's `DistanceMeasurement2D`, geodesic, metres switching to km
  above 1 km, with the widget's own clear/reset. Measurements are transient and
  do not appear in the exported image.
- **Relocation distance** — when both the current-location and relocation-site
  pins parse, the panel offers the geodesic distance between them as a one-click
  suggestion for the Relocation *Distance* field (it never overwrites a typed
  value silently, and it is undoable). Recomputed when a pin is dragged. The
  river-line relocation distance is intentionally **not** auto-calculated: there
  is no matching field in `definitions.json`, so it is left alone rather than
  guessed at.
- **Include in the Word copy** — tick *"Include site map in copied output"* to
  paste a screenshot of the map (with pins, legend, contour interval and the
  QLD/Esri attribution) into Word alongside the tables. The **Copy map image**
  button is a one-step fallback if Word strips the inline image. What you see —
  including any manual panning — is what gets pasted.
- **Offline / no network** — the Esri library and the QLD services are external.
  With no connection the modal says so and the Word copy still produces the
  tables (the map is an enhancement to the copy, never a dependency of it).

The map *services* (imagery / contour / cadastre endpoints) live in a documented
`SITE_MAP_CONFIG` constant near the top of the script in `index.html`, so an
endpoint move is a one-line edit. The imagery ImageServer reports a *Single Fused
Map Cache*, so it is loaded as an **`ImageryTileLayer`** (pre-built tiles), not a
plain `ImageryLayer` (which would re-render a dynamic mosaic on every pan/zoom).
The road-reserve filter is **resolved against the live cadastre schema at
runtime** — the app reads the layer's fields, picks the one that denotes road,
and filters to it; if it cannot resolve cleanly it hides the road layer and shows
a banner rather than drawing unfiltered cadastre. This lookup runs **off the
critical path**: the map opens and frames the pins while it is still outstanding.

> **Confirmed against the live service** (from a working diagnostics session, so
> these are now facts, not candidates):
>
> - **Cadastre road field — resolved.** The road filter is
>   **`UPPER(tenure) LIKE '%ROAD%'`**, matching **202 parcels** at a real site.
>   `tenure` is the confirmed DCDB field; the rest of
>   `SITE_MAP_CONFIG.roadFieldCandidates` remain only as fallbacks should the
>   schema ever change.
> - **Contour sublayer IDs — resolved.** 1 m = **30**, 5 m = **20**, 10 m = **10**
>   on the `Elevation/Contours` MapServer. (These are also probed by name at
>   runtime; the values above are what the live service returns.)
> - **Imagery — confirmed.** Loads as an **`ImageryTileLayer`** in ~0.0 s (Esri
>   CDN ~0.9 s); all QLD hosts reachable.
>
> Road reserve is drawn as a **client-side `FeatureLayer`** with a high-contrast
> **magenta 2 px outline and no fill**, and **no zoomed-in scale ceiling**
> (`maxScale: 0`): the cadastre service's own hairline outline is invisible over
> aerial imagery, and a server-side `maxScale` would hide the parcels at close
> zoom — the diagnostics panel prints the service's declared min/max scale for
> sublayer 4 so that suppression is visible if it ever recurs. Contours are drawn
> as a **`FeatureLayer`** for the selected interval (client-side WebGL, no
> per-pan `exportImage` round-trip), with a lean `png8`/dpi-96 `MapImageLayer`
> fallback and an on/off toggle.

> **Note for maintainers:** the live map now renders correctly at real sites
> (imagery, 1 m contours, pins, framing and diagnostics all confirmed). The QLD
> ArcGIS endpoints and the Esri CDN remain **unreachable from the build sandbox**
> (network egress policy), so changes touching the live render, the road-filter
> resolution, the `takeScreenshot` CORS behaviour, or the paste into desktop Word
> must still be spot-checked in a real browser. Logic that does **not** need those
> services is covered by automated checks:
>
> - `tests/reopen-coords.test.mjs` — A3 regression: reopening the modal after a
>   table edit re-resolves the pins from app state and re-centres on the anchor
>   when it moved (see `tests/README.md` to run it). It drives the real app code
>   in headless Chromium and stubs no QLD service.
> - The `verify` skill covers coordinate parsing/validation, pin resolution and
>   gating, the panel, offline degradation, and the byte-identical copy when the
>   map tickbox is off.
>
> If an endpoint has moved, update `SITE_MAP_CONFIG`.
