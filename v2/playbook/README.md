# The playbook — tools

The playbook is the record of how SoRT forums dealt with each station, so a
station that comes back — or one like it — starts from what was decided before.
**Its data lives in the private repo `cdomotor-g/SoRT-playbook`, never here**
(this repo is public; `.gitignore` refuses station files, the index and Word
reports). This folder holds only the tools that read and write it.

## What the playbook repo holds

```
index.json               one entry per station — what the page searches and ranks
stations/<key>.json      that station's sessions, oldest first
```

`<key>` is the Bureau station number (else Flood-Net's id, else
`manual-<name>`). A station file:

```jsonc
{
  "schema": "sort-playbook-station/1",
  "key": "540601",
  "station": { "number": "540601", "name": "Fifteen Mile AL", "floodnetId": "fifteen_mile_al",
               "lat": -27.3986, "lon": 152.0731, "kinds": ["rain"], "lga": "…", "hub": "Brisbane Hub", "owner": "Bureau" },
  "sessions": [
    { "id": "…uuid…", "source": "sort-v2" | "report:<file>.docx",
      "savedAt": "…", "savedBy": "<GitHub login>" | "import",
      "forum": { "date": "2026-10-07", "attendees": ["HS", "DW"], "outOfSession": false },
      "outcome": "complete" | "more_data" | "site_visit" | "revisit" | "deferred" | null,
      "outcomeNote": "…", "template": "rainfall", "definitionsVersion": 3,
      "summary": {                       // flat: what precedents and exports read
        "answers": { "<question code>": { "value": "<option code>" | ["…"], "labels": ["…"],
                                          "other": "", "fields": { "<field code>": "text" }, "note": "", "src": "user" } },
        "ps": { "<row or row.coord>": "value" }, "psComments": {}, "psGeneral": "",
        "followUps": [ { "id": "alertIds", "owner": "Hub", "text": "…", "done": false } ],
        "map": { "checked": {…}, "features": [], "marks": [], "bridges": [] } },
      "session": { … }                   // the page's own session (absent for imported reports)
    }
  ],
  "tags": [], "notes": ""
}
```

Every answer is stored as **codes** from `v2/definitions.json` (with the label
alongside), so wording can change without breaking old sessions, and the whole
playbook flattens into tables for a later Dataverse import.

## Rules

- **No landholder names or contact details, and no gate, padlock or key codes** —
  anywhere: not in notes, not in imported text, not in commit messages. The page
  checks typed text before saving; the importer never reads the reports'
  Landowner Feedback sections, replaces quoted correspondence with a marker, and
  strips anything shaped like a phone number, an email address or a code.
  Summarise a landowner's position in plain words instead.
- The page writes sessions itself (**Save to playbook**). Edit files by hand only
  to fix something, and rebuild the index afterwards.

## Tools

```bash
# Import Word assessment reports (the pasted SoRT and Property Services tables,
# and each forum sitting's date, attendees and notes); asks Flood-Net for the
# station's particulars. Review every file before committing it.
SSL_CERT_FILE=/path/to/ca.crt python3 -I import_reports.py --defs ../definitions.json --out <playbook>/stations report1.docx report2.docx

# Rebuild index.json from the station files.
node build_index.mjs <playbook>

# Flat tables for Dataverse: stations, sessions, answers, answer_fields,
# property_services, follow_ups, map_features, survey_marks, data_dictionary.
node export_tables.mjs <playbook> ../definitions.json <playbook>/export
```

Re-importing a report replaces that report's earlier import and keeps the
sessions saved from the page.
