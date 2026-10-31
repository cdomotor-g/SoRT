#!/usr/bin/env node
// One-off: builds v2/definitions.json from v1's definitions.json (repo root)
// plus the v2 additions. Run once to seed v2; after that v2/definitions.json is
// the source of truth and is edited directly (by hand, by an agent, or by the
// in-app editor) — re-running this would throw those edits away.
//
//   node v2/tools/convert-v1.mjs > v2/definitions.json
//
// Every question and option gets a permanent code (slug of its v1 label/id).
// Codes are what answers are stored under, so a label can be reworded later
// without orphaning old sessions; a code is never reused for something else.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const v1 = JSON.parse(readFileSync(join(here, '..', '..', 'definitions.json'), 'utf8'));

const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[–—]/g, '-').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'opt';

// v1 row ids → v2 question codes (camelCase, stable).
const QCODE = {
  stationType: 'stationType', complexity: 'complexity', InfraOps: 'infraOptions',
  coords: 'coords', relocation: 'relocation', riverCoords: 'riverCoords',
  riverRelocation: 'riverRelocation', sensorOption: 'sensorOption', SensorRange: 'sensorRange',
  terminationType: 'terminationType', gaugeBoards: 'gaugeBoards', Benchmark: 'benchmark',
  DipPoint: 'dipPoint', comms: 'comms', reasonComms: 'commsChange', fadeMargin: 'fadeMargin',
  txpower: 'txPower', frequency: 'frequency', alertFormat: 'alertFormat', stockFence: 'stockFence',
  demolition: 'demolition', accessibility: 'accessibility', nonStandard: 'nonStandard',
  remediation: 'remediation', installNotes: 'installNotes', notesCoLocated: 'installNotes',
  photos: 'photos', rainfallLocation: 'rainfallLocation', row: 'tbrgLocation', infraType: 'infraType',
  mast: 'mast', backhaul: 'backhaul', bgan: 'bgan', cavityFilters: 'cavityFilters'
};
const SECTION_OF = {
  stationType: 'station', complexity: 'station', infraOptions: 'station',
  coords: 'location', relocation: 'location', riverCoords: 'location', riverRelocation: 'location', tbrgLocation: 'location',
  sensorOption: 'sensors', sensorRange: 'sensors', terminationType: 'sensors', gaugeBoards: 'sensors', benchmark: 'sensors', dipPoint: 'sensors', rainfallLocation: 'sensors',
  currentComms: 'comms', comms: 'comms', commsChange: 'comms', fadeMargin: 'comms', txPower: 'comms', frequency: 'comms', acmaLicence: 'comms', alertFormat: 'comms',
  repeaterRadio: 'comms', infraType: 'comms', mast: 'comms', backhaul: 'comms', bgan: 'comms', cavityFilters: 'comms',
  stockFence: 'works', demolition: 'works', accessibility: 'works', remediation: 'works', vegetation: 'works', accessTrack: 'works', nonStandard: 'works',
  installNotes: 'notes', photos: 'notes'
};
// Option tags used by conditions (`{q, tag}`) — the comms family of each comms option.
const COMMS_FAMILY = {
  'IP Logger - Cellular Communications': ['cellular'],
  'IP Logger - Satellite Communications': ['satellite'],
  'IP Logger - Campbell Scientific - ERRTS VHF Communications': ['errts'],
  'Local Processing Unit - Elpro ERRTS VHF Communications': ['errts'],
  'AL200X Campbell Scientific - ERRTS VHF Communications': ['errts']
};
const OTHER_RE = /^other\b|\(specify\)|other or multiple|^other:/i;

