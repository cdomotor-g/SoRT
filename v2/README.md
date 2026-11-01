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
  comms, repeater radio details, ACMA licences (Flood-Net's `/acma` route:
  what it records, what the ACMA register has at the site, the repeaters that
  relay it) and the radio path to base (the dossier's `radio_path`: each hop's
  saved fade margin, flagged when stale, and the attenuator tests measured on
  site — shown under Fade Margin; it fills Fade Margin in only from fresh
  figures). Anything filled in for you is marked
  (Flood-Net / Map / Precedent / Earlier session / Auto) until you confirm or
  change it.
- **The map is on the page**: v1's imagery, contours, road reserve and rail; the
  station's locations as pins you can type, place or drag; a *Position checked*
  step against Flood-Net's often-rounded position; a vegetation clearance
  circle, trees and an access track drawn for the scope; the nearest 5 survey
  marks within 2 km (S1–S5, linked to their reports, tabled under the map in
  Word); bridges within 1 km and who manages them. The picture in Word is the
  map you are looking at.
- **Rules and follow-ups**: e.g. a comms change to ERRTS raises "Hub rep to
  supply new ALERT IDs"; an ACMA licence transfer, vegetation management, an
  access track and a bridge attachment each raise their own follow-up, and the
  open ones go into the Word copy.
- **The playbook** (private repo `cdomotor-g/SoRT-playbook`): every session can
  be saved under its station; a station that comes back offers *Continue from
  it*, and similar stations offer their answers as precedents. See
  [`playbook/README.md`](playbook/README.md).
- **Edit questions** (footer): quick changes mid-forum, as a draft in your
  browser until *Publish to GitHub* commits `v2/definitions.json`.
- **Tasks for Flood-Net**: any follow-up can go to Flood-Net as a task for a
  team (the definitions suggest one: `followUps[].team` is `{"hub": true}` —
  the station's hub team — or `{"name": "…"}`), and the forum can add its own.
  *Create these tasks in Flood-Net* opens Flood-Net with them filled in
  (`https://floodwarning.net/#tasks=<base64url JSON>`, see `js/tasks.js`); a
  person who may hand out tasks checks them and presses Create there. Flood-Net
  keeps them, private to the teams and people allowed to see them.

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
| `js/map.js` | The map: layers, pins, location check, drawings, survey marks, bridges, the picture, the zoom lock (on when the page opens), and going back to all of Queensland on a new session. |
| `js/github.js` | The GitHub token (shared with v1) and the contents API. |
| `js/playbook.js` | Save to / continue from / precedents in the playbook. |
| `js/editor.js` | Edit questions, and publishing them. |
| `js/tasks.js` | Follow-ups, and the tasks handed to Flood-Net. |
| `js/help.js` | The ❔ Help guide (top right). Its text is one list in the file — keep it in step when a control is renamed or moved. |
| `js/app.js` | Boot and wiring. |
| `playbook/` | The playbook's tools (importer, index builder, Dataverse export). No data. |
| `tests/e2e.cjs` | End-to-end checks in headless Chromium (see its header). |
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
- `"precedent": false` on a question or field keeps it from being copied from
  one station to another (coordinates are never copied anyway).

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

## Checks

```bash
node v2/tools/check-definitions.mjs                       # the definitions, as the page checks them
python3 -m http.server 8642 --bind 127.0.0.1 &            # from the repo root
node v2/tests/e2e.cjs                                     # station, copy, playbook, editor, map
```

## Cutover (when the beta has done enough forums)

One commit: copy v1's `index.html` to `v1/index.html` (fixing its bundled
`definitions.json` fallback path) and replace the root `index.html` with a
forward to `v2/` that keeps any `?query` and `#hash`. v1's GitHub definitions
path (`definitions.json` at the root) does not move. Rolling back is reverting
that commit.
