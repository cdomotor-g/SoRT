#!/usr/bin/env node
// Rebuilds the playbook's index.json from its station files — after importing
// reports, or to repair the index. (The app keeps the index current itself when
// it saves a session; this is the same entry, v2/js/playbook.js indexEntry().)
//
//   node build_index.mjs <playbook folder>        e.g. node build_index.mjs ../../../SoRT-playbook
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || '.';
const files = readdirSync(join(root, 'stations')).filter(f => f.endsWith('.json'));
const entry = file => {
  const st = file.station || {}, ss = file.sessions || [];
  const last = ss[ss.length - 1] || {}, sum = last.summary || { answers: {} }, A = sum.answers || {};
  const v = c => (A[c] ? A[c].value : null);
  return { key: file.key, number: st.number || '', name: st.name || '', floodnetId: st.floodnetId || '', lat: st.lat, lon: st.lon,
    lga: st.lga || '', hub: st.hub || '', kinds: st.kinds || [], template: last.template || '', sessions: ss.length,
    lastForum: (last.forum || {}).date || '', lastOutcome: last.outcome || null,
    complexity: [].concat(v('complexity') || []), comms: v('comms'), commsChange: v('commsChange'), relocation: v('relocation'),
    remediation: [].concat(v('remediation') || []), tags: file.tags || [],
    openFollowUps: (sum.followUps || []).filter(f => !f.done).map(f => ({ id: f.id, owner: f.owner, text: f.text })),
    updatedAt: new Date().toISOString() };
};
const stations = files.map(f => entry(JSON.parse(readFileSync(join(root, 'stations', f), 'utf8')))).sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(root, 'index.json'), JSON.stringify({ schema: 'sort-playbook-index/1', updated: new Date().toISOString(), stations }, null, 2) + '\n');
console.log(`index.json: ${stations.length} station(s)`);
