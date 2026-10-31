/* SoRT v2 — editor.js
   "Edit questions": quick changes to the questions in the middle of a forum.
   Most changes are better asked of Claude in chat (it edits v2/definitions.json,
   checks it and pushes); this is for the moment you can't wait.

   Two tabs. Questions: pick a table, then a question — its wording, hint,
   options and notes — or add / remove a question. Options are one per line,
   "Label  [code]": the code in brackets is permanent (answers are stored under
   it), so reword the label freely and leave the code alone; a new line without
   a code gets one. "### Heading" starts a group, as in v1. JSON: the whole file.

   Edits are a draft in this browser (sortv2.defs.draft) until Publish commits
   v2/definitions.json to GitHub — refused if someone else changed it first —
   and everyone gets them on their next load. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, sch = () => S.schema;
  const h = (...a) => U().h(...a);
  const REPO = { owner: 'cdomotor-g', repo: 'SoRT', branch: 'main' };
  const PATH = 'v2/definitions.json';
  const LS_DRAFT = 'sortv2.defs.draft', LS_BASE = 'sortv2.defs.base';

  const draft = () => U().LS.json(LS_DRAFT, null);
  function saveDraft(defs, A) {
    U().LS.set(LS_DRAFT, JSON.stringify(defs));
    if (!U().LS.get(LS_BASE)) U().LS.set(LS_BASE, String(A.defsPublishedVersion || A.defs.version));
  }
  function discardDraft() { U().LS.del(LS_DRAFT); U().LS.del(LS_BASE); }

  const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'opt';
  const camel = s => slug(s).replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase());

  // Options ⇄ text: "Label  [code]", "### Group".
  function optionsToText(list) {
    const lines = [];
    (list || []).forEach(o => {
      if (o.options) { lines.push(`### ${o.group}`); o.options.forEach(x => lines.push(`${x.label}  [${x.code}]`)); }
      else lines.push(`${o.label}  [${o.code}]`);
    });
    return lines.join('\n');
  }
  function textToOptions(text, old) {
    const prev = new Map(sch().flatOptions(old).map(o => [o.code, o]));
    const out = [], used = new Set(); let group = null;
    text.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      if (line.startsWith('### ')) { group = { group: line.slice(4).trim(), options: [] }; out.push(group); return; }
      const m = line.match(/^(.*?)\s*\[([a-z0-9_]+)\]\s*$/);
      const label = (m ? m[1] : line).trim();
      let code = m ? m[2] : slug(label);
      while (used.has(code)) code += '_2';
      used.add(code);
      const o = Object.assign({}, prev.get(code) || {}, { code, label });
      if (!prev.has(code) && /^other\b|\(specify\)|other or multiple/i.test(label)) o.other = true;
      (group ? group.options : out).push(o);
    });
    return out;
  }

  function open(A) {
    const work = U().clone(A.defs);
    let tplId = A.session.template, qCode = null;
    const dlg = h('dialog', { class: 'ed-dlg', 'aria-label': 'Edit questions' });
    const body = h('div', { class: 'dlg-body ed-body' });
    const msg = h('div', { class: 'hint' });
    const tabQ = h('button', { type: 'button', class: 'seg on' }, 'Questions');
    const tabJ = h('button', { type: 'button', class: 'seg' }, 'JSON');
    let tab = 'q';
    tabQ.onclick = () => { tab = 'q'; tabQ.classList.add('on'); tabJ.classList.remove('on'); render(); };
    tabJ.onclick = () => { tab = 'j'; tabJ.classList.add('on'); tabQ.classList.remove('on'); render(); };
    const check = d => sch().check(d);
    const say = (t, cls) => { msg.className = 'hint ' + (cls || ''); msg.textContent = t; };

    function entryOf(t, code) { return t.questions.findIndex(e => (typeof e === 'string' ? e : e.q) === code); }
    function render() {
      body.innerHTML = '';
      if (tab === 'j') return renderJson();
      const t = work.templates.find(x => x.id === tplId) || work.templates[0];
      tplId = t.id;
      const pickT = h('select', null, work.templates.map(x => h('option', { value: x.id, selected: x.id === tplId }, x.label)));
      pickT.onchange = ev => { tplId = ev.target.value; qCode = null; render(); };
      const list = h('ol', { class: 'ed-list' });
      sch().templateQuestions(work, tplId).forEach(q => list.appendChild(h('li', { class: q.code === qCode ? 'on' : '' },
        h('button', { type: 'button', class: 'link', onclick: () => { qCode = q.code; render(); } }, q.label), h('span', { class: 'hint' }, ` ${q.code}`))));
      body.appendChild(h('div', { class: 'ed-cols' },
        h('div', null, h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Table'), pickT), list,
          h('button', { type: 'button', class: 'btn', onclick: () => { qCode = '__new'; render(); } }, '+ Add a question to this table')),
        h('div', { class: 'ed-form' }, qCode === '__new' ? newForm(t) : qCode ? questionForm(t, qCode) : h('p', { class: 'hint' }, 'Pick a question on the left.'))));
    }
    function questionForm(t, code) {
      const i = entryOf(t, code), e = t.questions[i];
      const own = typeof e === 'object' && e.options;           // this table words its options itself
      const base = work.questions[code];
      const q = Object.assign({}, base, typeof e === 'object' ? e : {});
      const users = work.templates.filter(x => entryOf(x, code) >= 0).map(x => x.label);
      const label = h('input', { type: 'text', value: q.label });
      const hint = h('input', { type: 'text', value: q.hint || '' });
      const opts = h('textarea', { rows: Math.min(18, sch().flatOptions(q.options).length + 3), spellcheck: 'false' });
      opts.value = optionsToText(q.options);
      const notes = h('textarea', { rows: 2 });
      notes.value = (q.notes || []).filter(n => !n.when).map(n => n.text).join('\n');
      const apply = () => {
        const target = typeof e === 'object' && (e.label != null || own) ? e : null;
        const set = (k, v) => { if (target && target[k] !== undefined) target[k] = v; else base[k] = v; };
        set('label', label.value.trim() || q.label);
        if (hint.value.trim()) set('hint', hint.value.trim()); else { delete base.hint; if (target) delete target.hint; }
        if (q.type !== 'none') {
          const newOpts = textToOptions(opts.value, q.options);
          if (own) e.options = newOpts; else base.options = newOpts;
        }
        const kept = (q.notes || []).filter(n => n.when);
        const plain = notes.value.split('\n').map(x => x.trim()).filter(Boolean).map(text => ({ text }));
        if (typeof e === 'object' && e.notes) e.notes = plain.concat(kept); else base.notes = plain.concat(kept);
        if (base.notes && !base.notes.length) delete base.notes;
        const c = check(work);
        if (c.errors.length) { say(`Not applied: ${c.errors[0]}`, 'error'); return; }
        useDraft(); say('Applied in this browser — Publish to share it.', 'ok');
      };
      return h('div', { class: 'ed-q' },
        h('h3', null, q.label, ' ', h('span', { class: 'hint' }, `[${code}]`)),
        h('p', { class: 'hint' }, own ? `${t.label} has its own option list for this question; option changes here apply to ${t.label} only.` : `Used in: ${users.join(', ')} — changes apply to all of them.`),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Label (left column in Word)'), label),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Hint'), hint),
        q.type !== 'none' ? h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Options — one per line; keep each [code]; “### Heading” starts a group'), opts) : null,
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Notes shown on the question (one per line)'), notes),
        h('div', { class: 'out-acts' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: apply }, 'Apply'),
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => {
            if (!G.confirm(`Remove “${q.label}” from the ${t.label} table? (It stays in the question bank, so earlier sessions still read.)`)) return;
            t.questions.splice(i, 1); qCode = null; useDraft(); render(); say(`Removed from ${t.label} — Publish to share it.`, 'ok');
          } }, 'Remove from this table')));
    }
    function newForm(t) {
      const label = h('input', { type: 'text', placeholder: 'e.g. Bird spikes' });
      const type = h('select', null, [['single', 'Pick one'], ['multi', 'Pick any'], ['none', 'Text only']].map(([v, l]) => h('option', { value: v }, l)));
      const section = h('select', null, work.sections.map(s => h('option', { value: s.id }, s.title)));
      const after = h('select', null, sch().templateQuestions(work, t.id).map(q => h('option', { value: q.code }, `after ${q.label}`)));
      after.value = (sch().templateQuestions(work, t.id).slice(-1)[0] || {}).code;
      const opts = h('textarea', { rows: 5, placeholder: 'Yes\nNo\nNA' });
      const text = h('input', { type: 'text', placeholder: 'e.g. Details (leave blank for none)' });
      return h('div', { class: 'ed-q' }, h('h3', null, `New question for ${t.label}`),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Label'), label),
        h('div', { class: 'ed-row' }, h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Answer'), type),
          h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Section'), section),
          h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Position'), after)),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Options, one per line'), opts),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'A text box too? Its label'), text),
        h('div', { class: 'out-acts' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
          const l = label.value.trim(); if (!l) { say('Give it a label.', 'error'); return; }
          let code = camel(l); while (work.questions[code]) code += '2';
          const q = { label: l, section: section.value, type: type.value };
          if (type.value !== 'none') q.options = textToOptions(opts.value || 'Yes\nNo', []);
          if (text.value.trim() || type.value === 'none') q.fields = [{ code: 'detail', label: text.value.trim() || 'Details', type: 'text' }];
          work.questions[code] = q;
          t.questions.splice(entryOf(t, after.value) + 1, 0, code);
          const c = check(work);
          if (c.errors.length) { delete work.questions[code]; t.questions.splice(entryOf(t, code), 1); say(`Not added: ${c.errors[0]}`, 'error'); return; }
          qCode = code; useDraft(); render(); say(`Added “${l}” to ${t.label} — Publish to share it.`, 'ok');
        } }, 'Add')));
    }
    function renderJson() {
      const ta = h('textarea', { class: 'ed-json', spellcheck: 'false' });
      ta.value = JSON.stringify(work, null, 2);
      body.appendChild(h('p', { class: 'hint' }, 'The whole definitions file. Check it, then Apply (this browser) or Publish (everyone).'));
      body.appendChild(ta);
      body.appendChild(h('div', { class: 'out-acts' },
        h('button', { type: 'button', class: 'btn', onclick: () => {
          let d; try { d = JSON.parse(ta.value); } catch (e) { say(`Not valid JSON: ${e.message}`, 'error'); return; }
          const c = check(d);
          say(c.errors.length ? `${c.errors.length} error(s): ${c.errors.slice(0, 3).join(' · ')}` : `No errors${c.warnings.length ? ` (${c.warnings.length} warning(s): ${c.warnings[0]})` : ''}.`, c.errors.length ? 'error' : 'ok');
        } }, 'Check'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
          let d; try { d = JSON.parse(ta.value); } catch (e) { say(`Not valid JSON: ${e.message}`, 'error'); return; }
          const c = check(d); if (c.errors.length) { say(`Not applied: ${c.errors[0]}`, 'error'); return; }
          Object.keys(work).forEach(k => delete work[k]); Object.assign(work, d);
          useDraft(); say('Applied in this browser — Publish to share it.', 'ok');
        } }, 'Apply')));
    }
    function useDraft() { saveDraft(work, A); A.useDefs(U().clone(work), 'your unpublished draft'); }

    async function publish() {
      const c = check(work);
      if (c.errors.length) { say(`Can’t publish: ${c.errors[0]}`, 'error'); return; }
      if (!S.github.auth()) { S.github.connectDialog({ why: 'Publishing the questions needs a GitHub token that can change the SoRT repo (v1’s token can).', onDone: l => { if (l) publish(); } }); return; }
      const what = G.prompt('In a line, what changed? (It becomes the commit message.)', 'Update the questions');
      if (!what) return;
      say('Publishing…');
      try {
        const cur = await S.github.getFile(REPO, PATH);
        const remote = cur ? JSON.parse(cur.text) : null;
        const base = Number(U().LS.get(LS_BASE) || A.defsPublishedVersion || 0);
        if (remote && base && remote.version !== base) { say(`Someone published version ${remote.version} since your draft was started from ${base}. Discard the draft, reload, and make the change again.`, 'error'); return; }
        const out = U().clone(work);
        out.version = (remote ? remote.version : out.version) + 1;
        out.meta = Object.assign({}, out.meta, { updated: U().todayIso() });
        const auth = S.github.auth();
        await S.github.putFile(REPO, PATH, JSON.stringify(out, null, 2) + '\n', `${what} (questions v${out.version}, from the page${auth && auth.login ? ' by @' + auth.login : ''})`, cur && cur.sha);
        discardDraft();
        A.useDefs(out, 'GitHub');
        say(`Published as version ${out.version} — everyone gets it on their next load.`, 'ok');
      } catch (e) { say(e.status === 403 || e.status === 404 ? 'This GitHub token can’t change the SoRT repo — on GitHub, give it Contents: Read and write on SoRT.' : `Couldn’t publish: ${e.message}`, 'error'); }
    }

    dlg.appendChild(h('div', { class: 'dlg-head' }, h('h2', null, 'Edit questions'),
      h('div', { class: 'tpl-pick' }, tabQ, tabJ),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')));
    dlg.appendChild(body);
    dlg.appendChild(h('div', { class: 'dlg-foot' }, msg, h('span', { class: 'map-tools-gap' }),
      draft() ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { if (!G.confirm('Throw away your unpublished changes?')) return; discardDraft(); dlg.close(); A.reloadDefs(); } }, 'Discard my draft') : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: publish }, 'Publish to GitHub')));
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    render();
    dlg.showModal();
  }

  S.editor = { open, draft, discardDraft, textToOptions, optionsToText };
})(typeof window !== 'undefined' ? window : globalThis);
