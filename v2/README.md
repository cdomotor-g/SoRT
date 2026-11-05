# SoRT Scope Builder — v2 (beta)

The rebuild of the SoRT Forum scope table builder, running beside v1 until it
has been through some forums:

| | Address |
| --- | --- |
| v1 (unchanged) | https://cdomotor-g.github.io/SoRT/ |
| v2 beta | https://cdomotor-g.github.io/SoRT/v2/ |

Since the cutover (4 Nov 2026) `/SoRT/` opens v2 and v1 is kept as it was at
`/SoRT/v1/`; reverting the cutover commit is the rollback.

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
- **Corrections to a station's particulars** (name, number, hub, council, owner —
  e.g. a name Radio Mobile's export cut short): *Edit details* on the station
  card. The Word tables use them and Flood-Net is not changed; the card lists what
  Flood-Net still has, and *Report to Flood-Net* files an issue in its tracker
  (through Flood-Net's `/api/report` when that is switched on, or GitHub's
  ready-made *New issue* page until then). Refresh from Flood-Net keeps them,
  and drops any Flood-Net has since been corrected in.
- **Two kinds of benchmark, kept apart.** *State survey marks* (Queensland's,
  from QSpatial, public) are found by the map — S1–S5, their own Word table.
  *Bureau benchmarks (HDB)* are the station's own marks, which Flood-Net keeps
  for its editors only: on the Local TBM question, *Get them from Flood-Net*
  opens a Flood-Net tab where a signed-in editor presses *Send to SoRT*, and
  Flood-Net posts them back to this tab alone (`js/benchmarks.js`; the contract
  is Flood-Net's Atlas `benchmarks-for-sort`; *Paste from Flood-Net* if the tab
  link is lost). *Use* fills the Local TBM (AHD, or the height on the gauge —
  LGH); they go into Word as their own table, B1, B2….
- **Side by side, each pane scrolls on its own**: the questions on the left,
  the map pane on the right, and neither starts the other at its end.
- **The map is on the page**: v1's imagery, contours, road reserve and rail; the
  station's locations as pins you can type, place or drag; a *Position checked*
  step against Flood-Net's often-rounded position; a vegetation clearance
  circle, trees and an access track drawn for the scope; the nearest 5 survey
  marks within 2 km (S1–S5, linked to their reports, tabled under the map in
  Word); bridges within 1 km and who manages them. The picture in Word is the
  map you are looking at.