function convOptions(list, qcode) {
  const out = []; let group = null; const taken = new Set();
  for (const raw of list || []) {
    const s = String(raw);
    if (!s.trim()) continue;
    if (s.startsWith('### ')) { group = { group: s.slice(4).trim().replace(/:$/, ''), options: [] }; out.push(group); continue; }
    const label = s.replace(/\s+$/, '');
    let code = slug(label); while (taken.has(code)) code += '_2'; taken.add(code);
    const opt = { code, label };
    if (OTHER_RE.test(label)) opt.other = true;
    if (qcode === 'comms' && COMMS_FAMILY[label]) opt.tags = COMMS_FAMILY[label];
    (group ? group.options : out).push(opt);
  }
  return out;
}
function convFields(fields) {
  return (fields || []).map(f => {
    const o = { code: f.key, label: f.label, type: f.type === 'textarea' ? 'textarea' : 'text' };
    if (f.placeholder) o.placeholder = f.placeholder;
    if (f.default != null && f.default !== '') o.default = f.default;
    return o;
  });
}
function convRow(r) {
  const code = QCODE[r.id] || r.id;
  const q = { label: r.item, section: SECTION_OF[code] || 'notes' };
  if (r.instruction) q.hint = r.instruction;
  if (r.icon) q.icon = r.icon;
  q.type = r.type === 'none' ? 'none' : r.type;
  if (r.type !== 'none') q.options = convOptions(r.options, code);
  const fields = convFields(r.fields);
  if (fields.length) q.fields = fields;
  if (r.note) q.notes = [{ text: r.note }];
  if (r.mapPin) {
    q.pin = { field: r.mapPin.field, label: r.mapPin.label, colour: r.mapPin.colour || 'red' };
    if (r.mapPin.anchor) q.pin.anchor = true;
  }
  return [code, q];
}

const questions = {};
const shared = Object.fromEntries((v1.sharedRows || []).map(r => [r.id, r]));
for (const r of v1.sharedRows || []) { const [c, q] = convRow(r); questions[c] = q; }

// ---- v2 changes to carried-over questions -----------------------------------
// Coordinates are a coordinate field (validated, shown on the map).
questions.coords.fields[0].type = 'coord';
questions.coords.prefill = { field: 'existing', from: 'station.position' };
questions.relocation.fields.find(f => f.code === 'newLocation').type = 'coord';
questions.relocation.fields.find(f => f.code === 'distance').unit = 'm';
questions.relocation.fields.forEach(f => { f.showIf = { q: 'relocation', is: 'yes' }; });
questions.relocation.pin.showIf = { q: 'relocation', is: 'yes' };
questions.relocation.options.forEach(o => { o.code = o.code === 'yes' ? 'yes' : o.code; });

// Comms: the reason-for-change row becomes a derived "Comms change" (what Flood-Net
// says is there now → the Comms Option chosen), with the reason and the new ALERT
// IDs the Hub rep supplies after the forum.
questions.currentComms = {
  label: 'Current Comms', section: 'comms', icon: '📡', type: 'single',
  hint: '(What is on site now — filled from Flood-Net where it can tell; confirm)',
  options: [
    { code: 'errts', label: 'ERRTS / ALERT VHF radio', tags: ['errts'] },
    { code: 'cellular', label: 'IP logger – cellular', tags: ['cellular'] },
    { code: 'satellite', label: 'IP logger – satellite', tags: ['satellite'] },
    { code: 'unknown', label: 'Not known' }
  ],
  prefill: { from: 'station.commsGuess' },
  word: false
};
questions.commsChange = {
  label: 'Comms Change', section: 'comms', icon: '☎️', type: 'single',
  hint: '(Worked out from Current Comms and the Comms Option — change it if it is wrong)',
  options: [
    { code: 'none', label: 'No change' },
    { code: 'cellular_to_errts', label: 'Cellular → ERRTS', tags: ['to_errts'] },
    { code: 'satellite_to_errts', label: 'Satellite → ERRTS', tags: ['to_errts'] },
    { code: 'errts_to_satellite', label: 'ERRTS → Satellite' },
    { code: 'errts_to_cellular', label: 'ERRTS → Cellular' },
    { code: 'cellular_to_satellite', label: 'Cellular → Satellite' },
    { code: 'satellite_to_cellular', label: 'Satellite → Cellular' }
  ],
  derive: { kind: 'commsChange', from: 'currentComms', to: 'comms', families: ['cellular', 'satellite', 'errts'] },
  fields: [
    { code: 'reason', label: 'Reason', type: 'text', showIf: { q: 'commsChange', isNot: 'none' } },
    { code: 'newAlertIds', label: 'New ALERT IDs', type: 'text', placeholder: 'Filled in when the Hub supplies them',
      emptyText: 'To be supplied by the {hub} rep (follow-up)', showIf: { q: 'commsChange', tag: 'to_errts' } }
  ],
  notes: [
    { text: 'Changing comms type requires GM Approval — ERRTS to SAT', when: { q: 'commsChange', isNot: 'none' } },
    { text: 'New ALERT IDs are not allocated in the forum: the Hub rep supplies them afterwards, once checked against the IDs already in use. A follow-up is added below.',
      when: { q: 'commsChange', tag: 'to_errts' }, level: 'info' }
  ]
};
// Radio rows are NA by themselves when the new comms is an IP logger.
const ipComms = { any: [{ q: 'comms', tag: 'cellular' }, { q: 'comms', tag: 'satellite' }] };
questions.fadeMargin.defaultWhen = [{ when: ipComms, value: 'na' }];
questions.txPower.defaultWhen = [{ when: ipComms, value: 'na' }];
questions.frequency.defaultWhen = [{ when: ipComms, value: 'na' }];
questions.frequency.prefill = { from: 'station.txFrequency' };
questions.txPower.hint = '(Repeaters typically 5W)';
questions.alertFormat.options.push({ code: 'na', label: 'NA' });
questions.alertFormat.defaultWhen = [{ when: ipComms, value: 'na' }];

