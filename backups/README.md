# Backups

> **Historical.** The Supabase store is retired: the app now keeps
> `definitions.json` in this GitHub repo and publishes to it directly, so the
> file's commit history is the backup and nothing here is needed to run the app.
> These files are the last dump of the old store, kept for the record — the
> extract script still turns it back into a `definitions.json` (and every
> archived version) if that is ever wanted.

Point-in-time copies of the (retired) Supabase central store, plus the script
that turns one back into the app's offline fallback.

| File | What it is |
| --- | --- |
| `2026-09-03-db_cluster.backup.gz` | Gzipped `pg_dumpall` cluster dump taken 3 Sep 2026, downloaded from the Supabase dashboard. |
| `extract-definitions.mjs` | Rebuilds `definitions.json` (and, optionally, every archived version) from such a dump. |

## Why this is here

The central store lived in one Supabase row (see the main README →
[The retired Supabase store](../README.md#the-retired-supabase-store)). If that
project was paused, deleted, or otherwise unreachable, boot fell through to the
bundled `definitions.json` — so keeping a dump next to the repo, and keeping
`definitions.json` extracted from the newest one, is what stops a dead project
from taking the definitions with it.

The `2026-09-03` dump was taken after the project paused and would not resume.
The `definitions.json` checked in at the repo root is the master row from that
dump verbatim: **store version 95, published 2026-08-21** (4 tables, 17 common
rows, 9 Property Services rows). Every user who opens the page while the store
is down now gets that document instead of a months-old seed copy.

## Restoring the offline fallback from a dump

```bash
node backups/extract-definitions.mjs backups/2026-09-03-db_cluster.backup.gz
```

That overwrites `definitions.json` at the repo root, formatted exactly as the
app's **Export** writes it (`JSON.stringify(doc, null, 2)`, same key order), so
`git diff` shows the definition changes rather than a reformat. Commit it and
the fallback is live for everyone.

Other options:

```bash
# see what a dump holds before writing anything
node backups/extract-definitions.mjs <dump> --list

# write somewhere else
node backups/extract-definitions.mjs <dump> --out /tmp/defs.json

# also unpack every archived version from definitions_history
node backups/extract-definitions.mjs <dump> --history /tmp/history
#   -> /tmp/history/definitions-v01.json … definitions-v94.json
```

`--history` is the rollback path while the store is down: pick the version you
want and pass it to `--out` (or Import it in the app) instead of hand-editing
the master row. The 2026-09-03 dump carries versions 1–94 alongside the live 95.

## Restoring the store itself

The dump is a full cluster dump, so it also recreates the table, its RLS
policies, and the `definitions_history` trigger:

```bash
gunzip -c backups/2026-09-03-db_cluster.backup.gz | psql "<connection string>"
```

On a brand-new Supabase project, prefer the SQL in the main README to create the
table and policies, then load just the data — a cluster dump also carries roles
and `auth`/`storage` schema objects the new project already owns.

## Adding a new dump

1. Supabase dashboard → Database → Backups → download.
2. Drop it in here as `YYYY-MM-DD-db_cluster.backup.gz`.
3. Run the extract command above and commit both files together.

Dumps are only worth committing while they stay small (this one is 64 KB, and
its data is the definitions plus their history — no user accounts, no secrets).
If they ever grow, keep the extracted `definitions.json` and store the dump
elsewhere.
