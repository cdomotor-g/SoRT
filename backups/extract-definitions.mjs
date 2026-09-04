#!/usr/bin/env node
/* =========================================================================
   extract-definitions.mjs — rebuild definitions.json from a Supabase dump
   -------------------------------------------------------------------------
   The central store (see README → "Central store (Supabase)") is one row in
   public.definitions; every publish archives the previous doc into
   public.definitions_history. When the Supabase project is unavailable —
   paused, migrated, or gone — a downloaded cluster dump is the only copy of
   that data, and the app's offline fallback (the bundled definitions.json)
   is how it gets back in front of users.

   This script reads a pg_dumpall cluster dump (.sql or .sql.gz / .backup.gz),
   pulls the master row's `doc` out of the COPY block, and writes it in the
   same shape the app's Export writes: JSON.stringify(doc, null, 2) + "\n",
   keys ordered as in definitions.json.

   Usage
     node backups/extract-definitions.mjs <dump.backup.gz> [options]

   Options
     --out <file>      where to write the master doc  (default: definitions.json
                       in the repo root)
     --history <dir>   also write every archived version as
                       <dir>/definitions-v<NN>.json  (default: not written)
     --list            print the versions found and write nothing
   ========================================================================= */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/* Key order of the checked-in definitions.json, so a re-extraction produces a
   readable diff against the previous one rather than a whole-file rewrite. */
const KEY_ORDER = ["version", "meta", "optionSets", "propertyServices", "sharedRows", "tables"];

function usage(msg){
  if(msg) console.error("error: " + msg + "\n");
  console.error("usage: node backups/extract-definitions.mjs <dump.backup.gz> [--out FILE] [--history DIR] [--list]");
  process.exit(msg ? 1 : 0);
}

/* ---- argv ---------------------------------------------------------------- */
const argv = process.argv.slice(2);
if(!argv.length || argv.includes("-h") || argv.includes("--help")) usage();
let dumpPath = null, outPath = resolve(REPO_ROOT, "definitions.json"), historyDir = null, listOnly = false;
for(let i = 0; i < argv.length; i++){
  const a = argv[i];
  if(a === "--out")          outPath    = resolve(argv[++i] ?? usage("--out needs a path"));
  else if(a === "--history") historyDir = resolve(argv[++i] ?? usage("--history needs a directory"));
  else if(a === "--list")    listOnly   = true;
  else if(a.startsWith("-")) usage("unknown option " + a);
  else if(dumpPath)          usage("only one dump file at a time");
  else                       dumpPath   = resolve(a);
}
if(!dumpPath) usage("no dump file given");

/* ---- read the dump (gzipped or not) -------------------------------------- */
const raw = readFileSync(dumpPath);
const isGzip = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b;
const sql = (isGzip ? gunzipSync(raw) : raw).toString("utf8");

/* ---- COPY ... FROM stdin blocks are tab-separated with backslash escapes --
   pg_dump's text format: \n \t \r \\ \b \f \v, plus \N for NULL. Anything
   else after a backslash is that literal character. */
const UNESCAPE = { n:"\n", t:"\t", r:"\r", "\\":"\\", b:"\b", f:"\f", v:"\v" };
function unescapeCopy(s){
  let out = "";
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(c === "\\" && i + 1 < s.length){ const n = s[++i]; out += (n in UNESCAPE) ? UNESCAPE[n] : n; }
    else out += c;
  }
  return out;
}
/* Rows of one COPY block, each already split into unescaped columns. */
function copyRows(table){
  const lines = sql.split("\n");
  const start = lines.findIndex(l => l.startsWith("COPY " + table + " ("));
  if(start === -1) return null;                       // table absent from this dump
  const rows = [];
  for(let i = start + 1; i < lines.length && lines[i] !== "\\."; i++){
    rows.push(lines[i].split("\t").map(c => c === "\\N" ? null : unescapeCopy(c)));
  }
  return rows;
}

/* ---- master row ---------------------------------------------------------- */
const master = copyRows("public.definitions");
if(!master)        { console.error("error: no public.definitions COPY block in " + dumpPath); process.exit(1); }
if(!master.length) { console.error("error: public.definitions is empty in " + dumpPath);      process.exit(1); }
if(master.length > 1) console.warn("warning: " + master.length + " rows in public.definitions — using id=" + master[0][0]);

const [id, docText, storeVersion, updatedAt] = master[0];
const doc = JSON.parse(docText);
if(!Array.isArray(doc.tables)) { console.error("error: master row's doc has no tables[] — not a definitions document"); process.exit(1); }

/* Reorder to the checked-in key order; anything unrecognised keeps its place
   at the end rather than being dropped. */
function ordered(d){
  const out = {};
  for(const k of KEY_ORDER) if(k in d) out[k] = d[k];
  for(const k of Object.keys(d)) if(!(k in out)) out[k] = d[k];
  return out;
}
const write = (file, d) => writeFileSync(file, JSON.stringify(ordered(d), null, 2) + "\n", "utf8");

const history = copyRows("public.definitions_history") ?? [];

if(listOnly){
  console.log("master   row id=" + id + "  store version " + storeVersion + "  updated " + updatedAt +
              "  (meta.updated " + (doc.meta?.updated ?? "—") + ", " + doc.tables.length + " tables)");
  for(const [historyId, , , version, archivedAt] of history){
    console.log("history  #" + historyId + "  store version " + version + "  archived " + archivedAt);
  }
  process.exit(0);
}

write(outPath, doc);
console.log("wrote " + outPath + "  (store version " + storeVersion + ", published " + updatedAt + ", " +
            doc.tables.length + " tables, " + (doc.sharedRows?.length ?? 0) + " common rows)");

if(historyDir){
  mkdirSync(historyDir, { recursive: true });
  for(const [, , histDoc, version] of history){
    if(!histDoc) continue;
    write(resolve(historyDir, "definitions-v" + String(version).padStart(2, "0") + ".json"), JSON.parse(histDoc));
  }
  console.log("wrote " + history.length + " archived versions to " + historyDir);
}
