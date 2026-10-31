#!/usr/bin/env node
// Checks v2/definitions.json with the same check the page runs before it uses
// a definitions file (v2/js/schema.js), so a bad edit is caught before it is
// pushed, not after everyone's page refuses it.
//
//   node v2/tools/check-definitions.mjs [path/to/definitions.json]
//
// Exit 0 = no errors (warnings are printed but allowed).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || join(here, '..', 'definitions.json');
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(here, '..', 'js', 'schema.js'), 'utf8'), ctx);

let defs;
try { defs = JSON.parse(readFileSync(file, 'utf8')); }
catch (e) { console.error(`✗ ${file}: not valid JSON — ${e.message}`); process.exit(1); }
const { errors, warnings } = ctx.SoRT.schema.check(defs);
warnings.forEach(w => console.warn(`⚠ ${w}`));
errors.forEach(e => console.error(`✗ ${e}`));
const nq = Object.keys(defs.questions || {}).length, nt = (defs.templates || []).length;
if (errors.length) { console.error(`✗ ${errors.length} error(s) in ${file}`); process.exit(1); }
console.log(`✓ ${file}: version ${defs.version}, ${nq} questions, ${nt} templates, ${(defs.followUps || []).length} follow-up rules${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
