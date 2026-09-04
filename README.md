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
| `backups/` | Point-in-time dumps of the central store, plus `extract-definitions.mjs` to rebuild `definitions.json` from one. See [backups/README.md](backups/README.md). |

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
- Give any free-text field **Default text** — boiler-plate that starts in that
  field in the Scope Builder (see [Default text](#default-text-boiler-plate)).

Options are entered one per line. A line starting with `### ` becomes a
non-selectable heading/divider.

### Default text (boiler-plate)

Each free-text field can carry **Default text**: standard wording written once,
here, that lands *in the entry box* in the Scope Builder for the end user to
edit in place. It is a starting answer, not a hint — unlike a placeholder it is
real text, so it copies into Word if the user leaves it alone.

- Set it in the row editor under **Fields (free-text inputs)** → *Default text*.
  Leave it blank for a field that starts empty (the previous behaviour).
- It can span several lines. Line breaks are kept all the way into Word, so a
  default can be several paragraphs — but a single-line **Text** field can't
  hold them, so set the field's type to **Text area** first (the editor says so
  if you type a multi-line default into a Text field).
- In the Scope Builder the field starts pre-filled; once it has been edited a
  **↺ Restore default text** link appears under it to put the supplied wording
  back. **Clear** on a row does the same.
- Untouched boiler-plate does **not** count towards the "n of m rows filled"
  progress bar — only an answer the user has actually changed does.
- Changing a default in Manage Tables fills it into any Scope Builder field the
  user has never touched. A field they deliberately emptied stays empty.

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

## Copying into Word

**Copy table for Word** puts the finished table on the clipboard as rich HTML
(with a plain-text fallback), ready to paste straight into a document.

**Column widths land as 1/3 : 2/3.** Word runs its own autofit over pasted HTML,
and it used to collapse the left-hand column of both tables (*Item*, and the
Property Services label column) to about one character wide — every row had to
be dragged wider by hand in the report. The copy now declares the geometry
firmly enough that autofit stands down: a **fixed table layout**, an absolute
table width, a `<colgroup>` carrying the column widths, and an explicit width on
**every** cell — the full-width `colspan="2"` heading rows included — in cm
(CSS) and in px (the legacy `width` attribute older Word builds read first).
Widths are absolute rather than percentages because Word re-runs autofit over
percentage widths and the narrow column collapses again.

The defaults sit at the top of the copy code in `index.html`, next to
`buildHtmlTable`, and are the only two lines to touch if the split should
change:

```js
const WORD_TABLE_CM  = 16;             // A4 portrait text width (21 cm − 2.5 cm margins ×2)
const WORD_COL_SPLIT = [1/3, 2/3];     // Item column, Details column — must add up to 1
```

Set `WORD_COL_SPLIT` to `[0.5, 0.5]` for an even split. Both copied tables share
the constants, so they always land the same width as each other.

Free-text answers keep the **line breaks the user typed**. A blank line between
two chunks of text in a field, or in a row's note, stays a blank line in Word —
the copy emits `<br>` for each newline rather than letting HTML collapse it to a
space, so multi-paragraph scope text no longer runs together. The plain-text
fallback puts one table row on one line, so there breaks collapse to `; ` (the
same separator it already uses between a row's several answers).

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
- **Keep a dump.** A paused or deleted project takes the store with it, and the
  only thing standing behind it is the bundled `definitions.json`. Download a
  backup from the dashboard now and then, drop it in `backups/`, and run
  `node backups/extract-definitions.mjs backups/<dump>` to refresh the offline
  fallback from it — see [backups/README.md](backups/README.md). The same script
  unpacks `definitions_history`, so rollback still works with the store down.

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
            { "key": "detail", "label": "Detail", "type": "text",   // or "textarea"
              "placeholder": "grey hint text",     // optional, never copied into Word
              "default": "Boiler-plate the user edits" }  // optional, see below
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

### `fields[].default` — boiler-plate a user edits

`default` is the field's starting **value**: it is written into the input in the
Scope Builder, where the user edits it in place, and it copies into Word like any
other answer. That is what separates it from `placeholder`, which is only grey
hint text and never appears in the output. A `default` may contain newlines —
they survive into Word — but only on a `"type": "textarea"` field, because a
single-line `"text"` input cannot hold a line break (the app flattens one to a
space, and the row editor warns about it).

See [Default text (boiler-plate)](#default-text-boiler-plate) for how it behaves
in the Scope Builder.

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
current table's coordinates over Queensland Government aerial imagery, LiDAR
contours (5 m by default), the road reserve (the cadastre's road parcels, filled a
translucent sandy colour), and **railway lines** (heavy rail, sidings, sugar-cane
and tourist lines, like the QLD Globe *Road and rail* layer). Pins come from every
row with a `mapPin` (above): `coords` always, `relocation` when it is not "No",
and — on the Water Level table — `riverCoords` / `riverRelocation`.

- **Framing** — the view is *constructed at the anchor pin's coordinate* (not a
  default state/CBD extent that a later `goTo` corrects), so it opens on the site
  even if a slow service delays everything else. The "Loading map…" overlay clears
  the instant the view is ready (`view.when()`), and the imagery / contour / road
  layers stream in underneath — a map missing one layer is still usable.
- **Every open re-fits the pins.** The MapView is deliberately kept alive between
  opens (rebuilding it costs a full Esri load), so panning or zooming used to
  leave the map sitting on the *previous* station when the modal was reopened for
  the next scoping session — you had to hunt for your own pins. Opening the modal
  now always re-frames on the pins showing at that moment. Manual framing still
  holds for as long as the modal stays open; it simply does not survive a close,
  and **Reset view** / **Fit all pins** are still there to get back to the pins
  mid-session.
- **Map diagnostics** — a collapsed *Map diagnostics* disclosure in the side panel
  reports, per external dependency (Esri CDN, imagery, contours, cadastre lookup,
  road layer), whether it **loaded / failed / timed out** and how long it took,
  plus the view centre vs. the anchor pin, the scale, and the active-pin count.
  Press **Copy diagnostics** to copy it as plain text. This is the primary channel
  for debugging the map on a locked-down PC with no browser DevTools — if the map
  misbehaves, open it, copy, and paste it back. Every external call is bounded by
  a timeout (see `SITE_MAP_CONFIG.timeouts`), so no service can ever hang the modal.
- **Row-selection panel** — tick/untick which pins show; the view re-fits as you
  do (until you pan or zoom, after which **Reset view** restores auto-fit).
- **Legend on the map** — the legend (each pin's label *and* its coordinate) and
  the contour caption are drawn **on the map itself**, in the same corners the
  exported picture puts them, rather than in the side panel. That is what makes
  the capture button honest: the map area you are looking at *is* the picture that
  gets pasted, legend included. The side panel keeps the *controls* — which pins
  show, their coordinates, the capture, the diagnostics. (The bottom attribution
  band is the one piece drawn only into the picture, because the live map already
  carries Esri's own attribution bar in that exact spot.) Turn the contours off
  and the caption goes with them, on screen and in the picture alike.
- **Contour interval** — 1 m / 5 m / 10 m, **defaulting to 5 m** (5 m paints
  much faster; 1 m is the slowest to load and is there when you need the detail),
  with an on/off toggle for a fast imagery-and-pins map. The contour line is a
  warm burnt-orange and slightly thickened so it reads over the aerial base map
  rather than disappearing into it. Outside LiDAR coverage the map falls back to a
  coarser interval and says which one it is showing (1 m LiDAR only exists over
  the eastern/SEQ coverage area).
- **Rail lines** — an on/off toggle in the header (on by default). Railway
  sublayers are resolved by name at runtime from the *Transportation/OtherTransport*
  MapServer (the `built.trans_railways` dataset) — every railway type is kept
  (heavy rail, sidings, sugar-cane, tourist/historic) and aviation/ports are
  dropped — and drawn with the service's own rail cartography, so the map matches
  the QLD Globe *Road and rail* look. Because it is a real map layer it is captured
  by the screenshot, so it travels into the Word-copy export too.
- **Edit a pin's coordinate** — every pin in the side panel has a **text field**
  (with a **Set** button; also commits on Enter or blur). Type a coordinate — decimal
  degrees or DMS, in the same formats the scope fields accept — and the pin moves,
  the value is written back to the scope row's field, and a toast offers **Undo**.
  A bad entry is refused with an inline message (and a lat/lon **swap** hint when
  the pair looks reversed), and *invalid* pins are editable too, so a mistyped
  coordinate can be fixed straight from the map. Clearing the field removes the pin
  (undoably). This is the keyboard counterpart to *Move pins*.
- **Build progress** — a thin progress bar along the bottom edge of the map (with
  a small label that names what is still drawing — "Building map…", "Drawing
  contours…") shows how much of the *whole* map is still being generated: imagery,
  the LiDAR contours (the slow part), the road reserve, the rail lines and the
  labels. It resets to zero whenever you change what the map shows (a pan/zoom, a
  contour or rail toggle, a resolution change) and **only finishes once every layer
  has actually finished drawing** — each layer is registered before its load starts
  and held until its layer view reports the drawing done, so the bar can't complete
  in the gap before the contours arrive or while they are still painting. It never
  locks the map — it captures no pointer events and disables nothing, so you can
  keep panning, zooming or dragging pins while it fills.
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
- **Getting the map into Word — press 📸 Copy map image** (in the Site Map
  header). It takes a picture of the map area **exactly as it is on screen**, puts
  that picture on the clipboard (paste anywhere with Ctrl+V) *and* attaches it to
  **Copy table for Word**, ticking *"Include site map in copied output"* for you.

  What you have to do is deliberately short: **frame the map, let it finish
  drawing, press the button.** The panel then shows a **thumbnail of the exact
  picture** — so if a capture ever comes out blank you see it there, in the
  modal, with the map still on screen beside it, instead of discovering it after
  pasting into a scope document. A capture that didn't render is refused outright
  and says what to wait for; nothing blank is ever put on the clipboard.

  Pan, zoom, retick a pin or change the contours and the picture no longer matches
  the map, so it is dropped and both the panel and the toolbar chip say *"the map
  has changed since you captured it"* — press the button again. The toolbar chip
  (next to the tick box) always answers the one question that matters before you
  copy: **is a map picture actually ready, and is it still the one I framed?**

  If you never open the Site Map at all, ticking the box still makes the copy
  build a picture unattended, exactly as before — it is just labelled as such in
  the diagnostics, because nobody has looked at it.
- **Offline / no network** — the Esri library and the QLD services are external.
  With no connection the modal says so and the Word copy still produces the
  tables (the map is an enhancement to the copy, never a dependency of it).

> **Why the copied map used to paste blank.** Every earlier route into the Word
> copy captured the map at a moment *nobody was looking at it*, and each had its
> own way of failing silently. Capturing from the toolbar with the modal shut left
> the MapView **suspended** (`.hidden` is `display:none`, and a view whose
> container is `display:none` stops rendering): the base layers had stopped
> drawing while `view.graphics` still painted the pins from memory and the legend
> was composited on afterwards — pins + legend + no map. Asking
> `takeScreenshot` for an explicit `width`/`height` did the same damage a
> different way: `view.width` is in **CSS pixels**, so on a Windows machine at
> 125%/150% display scaling it never matches the framebuffer, and Esri
> **re-renders** the scene at the requested size — where the tiled imagery and
> contours come back empty for tiles that aren't resident yet while the vector
> pins draw instantly. Both are now fixed (`whenCaptureReady` waits for an
> un-suspended, settled, painted frame; `takeViewScreenshot` reads the native
> framebuffer with no arguments; `rasterStats` refuses a frame the map never
> rendered into). But the deeper problem was that **the user was never shown the
> result**, so a silent failure could only surface in Word. Hence the capture
> button, the on-map legend and the thumbnail: the picture is made from the map in
> front of you, and handed straight back for you to look at.
>
> If a map still pastes blank, open **Map diagnostics** and read the
> *"Picture for the Word copy"* line. `captured by the user` means the picture in
> the document is one that was checked on screen; `built automatically` means
> nobody saw it and the capture button hasn't been used.

The map *services* (imagery / contour / cadastre endpoints) live in a documented
`SITE_MAP_CONFIG` constant near the top of the script in `index.html`, so an
endpoint move is a one-line edit. The imagery ImageServer reports a *Single Fused
Map Cache*, so it is loaded as an **`ImageryTileLayer`** (pre-built tiles), not a
plain `ImageryLayer` (which would re-render a dynamic mosaic on every pan/zoom).
The road-reserve **source** is **resolved against the live cadastre service at
runtime** (`resolveRoadSource`), best first, so the highlighted corridor matches
QLD Globe's *Road parcel* layer:

1. **A dedicated road sublayer.** QLD Globe's *Road parcel* draws the cadastre's
   *own* road feature set, so we first look for a dedicated **road polygon**
   sublayer in the service's layer list (by name — road labels / centrelines are
   excluded) and draw it **whole**, exactly the selection QLD Globe shows. It is
   still validated site-locally (a ~2 km envelope around the anchor pin) so an
   empty or annotation layer is never adopted.
2. **The parcel-filter fallback.** If no dedicated road sublayer exists, we fall
   back to the previous heuristic — the general parcel sublayer with a
   `UPPER(field) LIKE '%ROAD%'` filter, validated **against the site, not the
   state**: a candidate field is only accepted if it matches parcels inside the
   ~2 km envelope. A state-wide count proved to be a false positive (`tenure`
   matched 202 stray parcels across all of Queensland, none near any given site,
   so the layer "applied" while drawing nothing). If no candidate matches near the
   site, the resolver takes the **largest** state-wide match (a genuine road-parcel
   field matches in bulk; 202-out-of-millions noise loses), flagging in the
   diagnostics that nothing matched locally.

If nothing resolves at all, the road layer is hidden with a banner — never
unfiltered cadastre. This lookup runs **off the critical path**: the map opens and
frames the pins while it is still outstanding.

> **Why the road parcel used to look different from QLD Globe.** QLD Globe draws
> the cadastre's authoritative road parcels; the old code instead took the general
> parcel layer and applied a heuristic `LIKE '%ROAD%'` text-filter, a *different*
> selection (it can catch parcels merely *named* "…road…" and miss road parcels
> coded without the literal word), so the corridor didn't match. Preferring the
> dedicated road sublayer (above) fixes the selection. Two further differences are
> expected, not bugs: the **styling** is ours (a magenta outline over a translucent
> sandy fill, for contrast over aerial — QLD Globe uses a paler yellow highlight),
> and the cadastre feed is **DCDB-derived** — per its metadata the DCDB is **frozen
> as of 18 Apr 2026** (QSCF is now the source of truth), so a current QLD Globe can
> legitimately differ from a DCDB service for recently-changed parcels. The
> diagnostics *Cadastre* line reports which road source resolved.

> **Confirmed against the live service** (from working diagnostics sessions):
>
> - **Cadastre road field.** `tenure` was once recorded here as "the confirmed
>   DCDB field" off a 202-parcel state-wide count — a real diagnostics session at
>   a site with road reserves in view then showed those 202 parcels are nowhere
>   near any site, which is why candidates are now validated site-locally, with
>   `parcel_typ` (the DCDB parcel-type code) first in
>   `SITE_MAP_CONFIG.roadFieldCandidates`. The diagnostics *Cadastre* line states
>   which field resolved and whether it matched near the site or only state-wide.
> - **Contour sublayer IDs — resolved.** 1 m = **30**, 5 m = **20**, 10 m = **10**
>   on the `Elevation/Contours` MapServer. These are now carried as the fallback
>   values in `SITE_MAP_CONFIG.contourSublayers` (still probed by name at runtime),
>   so the 5 m default resolves an id even if the name probe misses — the probe now
>   also matches the "N metre" spellings the service actually uses.
> - **Imagery — confirmed.** Loads as an **`ImageryTileLayer`** in ~0.0 s (Esri
>   CDN ~0.9 s); all QLD hosts reachable.
>
> Road reserve is drawn as a **client-side `FeatureLayer`** with a high-contrast
> **magenta 2 px outline over a 50%-transparent sandy fill**
> (`SITE_MAP_CONFIG.roadFill`), and **no zoomed-in scale ceiling**
> (`maxScale: 0`): the fill makes the bounded reserve read like the usual QLD
> Globe view (a client-side render choice — the cadastre service ships no
> pre-styled "sandy reserve" layer), while the cadastre's own hairline outline is
> invisible over
> aerial imagery, and a server-side `maxScale` would hide the parcels at close
> zoom — the diagnostics panel prints the service's declared min/max scale for
> sublayer 4 so that suppression is visible if it ever recurs. Contours are drawn
> as a **`FeatureLayer`** for the selected interval (client-side WebGL, no
> per-pan `exportImage` round-trip) with a deliberately **lean fetch** — no
> `outFields`, so feature tiles carry only geometry plus the label field, and a
> `minScale` matching the zoom hint so zoomed-out views never queue whole-region
> 1 m fetches — falling back to a `png8`/dpi-96 `MapImageLayer` when the
> FeatureLayer path is unavailable *or the server cannot quantize geometries*
> (full-resolution 1 m LiDAR polylines are slower than a server render). There is
> an on/off toggle for a fast imagery-and-pins map.
>
> Because "applied/loaded" only proves a layer's *metadata* resolved, the
> diagnostics also report each operational layer's **first draw**: how long until
> the layer view actually finished drawing and how many features landed in the
> current extent — with a loud log warning when that count is zero (the exact
> signature of the invisible-road-reserve defect).

> **Note for maintainers:** the live map now renders correctly at real sites
> (imagery, contours, pins, framing and diagnostics all confirmed). The QLD
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
> - `tests/map-copy-recenter.test.mjs` — two live-view defects driven with a
>   stand-in view: the copied map image is captured at the view's **own** size
>   (never up-scaled, which used to return a blank base map with only pins over
>   white), and `fitView` **retries** a framing `goTo` that the modal-re-show
>   resize interrupts (which used to leave the old centre on screen). Hermetic.
> - `tests/map-visuals.test.mjs` — the sandy road-reserve fill, the 5 m contour
>   default, the warmer/thicker contour line, the "N metre" sublayer-name probe,
>   and the bottom-of-map build-progress bar (start → milestone → trickle →
>   settle/hide → reset, and that it never captures pointer events). Hermetic:
>   the store, the Esri CDN and every QLD host are blocked.
> - `tests/map-build-progress.test.mjs` — §A6.1: the build-progress bar must not
>   finish before the contours have drawn. A tracked layer that hasn't drawn holds
>   the bar even when the view has gone quiet; the hold follows the layer's *layer
>   view* (re-arming between fetch batches); a layer that never arrives releases
>   immediately so it can't wedge the bar; a pan or a re-open tracks the live
>   layers' redraw; and the real `buildView` registers all five operational layers
>   before their loads start. Hermetic (stand-in view and layer views).
> - `tests/pin-coord-entry.test.mjs` — §C2: editing a pin's coordinate from the
>   panel **text field** writes back to the scope row (undoable), refuses a bad
>   value with an inline message and a swap hint, keeps *invalid* pins editable,
>   and treats an empty entry as "remove the pin". Hermetic (no view, no network).
> - `tests/rail-road-source.test.mjs` — §C1 rail: `resolveRailLayers()` keeps only
>   the railway sublayers of the OtherTransport service (never aviation/ports, never
>   group layers); §A7 road: `resolveRoadSource()` prefers the cadastre's dedicated
>   road polygon sublayer (drawn whole, matching QLD Globe) and falls back to the
>   parcel-filter heuristic when none exists. Stubs only the ArcGIS REST endpoints,
>   like `road-filter.test.mjs`.
> - The `verify` skill covers coordinate parsing/validation, pin resolution and
>   gating, the panel, offline degradation, and the byte-identical copy when the
>   map tickbox is off.
>
> If an endpoint has moved, update `SITE_MAP_CONFIG`.