questions.acmaLicence = {
  label: 'ACMA Licence', section: 'comms', icon: '📜', type: 'single',
  hint: '(Licence number if the site already has one)',
  options: [
    { code: 'reuse', label: 'Existing licence – reuse' },
    { code: 'transfer', label: 'Existing licence held by council / third party – transfer to Bureau' },
    { code: 'new', label: 'New licence required – network assessment' },
    { code: 'na', label: 'NA' }
  ],
  fields: [
    { code: 'licenceNo', label: 'Licence number', type: 'licence', placeholder: 'e.g. 1441013/1',
      showIf: { q: 'acmaLicence', in: ['reuse', 'transfer'] } },
    { code: 'holder', label: 'Licence holder', type: 'text', placeholder: 'e.g. the council',
      showIf: { q: 'acmaLicence', is: 'transfer' } }
  ],
  prefill: { field: 'licenceNo', from: 'station.acmaLicence' },
  defaultWhen: [{ when: ipComms, value: 'na' }]
};

// Additional works: vegetation management and access to the water's edge get
// short pick-lists instead of free text (Harrison / Teague / Dan Camp), plus a
// Scope of Works follow-up.
questions.remediation.options = questions.remediation.options.map(o => {
  if (/vegetation/i.test(o.label)) return { ...o, code: 'vegetation' };
  if (/track \/ stairs/i.test(o.label)) return { ...o, code: 'track' };
  return o;
});
questions.vegetation = {
  label: 'Vegetation Management', section: 'works', icon: '🌳', type: 'multi',
  hint: '(Pick all that apply; mark trees and the clearance circle on the map)',
  options: [
    { code: 'full_removal', label: 'Full tree removal' },
    { code: 'trim', label: 'Tree trimming / partial removal' },
    { code: 'weeds', label: 'Overgrowth / weed removal' }
  ],
  fields: [
    { code: 'radius', label: 'Clearance radius', type: 'number', unit: 'm', placeholder: 'e.g. 15' },
    { code: 'detail', label: 'Detail (only if the picks above don’t cover it)', type: 'text' }
  ],
  showIf: { any: [{ q: 'remediation', has: 'vegetation' }, { q: 'complexity', tag: 'vegetation' }] },
  mapDraw: { kind: 'circle', field: 'radius', label: 'Vegetation clearance' }
};
questions.accessTrack = {
  label: 'Access Track / Stairs', section: 'works', icon: '🥾', type: 'single',
  hint: '(Draw the route on the map — its length fills in)',
  options: [
    { code: 'track', label: 'Track' },
    { code: 'stairs', label: 'Stairs' },
    { code: 'both', label: 'Track and stairs' }
  ],
  fields: [
    { code: 'to', label: 'Access to', type: 'text', placeholder: 'e.g. orifice and gauge boards' },
    { code: 'length', label: 'Length', type: 'number', unit: 'm' }
  ],
  showIf: { q: 'remediation', has: 'track' },
  mapDraw: { kind: 'line', field: 'length', label: 'Access track' }
};

