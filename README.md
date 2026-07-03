# SoRT — Forum Scope Builder

A single-page tool for building SORT Forum remediation scope tables and copying
them straight into Word. It has two modes:

- **Scope Builder** — click through a table, fill in the rows, copy the result.
- **Manage Tables** — a CRUD editor for the table/row definitions themselves.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole application (no build step, no dependencies). |
| `definitions.json` | The table, row, and option definitions. **This is the file that evolves over time** — the app reads it at startup. |

The definitions used to be hard-coded inside `index.html`. They now live in
`definitions.json` so they can change without touching the app code, and so the
file can be hosted centrally (SharePoint or an on-prem file share).

## How definitions are loaded

At startup the app picks the first source that is available:

1. **Local edits** saved in your browser (from the Manage Tables editor).
2. A **URL** you previously loaded from (e.g. a SharePoint link), or one passed
   as `?defs=<url>` in the address bar.
3. The bundled **`definitions.json`** sitting next to `index.html`.
4. If none load, an empty state offers **Import** / **Load from URL** / start blank.

> Opening `index.html` directly from disk (`file://`) usually blocks step 3 for
> security reasons. Either host the two files on a web server / SharePoint, or
> use **Import JSON…** to load `definitions.json` manually.

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
- Add free-text **fields** and an amber **approval note**.

Options are entered one per line. A line starting with `### ` becomes a
non-selectable heading/divider.

### Publishing your changes

Edits are saved **in your browser only**. To share them with the team:

1. Make your changes in **Manage Tables**.
2. Click **Export JSON** — this downloads an updated `definitions.json`.
3. Upload that file to your shared location (SharePoint / on-prem), replacing the
   old `definitions.json`.

Everyone loading the app from that location then picks up the new definitions.
Use **Reset to published file** to discard your local edits and reload the shared
copy.

## Definition format

```jsonc
{
  "version": 1,
  "meta": { "appTitle": "…", "updated": "YYYY-MM-DD" },
  "optionSets": {
    "comms": ["Option one", "Option two"]        // reusable, referenced by rows
  },
  "tables": [
    {
      "id": "rainfall",                           // unique internal key
      "label": "Rainfall Table",                  // tab label
      "title": "Rainfall Table",                  // printed title in the copied table
      "rows": [
        {
          "id": "stationType",                    // unique within the table
          "item": "Station Type",                 // row name (left column)
          "instruction": "(Choose relevant option)",
          "type": "single",                       // "single" | "multi" | "none"
          "options": ["Rain Gauge"],              // inline list …
          // "optionSet": "comms",                // … OR reference a shared set
          "note": "Requires GM approval",         // optional amber note
          "fields": [                             // optional free-text inputs
            { "key": "detail", "label": "Detail", "type": "text" }  // or "textarea"
          ]
        }
      ]
    }
  ]
}
```
