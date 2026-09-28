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
| `definitions.json` | The published table, row, and option definitions. The app reads it from GitHub on startup and **Publish to GitHub** commits edits back to it; the copy bundled next to `index.html` is the offline fallback. |
| `backups/` | The last dump of the retired Supabase store, plus `extract-definitions.mjs` to rebuild `definitions.json` from it. Kept for the record — see [backups/README.md](backups/README.md). |

The definitions used to be hard-coded inside `index.html`. They now live outside
the app so they can change without touching the code, and **`definitions.json`
in this GitHub repo is the single source of truth**: everyone reads it, editors
publish to it from the app, and its commit history is the audit trail and the
way to roll back — see [Publishing to GitHub](#publishing-to-github). With
`GITHUB_REPO` blanked out the app still works fully offline from the bundled
`definitions.json` + Import/Export.

## How definitions are loaded

At startup the app picks the first source that is available:

1. **GitHub** — `definitions.json` in the repo named by `GITHUB_REPO` in
   `index.html`, read through the GitHub API (or `raw.githubusercontent.com` if
   the API refuses). This is the source of truth; it always wins on load, so
   every user gets the latest published definitions automatically.
2. **Local edits** saved in your browser (only when GitHub can't be reached, or
   as an *unpublished draft* you choose to resume).
3. A **URL** you previously loaded from, or one passed as `?defs=<url>`.
4. The bundled **`definitions.json`** sitting next to `index.html`.
5. If none load, an empty state offers **Import** / **Load from URL** / start blank.

> GitHub is read over HTTPS however the page is opened — even from a `file://`
> copy. The bundled `definitions.json` is only used if GitHub is unreachable
> (offline).

Two buttons in the header work on this from any tab: **Load from repo** pulls
the published `definitions.json` from GitHub again, and **Clear cache** forgets
what the app has saved in this browser and reloads it fresh — see
[Header buttons](#header-buttons-load-from-repo--clear-cache).

## Header buttons: Load from repo / Clear cache

Both sit in the header next to the dark-mode toggle, so they are there on every
tab.

### Load from repo

Loads the published `definitions.json` straight from GitHub — the same as
**Reload latest** in Manage Tables, from any tab. Useful after someone publishes,
or after an edit made directly on github.com.

- **Current, not cached.** It asks the GitHub contents API, which returns the
  branch as it is right now. Anonymous API use is limited to 60 requests an hour
  per network address (a whole office behind one address shares that; with a
  token connected it is 5,000), so when the API refuses — or is blocked — it
  falls back to `raw.githubusercontent.com` with a cache-busting query. That copy
  can run up to 5 minutes behind a brand-new commit, and the message says so when
  it is the one used.
- **Work in progress is safe.** Answers already filled in carry over to every
  row that still exists. If the browser holds unpublished edits, it asks before
  throwing them away. If GitHub can't be reached, or sends back something that
  isn't a definitions file, nothing changes and the message says why. Each
  request gives up after 10 s, so the button can't hang.

### Clear cache

Clears what SoRT has saved in this browser and reloads the app fresh from the
server — the fix for "I'm still seeing the old tables / the old version" on a PC
with no DevTools to clear things by hand. It asks first, because the reload also
clears anything filled in on the page.

- **What goes:** every `sort.*` key in this browser's storage — the unpublished
  draft (`sort.definitions.v1`, and `sort.definitions.base`, the version it was
  edited from) and a remembered *Load from URL* address (`sort.definitionsUrl`).
- **What stays:** the dark/light theme choice, the GitHub connection (Disconnect
  is how that goes), and other apps' data — every GitHub Pages site on one
  account shares an origin, so a blanket clear would wipe theirs too. The
  published `definitions.json` on GitHub is never touched.
- **A fresh page, not a cached one.** GitHub Pages lets browsers reuse
  `index.html` for up to 10 minutes, so just after a deploy an ordinary visit can
  still get the old version. Clear cache re-fetches the page past the HTTP cache
  (`cache:"reload"`) before it reloads, then says *Cache cleared* once the fresh
  page is up.

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
and go live for everyone when you **Publish to GitHub**.

### Publishing your changes

1. Make your changes in **Manage Tables** (auto-saved in your browser as you go).
2. Click **Publish to GitHub** and type a line saying what changed — it becomes
   the commit message. (The very first time, you connect a GitHub token — see
   [Publishing to GitHub](#publishing-to-github).)

That's it — `definitions.json` in the repo is updated in one commit and everyone
else picks it up the next time they open the app. No files to download, rename,
or upload, and no "reset" step for other users. Extras you get for free:

- **Reload latest** — throw away your local edits and reload the published copy.
- **Conflict guard** — if `definitions.json` changed on GitHub since you loaded it
  (someone else published, or edited it on github.com), Publish is refused with a
  prompt to reload and re-apply, so nobody silently clobbers another edit.
- **Resume draft** — if you close the tab mid-edit, your unpublished draft is
  offered back next time (you can resume or discard it). A draft remembers which
  published version it was made from, so the conflict guard still works days
  later.
- **Nothing to publish** — a copy identical to GitHub's (bar the date stamp) is
  not committed.
- **History / rollback** — every publish is a commit. **History & roll back ↗**
  in Manage Tables opens the file's history on GitHub; to go back, revert that
  commit on GitHub, or download the old version, **Import JSON…** it and publish.

**Offline (`GITHUB_REPO.owner` left blank):** edits are saved in your browser
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
  `definitions.json → propertyServices` and publishes to GitHub
  like the rest (a built-in default is used if the loaded definitions do not yet
  carry one).

## Publishing to GitHub

The published definitions are `definitions.json` in this repo. The app reads it
with no sign-in (the repo is public) and publishes by committing to it through
the GitHub API, straight onto `main`. The repo, branch and file are the
`GITHUB_REPO` constant near the top of the script in `index.html`:

```js
const GITHUB_REPO = {
  owner:     "cdomotor-g",
  repo:      "SoRT",
  branch:    "main",
  path:      DEFINITIONS_FILE,    // "definitions.json"
  timeoutMs: 10000
};
```

### Connecting (once per computer)

Publishing needs a GitHub token that is allowed to change the repo. The first
time you click **Publish to GitHub** (or **Connect…** in Manage Tables) the app
walks you through it:

1. **Create a token on GitHub ↗** opens GitHub's *new fine-grained token* page
   with the name (*SoRT publishing*), a one-year expiry and **Contents: Read and
   write** already filled in. Under **Repository access** pick **Only select
   repositories** → **SoRT**, then **Generate token**.
2. Copy the token and paste it into the app. It checks the token before keeping
   it — whose it is, and that it can write to the repo — and says exactly what to
   change if not. (The write check creates an empty git blob that no commit points
   at, so it changes no file and no history.)

Manage Tables then shows **GitHub: @you** with a **Disconnect** button. Leave
**Remember on this computer** ticked to stay connected; untick it and the token
is forgotten when the tab closes.

### Notes on access & security

- **The token lives in this browser only** — never in the repo, and it is only
  ever sent to GitHub. Anyone who can use this browser profile could publish with
  it, so give it the least it needs: **only the SoRT repository**, only
  **Contents: Read and write**, with an expiry. **Disconnect** removes it from the
  browser; revoke it on GitHub (*Settings → Developer settings → Personal access
  tokens → Fine-grained tokens*) to kill it everywhere.
- Every GitHub Pages site on one account shares an origin
  (`cdomotor-g.github.io`), and so shares browser storage. Only host pages there
  you trust — another one could read the token — which is one more reason to keep
  it scoped to this repo.
- **Who can publish is who GitHub lets write to the repo.** Anyone can read; a
  token only works for accounts with write access, and there is no shared key or
  passphrase to leak.
- **Rate limits.** Reading uses the GitHub API: 60 requests an hour per network
  address anonymously, 5,000 with a token connected. When the API refuses, the app
  reads `raw.githubusercontent.com` instead (up to 5 minutes behind a new commit).
- **Branch protection.** Publishing commits straight to `main`. Protecting `main`
  so that only pull requests can change it would stop Publish working.
- **GitHub Pages.** Each publish is a commit to `main`, so Pages redeploys the
  site copy of `definitions.json` a minute or two later. The app itself reads
  through the API, so a publish is live for everyone at once.

### Troubleshooting

- **"definitions.json changed on GitHub since you loaded it"** — someone
  published, or the file was edited on github.com, after you loaded it. Click
  **Reload latest**, re-apply your change, and publish again.
- **"The connected token can't change cdomotor-g/SoRT"** — the token can read
  the repo but not write to it: on GitHub, edit the token so **Repository access**
  includes **SoRT** and **Contents** is **Read and write**.
- **"GitHub didn't accept the saved token"** — it has expired or been revoked.
  The app forgets it; **Connect…** with a new one.
- **"Reload failed … nothing was changed"** after an edit on github.com — the
  file on GitHub no longer makes sense to the app (a slip in a hand edit). Your
  unpublished edits are untouched; fix the file on GitHub, or revert that commit
  from its history. Until then the app starts from the copy in this browser or
  the bundled `definitions.json`.

### The retired Supabase store

The app used to keep the definitions in a Supabase database row. That is gone
from the app — Supabase paused the free project whenever it sat idle, which
suited an app that changes rarely very badly. Its last dump is kept in
`backups/` for the record (see [backups/README.md](backups/README.md)), and the
Supabase project itself can be deleted.

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
bake those defaults (or your own) into `definitions.json` on GitHub.

## Site Map

The **Site Map** button (next to *Copy table for Word*) opens a modal showing the
current table's coordinates over Queensland Government aerial imagery, LiDAR
contours (5 m by default), the road reserve (the cadastre's road parcels, filled a
translucent sandy colour), and **railway lines** (heavy rail, sidings, sugar-cane
and tourist lines, like the QLD Globe *Road and rail* layer). Pins come from every
row of the current table with a `mapPin` (above): `coords` always, `relocation`
when it is not "No", `riverCoords` / `riverRelocation` on the Water Level tables,
and the TBRG location on the Repeater / Gateway table.

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
- **Every location, entered or not** — the side panel (*Locations*) lists every
  location the current table has, whether or not a coordinate has been typed into
  the form, so the first entry can be made on the map. Some users skip the form
  and start here. Only the table's own `mapPin` rows are listed, so each station
  type offers just its own locations: the Rainfall table has the current location
  and the relocation site, the Water Level tables add the river-line termination
  and its relocation, and the Repeater / Gateway table adds the TBRG location. A
  gated row follows its gate (no relocation site while Relocation is "No"). A
  location with nothing entered shows an empty field that says which table row it
  fills. Type a coordinate there and the pin drops, the map frames it, and the value
  is written into that row of the form. The row's preview, the progress bar and the
  Property Services mirror follow, and the toast offers **Undo**. Opening the map
  with nothing entered puts the cursor in the first location. A commit keeps the
  focus in the panel, so clicking or tabbing on to the next location takes one
  click.
- **Row-selection panel** — tick/untick which pins show; the view re-fits as you
  do (until you pan or zoom, after which **Reset view** restores auto-fit). A tick
  box stays disabled until its location has a valid coordinate, and a location
  that gets its first one (or has a bad one fixed) shows straight away.
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
  (undoably). Only a change is written: tabbing through a field or pressing Escape
  leaves the table's text as it was typed in the form. The field shows the
  coordinate in the app's canonical format, which need not match that text. This
  is the keyboard counterpart to *Move pins*.
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
- **Getting the map into Word — tick *"Include site map in copied output"*.**
  That is the whole requirement. If you haven't captured a picture yourself, the
  app makes one: as soon as you tick the box, again when you close the Site Map,
  and — as the backstop — during the copy itself, so a map lands in the document
  whether or not you ever open the map window. The toolbar chip next to the tick
  box tracks it (*"Making the map picture…"* → *"✓ Map picture ready (made
  automatically 14:32)"*), and pictures nobody framed are labelled as such
  everywhere they are reported, because an unattended picture should never be
  mistaken for a checked one.

- **Choosing the framing — press 📸 Copy map image** (in the Site Map header).
  This is the *better* picture, not the required one. It takes a picture of the map
  area **exactly as it is on screen**, puts that picture on the clipboard (paste
  anywhere with Ctrl+V) *and* attaches it to **Copy table for Word**, ticking
  *"Include site map in copied output"* for you.

  What you have to do is deliberately short: **frame the map, let it finish
  drawing, press the button.** The panel then shows a **thumbnail of the exact
  picture** — so if a capture ever comes out blank you see it there, in the
  modal, with the map still on screen beside it, instead of discovering it after
  pasting into a scope document. A capture that didn't render is refused outright
  and says what to wait for; nothing blank is ever put on the clipboard. A picture
  you made by hand is never replaced by an automatic one.

  Pan, zoom, retick a pin or change the contours and the picture no longer matches
  the map, so it is dropped — the panel says *"the map has changed since you
  captured it"*, and a replacement is made for you in the background (once the map
  window is shut; while it is open you are still framing it, so nothing is
  captured behind your back). The toolbar chip always answers the one question
  that matters before you copy: **is a map picture ready, and is it the one I
  framed or one the app made?**

  If an automatic picture can't be made at all — the live map came back blank and
  a fresh off-screen rebuild failed too — the chip says so in as many words and
  points you at the Site Map. That is the only state that asks anything of you.
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
> the document is one that was checked on screen; `made automatically` means
> nobody has looked at it and the capture button hasn't been used.
>
> **Why the tick box is now enough (§7.6).** The capture button fixed *blank*, but
> it made the map *conditional on finding a button inside a modal*: tick the box,
> press Copy, and the answer was "map not included — open the Site Map and
> press 📸". A user who ticks "Include site map in copied output" has already said
> what they want. So the tick box arms the picture on its own — on the tick, on
> closing the Site Map, and during the copy — and 📸 became what it should always
> have been: the way to *choose the framing* and see the result first. The
> automatic path is bounded and single-flighted (a Copy pressed while a warm-up is
> still running joins that capture rather than starting a competing second one on
> the same view), it falls back to a fresh off-screen view when the live one comes
> back blank, and it never touches a picture the user made by hand.

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
>   GitHub, the Esri CDN and every QLD host are blocked.
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
> - `tests/map-location-entry.test.mjs` — every location in the side panel,
>   entered or not: each table lists only its own locations (no river line on
>   Rainfall), and a first entry typed on the map lands in the form, preview,
>   progress and Property Services, shows its pin and frames it. Also covers focus
>   moving to the next location in one click, and a panel rebuild never committing
>   (or losing) text still being typed. Hermetic (stand-in view, no network).
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