// Repeaters: their radio particulars from Flood-Net.
questions.repeaterRadio = {
  label: 'Repeater Radio', section: 'comms', icon: '📻', type: 'none',
  hint: '(From Flood-Net where recorded — confirm)',
  fields: [
    { code: 'rx', label: 'RX frequency', type: 'text', unit: 'MHz' },
    { code: 'tx', label: 'TX frequency', type: 'text', unit: 'MHz' },
    { code: 'passRanges', label: 'ALERT IDs passed', type: 'text' },
    { code: 'owner', label: 'Current owner', type: 'text' }
  ],
  prefill: { from: 'station.repeater' }
};
// Benchmark gets the nearest registered mark as a hint from the map.
questions.benchmark.hintFrom = 'map.nearestBenchmark';
questions.fadeMargin.hintFrom = 'station.fadeMargin';
questions.frequency.hintFrom = 'station.txFrequency';
questions.acmaLicence.hintFrom = 'station.acma';
questions.photos.fields[0].type = 'text';

// ---- tables → templates ------------------------------------------------------
const TEMPLATE_IDS = { rainfall: 'rainfall', waterlevel: 'waterlevel', 'waterlevel-dlgwv': 'colocated', repeater: 'repeater' };
const LABELS = { rainfall: 'Rainfall', waterlevel: 'Water Level', colocated: 'Co-located (DLGWV)', repeater: 'Repeater / Gateway' };
const templates = [];
for (const t of v1.tables) {
  const id = TEMPLATE_IDS[t.id] || slug(t.id);
  const list = [];
  for (const r of t.rows) {
    if (r.shared) { list.push(QCODE[r.shared] || r.shared); continue; }
    const [code, q] = convRow(r);
    if (!questions[code]) { questions[code] = q; list.push(code); continue; }
    // Same question already in the bank: keep this table's differences as overrides.
    const base = questions[code], ov = { q: code };
    for (const k of ['label', 'hint', 'type', 'icon']) if (q[k] !== undefined && JSON.stringify(q[k]) !== JSON.stringify(base[k])) ov[k] = q[k];
    if (q.options && JSON.stringify(q.options) !== JSON.stringify(base.options)) ov.options = q.options;
    if (q.fields && JSON.stringify(q.fields) !== JSON.stringify(base.fields)) ov.fields = q.fields;
    if (JSON.stringify(q.notes || null) !== JSON.stringify(base.notes || null)) ov.notes = q.notes || [];
    list.push(Object.keys(ov).length > 1 ? ov : code);
  }
  templates.push({ id, label: LABELS[id] || t.label, title: t.title, questions: list });
}
// Fix-ups per template ----------------------------------------------------------
const byId = id => templates.find(t => t.id === id);
const entry = (t, code) => t.questions.findIndex(e => (typeof e === 'string' ? e : e.q) === code);
function insertAfter(t, afterCode, ...codes) {
  const i = entry(t, afterCode); t.questions.splice(i < 0 ? t.questions.length : i + 1, 0, ...codes);
}
function moveAfter(t, code, afterCode) {
  const i = entry(t, code); if (i < 0) return; const [e] = t.questions.splice(i, 1); insertAfter(t, afterCode, e);
}
for (const t of templates) {
  // currentComms before comms; commsChange straight after comms; ACMA under frequency.
  if (entry(t, 'comms') >= 0) {
    moveAfter(t, 'commsChange', 'comms');
    t.questions.splice(entry(t, 'comms'), 0, 'currentComms');
  }
  if (entry(t, 'frequency') >= 0) insertAfter(t, 'frequency', 'acmaLicence');
  if (entry(t, 'remediation') >= 0) insertAfter(t, 'remediation', 'vegetation', 'accessTrack');
}
// The repeater table has no comms option row of its own; give it the radio block.
insertAfter(byId('repeater'), 'cavityFilters', 'repeaterRadio');
// The co-located table's install notes carried their own boiler-plate (v1 notesCoLocated).
{
  const t = byId('colocated'); const i = entry(t, 'installNotes'); const e = t.questions[i];
  const v1row = v1.tables.find(x => x.id === 'waterlevel-dlgwv').rows.find(r => r.id === 'notesCoLocated');
  t.questions[i] = { q: 'installNotes', hint: v1row.instruction,
    fields: [{ code: 'notes', label: 'Notes', type: 'textarea', default: v1row.fields[0].default }] };
  void e;
}
// The co-located table's river-line relocation differed from the water level
// table's only in wording; one definition serves both now (keeps its own hint).
{
  const t = byId('colocated'); const i = entry(t, 'riverRelocation');
  if (i >= 0 && typeof t.questions[i] === 'object') delete t.questions[i].fields;
}
// TBRG location is a coordinate pin.
questions.tbrgLocation.fields[0].type = 'coord';
questions.tbrgLocation.pin.colour = 'green';
questions.riverCoords.fields[0].type = 'coord';
questions.riverRelocation.fields.find(f => f.code === 'newRiver').type = 'coord';
// Complexity options that are themselves vegetation work carry a tag the
// vegetation question listens for.
for (const t of templates) for (const e of t.questions) {
  const opts = e && typeof e === 'object' && e.q === 'complexity' ? e.options : null;
  const tag = list => list && list.forEach(o => {
    if (o.options) return tag(o.options);
    if (/vegetation/i.test(o.label)) o.tags = ['vegetation'];
  });
  tag(opts);
}
{ const tag = list => list && list.forEach(o => { if (o.options) return tag(o.options); if (/vegetation/i.test(o.label)) o.tags = ['vegetation']; }); tag(questions.complexity.options); }
// Template-level settings: which Flood-Net stations each suits, and which are water level.
byId('rainfall').suggest = { kinds: ['rain'], notKinds: ['river'] };
byId('waterlevel').suggest = { kinds: ['river'] };
byId('waterlevel').waterLevel = true;
byId('colocated').suggest = { ownerMatches: 'DLGWV|Local Government, Water|Water and Volunteers' };
byId('colocated').waterLevel = true;
byId('repeater').suggest = { roles: ['repeater', 'base'] };

