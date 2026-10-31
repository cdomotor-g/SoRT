# Instructions for Claude Code

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
