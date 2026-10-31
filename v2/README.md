# SoRT Scope Builder — v2 (beta)

The rebuild of the SoRT Forum scope table builder, running beside v1 until it
has been through some forums:

| | Address |
| --- | --- |
| v1 (unchanged) | https://cdomotor-g.github.io/SoRT/ |
| v2 beta | https://cdomotor-g.github.io/SoRT/v2/ |

At cutover one small commit makes the v1 address open v2, and keeps v1 at
`/SoRT/v1/`; reverting that commit is the rollback.

## What is different from v1

- **One page, top to bottom:** forum details → station (looked up in Flood-Net)
  → map → the questions, section by section → Property Services → follow-ups,
  preview and Copy for Word. No pop-up windows.
- **Answers are saved in the browser as you go** (v1 kept none), so a reload or
  a crashed tab loses nothing. *Sessions* lists them.
- **Flood-Net fills in what it knows**: name, number, ALERT IDs, the frequency
  (inferred from the repeaters that pass the station's ALERT IDs), current
  comms, repeater radio details, ACMA licences, and fade-margin hints. Anything
  filled in for you is marked (Flood-Net / Map / Precedent / Auto) until you
  confirm or change it.
- **Rules and follow-ups**: e.g. a comms change to ERRTS raises "Hub rep to
  supply new ALERT IDs"; an ACMA licence transfer, vegetation management, an
  access track and a bridge attachment each raise their own follow-up, and the
  open ones go into the Word copy.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.css` | The page and its styles. |
| `js/util.js` | Helpers, and the coordinate parser (v1's, unchanged). |
| `js/schema.js` | The definitions check, and turning a template into its questions. |
| `js/rules.js` | Effective answers, conditions, auto answers, follow-ups, Property Services values. |
| `js/store.js` | Sessions saved in this browser (`sortv2.*` keys). |
| `js/floodnet.js` | Flood-Net's read-only API: search, station facts, prefill, hints. |
| `js/form.js` | The question cards and the Property Services block. |
| `js/word.js` | The tables copied into Word (v1's geometry). |
| `js/app.js` | Boot and wiring. |
| `definitions.json` | The questions. See below. |
| `tools/check-definitions.mjs` | `node v2/tools/check-definitions.mjs` — the same check the page runs. |
| `tools/convert-v1.mjs` | One-off that seeded `definitions.json` from v1's. Not to be re-run. |

## The definitions (`definitions.json`)

- `questions` — the question bank, each question once, keyed by a **permanent
  code**. Every option has a permanent `code` too. Answers are stored under
  codes, so a label can be reworded freely; a code is never reused for
  something else (it is what a later Dataverse import keys on).
- `templates` — the four station types (Rainfall, Water Level, Co-located
  (DLGWV), Repeater / Gateway): an ordered list of question codes, or
  `{ "q": code, …overrides }` where one table words a question differently.
  The order is the order on the page and in Word.
- Conditions (`showIf`, `notes[].when`, `defaultWhen[].when`,
  `followUps[].when`): `{q, is}`, `{q, isNot}`, `{q, in:[…]}`, `{q, has}`,
  `{q, tag}`, `{q, filled, field?}`, `{ps, is}`, `{template}`, `{station}`,
  `{all:[…]}`, `{any:[…]}`, `{not:…}`.
- `followUps` — `{ id, owner, table: "scope"|"ps"|"none", when, text, link?, doneWhen? }`.
  Text may use `{hub}`, `{lga}`, `{owner}`, `{station}`, `{f:question.field|fallback}`.
- `propertyServices` — v1's block, with a cultural heritage question and the
  bridge question added.

The page loads the definitions from GitHub (the API, then the CDN copy), then
the copy deployed with the page; a file that fails the check is skipped with a
banner, so a bad edit cannot stop a forum. Run the check before pushing an
edit:

```bash
node v2/tools/check-definitions.mjs
```

## Version stamp

Every script and the stylesheet in `index.html` carry `?v=<date><letter>`.
Bump them all at once with any change to a file under `v2/` (GitHub Pages lets
browsers keep a copy for up to 10 minutes):

```bash
sed -i 's/v=20261031a/v=20261031b/g' v2/index.html
```