// ---- Property Services --------------------------------------------------------
const ps = JSON.parse(JSON.stringify(v1.propertyServices));
const SRC = { coords: 'coords', riverCoords: 'riverCoords', relocation: 'relocation' };
for (const r of ps.rows) {
  if (r.source) r.source = { q: SRC[r.source.row] || r.source.row, field: r.source.field };
  for (const c of r.coords || []) if (c.source) c.source = { q: SRC[c.source.row] || c.source.row, field: c.source.field };
  if (r.options) r.options = r.options.map(o => ({ code: slug(o), label: o }));
  if (r.wlOnly) { r.waterLevelOnly = true; delete r.wlOnly; }
}
// The orifice's relocation mirrors the river-line relocation question (v1's
// published file pointed it at the current river line by mistake).
{
  const rc = ps.rows.find(r => r.id === 'relocationCoords');
  const o = rc && rc.coords.find(c => c.key === 'orifice');
  if (o) o.source = { q: 'riverRelocation', field: 'newRiver' };
}
const psAt = id => ps.rows.findIndex(r => r.id === id);
ps.rows.splice(psAt('turnSoil') + 1, 0,
  { id: 'culturalHeritage', kind: 'question', label: 'Cultural heritage risk from ground disturbance',
    options: [
      { code: 'low_existing', label: 'Low – existing footing reused' },
      { code: 'low_driven', label: 'Low – driven poles, minimal soil disturbance' },
      { code: 'medium', label: 'Medium – new footings / excavation' },
      { code: 'high', label: 'High – trenching (e.g. a new orifice line)' }
    ] },
  { id: 'bridgeAttach', kind: 'question', label: 'Is equipment attaching to bridge infrastructure?',
    options: [{ code: 'yes', label: 'Yes' }, { code: 'no', label: 'No' }],
    detail: { label: 'Bridge', placeholder: 'Name, structure number, who manages it', from: 'map.nearestBridge' } }
);
ps.rows.find(r => r.id === 'date').auto = 'forumDate';

