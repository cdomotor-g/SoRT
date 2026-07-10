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
          ]
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