- **Infrastructure options and corrosion (Water Level table)**: a *Corrosion
  category* — C3 and below (standard), C4 (stainless enclosure and orifice
  run), C5 and CX (all stainless) or Custom — sets the three stainless-steel
  tick boxes; changing a tick makes it Custom (or the category those ticks
  are). OTE's grouping of AS 4312:2019's grades, by distance from the shore
  and the kind of shore (surf, semi-sheltered, quiet, tropical); see
  [Corrosion: AS 4312 and OTE's instruction](#corrosion-as-4312-and-otes-instruction).
  The card has a brief summary and *📖 More about corrosion*, a guide with the
  distances table and this site's column. Once the site's position is known,
  `js/coast.js` measures its distance to the sea on QSpatial's Queensland
  coastline (live; river mouths are closed off by the layer's Coastline
  Junction lines) and to the surf beaches in `data/surf-coast.json`, and fills
  in the category as a Map suggestion — never over a person's answer; it
  follows a relocation's new location; *🗺 Map of these distances* opens the
  guide, which starts with a map of its own (the site, the coastline measured
  to, a line to each nearest shore; never in the Word picture). A rounded
  position is warned about only when it could change the category. Word gets
  the category as a bold line and every part as a bullet under it (unticked
  ones as the standard part), each a sentence.
- **Rules and follow-ups**: e.g. a comms change to ERRTS raises "Hub rep to
  supply new ALERT IDs"; an ACMA licence transfer, vegetation management, an
  access track and a bridge attachment each raise their own follow-up, and the
  open ones go into the Word copy.
- **Shared sessions (the playbook)**: kept by Flood-Net's server
  (`floodwarning.net/api/sort/v1`, Flood-Net's `docs/sort-store.md`) for whoever
  has the **forum passphrase**, typed once per computer — no accounts, no tokens.
  With it, every session with a station and an answer is shared by itself a few
  seconds after a change (`js/store-remote.js`, `js/playbook.js`); without it a
  *⚠ Saved only in this browser* bar says so. Text that looks like a phone
  number, an email or a gate code holds a session back until a person decides.
  Sessions → search; *Open* carries on with a shared session as saved, *Start
  from it* begins today's from its answers, *Use as a precedent* fills this one
  — each answer orange until checked, then green. A station picked again says it
  already has sessions. The private repo `cdomotor-g/SoRT-playbook` holds the
  five stations it was seeded with; see [`playbook/README.md`](playbook/README.md).
- **Edit questions** (footer): quick changes mid-forum, as a draft in your
  browser until *Publish to GitHub* commits `v2/definitions.json`.
- **Tasks for Flood-Net**: any follow-up can go to Flood-Net as a task for a
  team (the definitions suggest one: `followUps[].team` is `{"hub": true}` —
  the station's hub team — or `{"name": "…"}`), and the forum can add its own.
  *Create N tasks in Flood-Net* opens Flood-Net with them filled in
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
| `js/coast.js` | The Infrastructure options' distance to the sea, the corrosion category it suggests, and the corrosion guide (the pop-up). |
| `data/surf-coast.json` | Queensland's ocean-facing surf beaches (Point Danger to Agnes Water), made from QSpatial's coastline by `tools/build-surf-coast.mjs`. |
| `js/word.js` | The tables copied into Word (v1's geometry). |
| `js/map.js` | The map: layers, pins, location check, drawings, survey marks, bridges, the picture, the zoom lock (on when the page opens), and going back to all of Queensland on a new session. |
| `js/github.js` | The GitHub token (shared with v1) for publishing question changes, and the contents API. |
| `js/store-remote.js` | The shared sessions on Flood-Net's server, and the forum passphrase. |
| `js/playbook.js` | Sharing sessions by themselves, Sessions' shared list, continue from / precedents. |
| `js/editor.js` | Edit questions, and publishing them. |
| `js/tasks.js` | Follow-ups, and the tasks handed to Flood-Net. |
| `js/benchmarks.js` | The Bureau's benchmarks from Flood-Net (editors only, handed back to this tab), for the Local TBM and their own Word table. |
| `js/help.js` | The ❔ Help guide (top right). Its text is one list in the file — keep it in step when a control is renamed or moved. |
| `js/app.js` | Boot and wiring. |
| `playbook/` | The playbook's tools (importer, index builder, Dataverse export). No data. |
| `tests/e2e.cjs` | End-to-end checks in headless Chromium (see its header). |
| `definitions.json` | The questions. See below. |
| `tools/check-definitions.mjs` | `node v2/tools/check-definitions.mjs` — the same check the page runs. |
| `tools/convert-v1.mjs` | One-off that seeded `definitions.json` from v1's. Not to be re-run. |
| `tools/build-surf-coast.mjs` | `node v2/tools/build-surf-coast.mjs` — remakes `data/surf-coast.json` (seven rays out to sea from each piece of coast; most reaching open water = surf). Only if QSpatial's coastline changes a lot. |

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
- `followUps` — `{ id, owner, table: "scope"|"ps"|"none", when, text, link?, doneWhen?, taskTitle?, team?, floodnet? }`.
  `"floodnet": false` makes it a **desktop task**: it goes into the Word table and
  is never offered to Flood-Net (the local TBM's `tbmDetails` is one).
  Text may use `{hub}`, `{lga}`, `{owner}`, `{station}`, `{f:question.field|fallback}`.
- `propertyServices` — v1's block, with a cultural heritage question and the
  bridge question added.
- `"precedent": false` on a question or field keeps it from being copied from
  one station to another (coordinates are never copied anyway).
- A field of type `"choice"` is a row of radios (`options: [{code, label}]`),
  stored as the code. `"presets": "<choice field>"` on a tick-box question
  makes its tick boxes follow that field: each choice's `ticks` (a list of the
  question's option codes, `[]` for none), and one choice with `"custom": true`
  for anything else. An option's `offText` is what Word says when it is not
  ticked (the standard part).
- `guides` — the pop-ups behind a card's brief summary, named by a question's
  `"guide"`. `guides.corrosion` holds the words and the distances:
  `shores[]` (the kinds of shore), `bands[]` (most severe first: a category and
  the distance `within` which each kind of shore reaches it, in metres) and
  `otherwise` (the category beyond them all). `"suggest": "coast"` on the
  question has `js/coast.js` measure the site and suggest from them.

The page loads the definitions from GitHub (the API, then the CDN copy), then
the copy deployed with the page; a file that fails the check is skipped with a
banner, so a bad edit cannot stop a forum. Run the check before pushing an
edit:

```bash
node v2/tools/check-definitions.mjs
```

## Corrosion: AS 4312 and OTE's instruction

The Water Level table's corrosion categories follow **OTE's instruction**
(November 2026), which groups AS 4312:2019's grades into three and sets the
distances. Where its distances differ from the standard's own table they are
**stricter, never less strict**; the tool follows OTE, and the guide pop-up
shows both (worked out from `guides.corrosion` in `definitions.json`, so it
stays true if either is edited).

OTE's instruction — the category at each distance from the shoreline:

| Shore (e.g.) | C5 and CX (all stainless) | C4 (stainless enclosure and orifice run) | C3 and below (standard) |
| --- | --- | --- | --- |
| Temperate quiet (Melbourne, Hobart) | — | under 100 m | over 100 m |
| Temperate semi-sheltered (Adelaide, Brisbane, Perth) | under 100 m | 100 m – 1 km | over 1 km |
| Tropical quiet (Cairns, Townsville, Mackay) | under 1 km | — | over 1 km |
| Surf (Sydney, Wollongong, Newcastle, Gold Coast) | under 1 km | 1 – 10 km | over 10 km |

AS 4312:2019 Table 4.1 (as reproduced in Timber Queensland Technical Data
Sheet 35, April 2020) — the grade at each distance:

| Shore | 0–50 m | 50–100 m | 100–500 m | 0.5–1 km | 1–10 km | 10–100 km |
| --- | --- | --- | --- | --- | --- | --- |
| Temperate quiet | C4 | C3 | C3 | C3 | C2 | C2 |
| Temperate semi-sheltered | C5 | C4 | C4 | C3 | C3\* | C2 |
| Tropical quiet | CX | CX | C5/C4 | C3 | C2 | C2 |
| Surf | CX | CX/C5 | C5 | C4 | C3 | C3\* |

\* Reduce to C2 where the site is more than 50 m above sea level and more
than 5 km from the shoreline.

Where OTE is stricter (6 of the 24 bands):

| Shore, distance | AS 4312 | OTE |
| --- | --- | --- |
| Temperate quiet, 50–100 m | C3 (C3 and below) | C4 |
| Temperate semi-sheltered, 50–100 m | C4 | C5 and CX |
| Temperate semi-sheltered, 0.5–1 km | C3 (C3 and below) | C4 |
| Tropical quiet, 0.5–1 km | C3 (C3 and below) | C5 and CX — two categories up |
| Surf, 0.5–1 km | C4 | C5 and CX |
| Surf, 1–10 km | C3 (C3 and below) | C4 — the one that matters most: much of the Gold Coast and Sunshine Coast hinterland |

Asked of OTE: is the surf 1–10 km band (C4, not the standard's C3) deliberate?

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

## Cutover (done 4 Nov 2026)

One commit moved v1's `index.html` to `v1/index.html` (its bundled
`definitions.json` fallback now reads `../definitions.json`) and replaced the root
`index.html` with a forward to `v2/` that keeps any `?query` and `#hash`. v1's
GitHub definitions path (`definitions.json` at the root) did not move, and v1's
saved work is still there (same origin, same `sort.*` keys). v2 links to v1 at
the top right and in the footer; v1 links back. Rolling back is reverting that
commit; `node v2/tests/e2e.cjs cutover` checks the forward and v1.