// ---- follow-ups -----------------------------------------------------------------
const followUps = [
  { id: 'alertIds', owner: 'Hub', table: 'scope',
    when: { q: 'commsChange', tag: 'to_errts' },
    text: 'New ALERT IDs needed — the {hub} rep to supply them after the forum, once checked against the IDs already in use.',
    doneWhen: { q: 'commsChange', field: 'newAlertIds', filled: true } },
  { id: 'acmaTransfer', owner: 'Radio licensing', table: 'scope',
    when: { q: 'acmaLicence', is: 'transfer' },
    text: 'Engage {f:acmaLicence.holder|the licence holder} to transfer ACMA licence {f:acmaLicence.licenceNo|(number to confirm)} to the Bureau.' },
  { id: 'acmaNew', owner: 'Radio licensing', table: 'scope',
    when: { q: 'acmaLicence', is: 'new' },
    text: 'New ACMA licence needed — network assessment and licence application.' },
  { id: 'vegetationScope', owner: 'SoRT Administrator', table: 'scope', link: 'scopeOfWorks',
    when: { any: [{ q: 'remediation', has: 'vegetation' }, { q: 'complexity', tag: 'vegetation' }] },
    text: 'Complete the FWIN – ID – Scope of Works document for the vegetation management, including a detailed paragraph on its scope for the SAR.' },
  { id: 'trackScope', owner: 'SoRT Administrator', table: 'scope', link: 'scopeOfWorks',
    when: { q: 'remediation', has: 'track' },
    text: 'Complete the FWIN – ID – Scope of Works document for the access track / stairs.' },
  { id: 'bridgeMeeting', owner: 'Property Services', table: 'ps',
    when: { ps: 'bridgeAttach', is: 'yes' },
    text: 'Equipment attaches to bridge infrastructure — Property Services to coordinate a meeting with the Technical Lead, OTE and ID.' }
];

const out = {
  schema: 'sort-definitions/2',
  version: 1,
  meta: { appTitle: 'SoRT Forum Scope Builder', updated: new Date().toISOString().slice(0, 10),
    note: 'Seeded from v1 definitions.json by v2/tools/convert-v1.mjs; edited directly since. Codes are permanent: reword a label freely, never reuse a code.' },
  links: {
    scopeOfWorks: { label: 'FWIN – ID – Scope of Works',
      url: 'https://bom365.sharepoint.com/sites/int-FloodWarningInfrastructureNetworkProgram2/Shared%20Documents/Forms/Default.aspx?id=%2Fsites%2Fint%2DFloodWarningInfrastructureNetworkProgram2%2FShared%20Documents%2FAsset%20Management%2FFWIN%20%2D%20ID%20%2D%20Scope%20of%20Works&viewid=d017a792%2Db4d7%2D44f1%2Daa85%2D5417f09fbd0c' }
  },
  sections: [
    { id: 'station', title: 'Station & complexity' },
    { id: 'location', title: 'Location & relocation' },
    { id: 'sensors', title: 'Sensors & river line' },
    { id: 'comms', title: 'Comms & radio' },
    { id: 'works', title: 'Site works' },
    { id: 'notes', title: 'Notes & photos' }
  ],
  session: {
    outcomes: [
      { code: 'complete', label: 'SoRT complete' },
      { code: 'more_data', label: 'More data required' },
      { code: 'site_visit', label: 'Additional site visit required' },
      { code: 'revisit', label: 'Set back to SoRT – revisit' },
      { code: 'deferred', label: 'Deferred' }
    ]
  },
  questions,
  templates,
  propertyServices: ps,
  followUps
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
