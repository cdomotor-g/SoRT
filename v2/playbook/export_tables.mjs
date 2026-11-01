#!/usr/bin/env node
// Writes the playbook out as flat tables — one CSV per table, keyed by IDs —
// plus a data dictionary of every question, option and field code. This is the
// shape Microsoft Dataverse's import wizard and dataflows take, for the day the
// scope builder's data moves there. Nothing is lost: every answer is a code
// (with its label alongside), every row has a stable ID.
//
//   node export_tables.mjs <playbook folder> <v2/definitions.json> [out folder]
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [root = '.', defsPath, out = join(root, 'export')] = process.argv.slice(2);
if (!defsPath) { console.error('usage: node export_tables.mjs <playbook folder> <definitions.json> [out folder]'); process.exit(2); }
const defs = JSON.parse(readFileSync(defsPath, 'utf8'));
mkdirSync(out, { recursive: true });
const csv = (name, header, rows) => {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  writeFileSync(join(out, name), [header.join(','), ...rows.map(r => header.map(h => q(r[h])).join(','))].join('\r\n') + '\r\n');
  console.log(`${name}: ${rows.length} row(s)`);
};
const T = { stations: [], sessions: [], answers: [], fields: [], ps: [], followUps: [], tasks: [], features: [], marks: [] };
for (const f of readdirSync(join(root, 'stations')).filter(f => f.endsWith('.json'))) {
  const file = JSON.parse(readFileSync(join(root, 'stations', f), 'utf8')), st = file.station || {};
  T.stations.push({ stationKey: file.key, bureauNumber: st.number, name: st.name, floodnetId: st.floodnetId, latitude: st.lat, longitude: st.lon, lga: st.lga, hub: st.hub, owner: st.owner });
  for (const s of file.sessions || []) {
    const sum = s.summary || {};
    T.sessions.push({ sessionId: s.id, stationKey: file.key, source: s.source, forumDate: (s.forum || {}).date, attendees: ((s.forum || {}).attendees || []).join('; '),
      outOfSession: !!(s.forum || {}).outOfSession, outcome: s.outcome, outcomeNote: s.outcomeNote, template: s.template,
      definitionsVersion: s.definitionsVersion, savedAt: s.savedAt, savedBy: s.savedBy, continuesFrom: s.continuesFrom ? s.continuesFrom.sessionId : '' });
    for (const [code, a] of Object.entries(sum.answers || {})) {
      const vals = a.value == null ? [] : [].concat(a.value);
      (vals.length ? vals : [null]).forEach((v, i) => T.answers.push({ answerId: `${s.id}:${code}:${i}`, sessionId: s.id, questionCode: code, optionCode: v, optionLabel: (a.labels || [])[i] || '',
        other: i === 0 ? a.other : '', note: i === 0 ? a.note : '', source: a.src || '' }));
      for (const [fc, fv] of Object.entries(a.fields || {})) T.fields.push({ fieldId: `${s.id}:${code}.${fc}`, sessionId: s.id, questionCode: code, fieldCode: fc, value: fv });
    }
    for (const [k, v] of Object.entries(sum.ps || {})) T.ps.push({ psId: `${s.id}:${k}`, sessionId: s.id, rowKey: k, value: v });
    if (sum.psGeneral) T.ps.push({ psId: `${s.id}:general`, sessionId: s.id, rowKey: 'general', value: sum.psGeneral });
    for (const fu of sum.followUps || []) T.followUps.push({ followUpId: `${s.id}:${fu.id}`, sessionId: s.id, rule: fu.id, owner: fu.owner, text: fu.text, done: !!fu.done });
    // Tasks sent to Flood-Net from this session: Flood-Net files each as source_ref "sort:<session>:<ref>".
    for (const t of sum.tasks || []) T.tasks.push({ taskRef: `sort:${s.id}:${t.ref}`, sessionId: s.id, ref: t.ref, title: t.title || '', detail: t.detail || '',
      team: t.team ? (t.team.hub ? `hub:${t.team.hub}` : t.team.name) : '', due: t.due || '', sentAt: t.sentAt ? new Date(t.sentAt).toISOString() : '' });
    const map = sum.map || {};
    for (const ft of map.features || []) T.features.push({ featureId: ft.id, sessionId: s.id, kind: ft.kind, questionCode: ft.q, ref: ft.ref || '', latitude: ft.lat, longitude: ft.lon,
      lengthM: ft.lengthM || '', wkt: ft.path ? `LINESTRING (${ft.path.map(p => p.join(' ')).join(', ')})` : (ft.lat != null ? `POINT (${ft.lon} ${ft.lat})` : '') });
    for (const m of map.marks || []) T.marks.push({ sessionMarkId: `${s.id}:${m.id}`, sessionId: s.id, ref: m.ref, markId: m.id, name: m.name, latitude: m.lat, longitude: m.lon, ahdM: m.ahd, condition: m.condition, lastVisited: m.lastVisit, reportUrl: m.report });
  }
}
csv('stations.csv', ['stationKey', 'bureauNumber', 'name', 'floodnetId', 'latitude', 'longitude', 'lga', 'hub', 'owner'], T.stations);
csv('sessions.csv', ['sessionId', 'stationKey', 'source', 'forumDate', 'attendees', 'outOfSession', 'outcome', 'outcomeNote', 'template', 'definitionsVersion', 'savedAt', 'savedBy', 'continuesFrom'], T.sessions);
csv('answers.csv', ['answerId', 'sessionId', 'questionCode', 'optionCode', 'optionLabel', 'other', 'note', 'source'], T.answers);
csv('answer_fields.csv', ['fieldId', 'sessionId', 'questionCode', 'fieldCode', 'value'], T.fields);
csv('property_services.csv', ['psId', 'sessionId', 'rowKey', 'value'], T.ps);
csv('follow_ups.csv', ['followUpId', 'sessionId', 'rule', 'owner', 'text', 'done'], T.followUps);
csv('tasks.csv', ['taskRef', 'sessionId', 'ref', 'title', 'detail', 'team', 'due', 'sentAt'], T.tasks);
csv('map_features.csv', ['featureId', 'sessionId', 'kind', 'questionCode', 'ref', 'latitude', 'longitude', 'lengthM', 'wkt'], T.features);
csv('survey_marks.csv', ['sessionMarkId', 'sessionId', 'ref', 'markId', 'name', 'latitude', 'longitude', 'ahdM', 'condition', 'lastVisited', 'reportUrl'], T.marks);
// The data dictionary: every code a CSV above can hold, with its wording.
const dict = [];
for (const [code, q] of Object.entries(defs.questions)) {
  dict.push({ kind: 'question', questionCode: code, code, label: q.label, type: q.type, section: q.section, templates: defs.templates.filter(t => t.questions.some(e => (typeof e === 'string' ? e : e.q) === code)).map(t => t.id).join('; ') });
  const opts = [];
  const add = list => (list || []).forEach(o => (o.options ? add(o.options) : opts.push(o)));
  add(q.options);
  for (const t of defs.templates) for (const e of t.questions) if (typeof e === 'object' && e.q === code && e.options) add(e.options);
  const seen = new Set();
  opts.forEach(o => { if (seen.has(o.code)) return; seen.add(o.code); dict.push({ kind: 'option', questionCode: code, code: o.code, label: o.label, type: '', section: '', templates: '' }); });
  (q.fields || []).forEach(f => dict.push({ kind: 'field', questionCode: code, code: f.code, label: f.label, type: f.type + (f.unit ? ` (${f.unit})` : ''), section: '', templates: '' }));
}
for (const r of (defs.propertyServices || {}).rows || []) dict.push({ kind: 'property-services row', questionCode: '', code: r.id, label: r.label, type: r.kind, section: 'propertyServices', templates: '' });
csv('data_dictionary.csv', ['kind', 'questionCode', 'code', 'label', 'type', 'section', 'templates'], dict);
