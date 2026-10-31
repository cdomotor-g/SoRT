# Instructions for Claude Code

## Atlas — this repo on the map of all the repos
- The owner keeps one map of every repository, how they depend on each other and where each is up to: **https://cdomotor-g.github.io/atlas/** (source: `cdomotor-g/atlas`). This repo is **`sort`** there and describes itself in **`atlas.json`** at its root (format: the Atlas's `schema/atlas.schema.json`; every field is explained there). The file is public: nothing private goes in it.
- **When you start**, look at this repo's panel on the Atlas, or `atlas.json`: what it takes from other repos (`consumes`), which repos rely on it (*Gives to* in the panel), anything *behind upstream*, and anything waiting on the owner.
- **Forward — you change something another repo relies on** (a path under one of this repo's `provides`, or one another repo's `consumes` entry watches; the Atlas's *Links* view lists them): in the same piece of work, tell each consumer. If that repo is attached to your session, make the matching change there too; otherwise open an issue in it titled `[Standalone] [<Model>/<Effort>] Upstream: <what changed> in <this repo>`, with the commit, what changed and what the consumer has to do. A breaking change always gets one. The consumer's own daily Atlas check flags the drift as well, but only your issue says why.
- **Back — this repo needs another to change**: open an issue there (attach the repo with `add_repo` if your session doesn't have it) and list it under `asks` in `atlas.json` with the issue reference. If you can't file it, list the ask without one so it shows on the map.
- **Catching up**: when you refresh something this repo copies or follows from another (a vendored copy, a generated table, a build, a citation), move that `consumes` entry's pin in the same commit — the file its `since` points at, or its `since` date. A drift issue the Atlas opened closes itself on the next check.
- **When you finish**: if where this repo is up to has changed — what's being done now, what's next, what's blocked (on the owner: `"on": "human"`) — update `status` in `atlas.json`, with today's date in `updated`. Add a `components` / `provides` / `consumes` entry when you add a part another repo uses, or start using another repo's. `.github/workflows/atlas.yml` checks the file on every push that changes it and once a day.

## Run summary — mark where it starts
- When you finish a piece of work and write your closing report (what you did, what's left, what I need to do), start it with this marker so I can find it by scrolling — a horizontal rule, then a top-level heading with the run number:

  ```
  ---
  # 🏁 THIS RUN SUMMARY (Run 3)
  ```

- The run number counts the summaries in this chat: the first one is Run 1, and each later one is one more than the last marker already in the conversation. A new chat starts again at Run 1.
- Everything above the marker is working notes; everything below it is the report. Use the marker once per reply, only at the start of that closing report, and put nothing after the report but the report.
- Under it, use these bold labels in this order, leaving out any that would be empty: **What changed**, **Checks run**, **What you need to do**, **Open questions**.
- Short replies that are only an answer (no work done) don't need the marker and don't use up a run number.

## Working on v2 (`v2/`)
- v1 (root `index.html`, `definitions.json`) stays untouched until the cutover; v2 lives in `v2/` and is served at `/SoRT/v2/`. Push straight to `main`, as always.
- A question change asked for in chat: edit `v2/definitions.json` (codes are permanent — reword labels freely, never reuse or rename a code), run `node v2/tools/check-definitions.mjs`, push. While v1 is still in use, make the same change in v1's `definitions.json` too, unless told otherwise.
- Any change to a file under `v2/` bumps the `?v=` stamp on every script and the stylesheet in `v2/index.html` (today's date + a letter, the next letter if today's is already there).
- Before pushing a change to `v2/js/*`, run the end-to-end checks: `python3 -m http.server 8642 --bind 127.0.0.1 &` from the repo root, then `node v2/tests/e2e.cjs` (all scenarios, or name the ones you touched).
- The playbook's data lives only in the private repo `cdomotor-g/SoRT-playbook`, never in this public one. It holds no landholder names or contact details and no gate, padlock or key codes. Import Word reports with `v2/playbook/import_reports.py` and review every file before committing it there.
