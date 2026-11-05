# Instructions for Claude Code

## Atlas — this repo on the map of all the repos
- This repo is **`sort`** on the Atlas (<https://cdomotor-g.github.io/atlas/>). How to work with the map — `atlas.json`, the repositories that rely on this one, asks, pins, status and blockers — is in the shared instructions (`shared/on-the-atlas.md` in the Atlas).

<!-- shared:start · written by tools/shared.mjs in cdomotor-g/atlas; the rules themselves live in its shared/ folder -->
## Shared instructions — loaded from the Atlas
The rules every one of my repositories shares live in one file in the Atlas: how to end a run (the run summary), pushing to `main`, plain words, private data, who clears what, and issue titles — <https://github.com/cdomotor-g/atlas/blob/main/shared/instructions.md>. This repository is on the Atlas map, so <https://github.com/cdomotor-g/atlas/blob/main/shared/on-the-atlas.md> holds as well.
`.claude/settings.json` loads them when a session starts. If they are not in front of you, fetch them before you reply (`curl -fsS https://raw.githubusercontent.com/cdomotor-g/atlas/main/shared/instructions.md`, and the same for `on-the-atlas.md`) and follow them. Where this file says something different, this file wins.
<!-- shared:end -->

## Working on v2 (`v2/`)
- Since the cutover (4 Nov 2026) the root `index.html` only forwards to v2 (`v2/`, served at `/SoRT/v2/`); v1 is kept as it was in `v1/index.html` (`/SoRT/v1/`) and still reads the root `definitions.json`. Rolling back is reverting the cutover commit. Push straight to `main`, as always.
- A question change asked for in chat: edit `v2/definitions.json` (codes are permanent — reword labels freely, never reuse or rename a code), run `node v2/tools/check-definitions.mjs`, push. While v1 is still in use, make the same change in v1's `definitions.json` too, unless told otherwise.
- Any change to a file under `v2/` bumps the `?v=` stamp on every script and the stylesheet in `v2/index.html` (today's date + a letter, the next letter if today's is already there).
- Before pushing a change to `v2/js/*`, run the end-to-end checks: `python3 -m http.server 8642 --bind 127.0.0.1 &` from the repo root, then `node v2/tests/e2e.cjs` (all scenarios, or name the ones you touched).
- The playbook's data lives only in the private repo `cdomotor-g/SoRT-playbook`, never in this public one. It holds no landholder names or contact details and no gate, padlock or key codes. Import Word reports with `v2/playbook/import_reports.py` and review every file before committing it there.
