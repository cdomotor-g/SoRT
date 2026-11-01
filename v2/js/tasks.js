/* SoRT v2 — tasks.js
   Follow-ups, and the tasks that go from the forum to Flood-Net.

   Flood-Net keeps the tasks (its Tasks tab: assigned to teams, private to the
   people allowed to see them). SoRT never creates one itself: "Create these
   tasks in Flood-Net" opens Flood-Net with them filled in, and a person who may
   hand out tasks checks them and presses Create there — so Flood-Net's own
   sign-in decides who can, and each task carries its creator's name.

   The hand-off (agreed with Flood-Net's receiving screen):
     https://floodwarning.net/#tasks=<base64url of UTF-8 JSON, no padding>
     { v:1, source:"sort", session, forum:"yyyy-mm-dd",
       station:{ id, number, name, hub },
       tasks:[ { ref, title, detail, team:{hub}|{name}, due? } ] }
   Flood-Net files each as source_ref "sort:<session>:<ref>", so sending the
   same session again shows what was already created instead of duplicating.

   In the session: followUpState[id].task = { send, team, sentAt } for a
   follow-up, and session.tasks = [{ ref, title, detail, team, due, sentAt }]
   for anything else the forum wants done. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util, R = () => S.rules;
  const h = (...a) => U().h(...a);
  const MAX_TASKS = 30;

  const cfg = A => (A.defs.tasks || { floodnet: 'https://floodwarning.net/', teams: [] });
  const hubTeam = st => (st && st.hubName) || '';
  // A follow-up's suggested team: {hub:true} is the station's own hub team.
  function teamFor(A, rule) {
    const st = A.session.station || {};
    if (!rule || !rule.team) return null;
    if (rule.team.hub) return st.hubId ? { hub: st.hubId, label: hubTeam(st) || 'the hub team' } : { name: hubTeam(st) || 'Hub', label: hubTeam(st) || 'the hub team' };
    return { name: rule.team.name, label: rule.team.name };
  }
  function teamChoices(A) {
    const st = A.session.station || {}, out = [];
    if (st.hubId) out.push({ value: `hub:${st.hubId}`, label: hubTeam(st) || st.hubId, team: { hub: st.hubId } });
    (cfg(A).teams || []).forEach(n => out.push({ value: `name:${n}`, label: n, team: { name: n } }));
    return out;
  }
  const teamValue = t => (!t ? '' : t.hub ? `hub:${t.hub}` : `name:${t.name}`);
  const teamLabel = (A, t) => (!t ? 'no team yet' : t.label || (t.hub ? (hubTeam(A.session.station) || t.hub) : t.name));
  function shortTitle(text) {
    const first = String(text || '').split(/(?<=[.—–])\s/)[0].replace(/[\s.—–]+$/, '');
    return first.length > 80 ? first.slice(0, 77) + '…' : first;
  }

  // Everything that would go to Flood-Net now (not yet sent, or changed since).
  function pending(A) {
    const s = A.session, out = [];
    const rules = Object.fromEntries((A.defs.followUps || []).map(r => [r.id, r]));
    R().followUps(A.ctx).forEach(f => {
      const st = s.followUpState[f.id] = s.followUpState[f.id] || {};
      const t = st.task || (st.task = { send: !!(rules[f.id] && rules[f.id].team), team: teamFor(A, rules[f.id]) });
      if (!t.send || f.done) return;
      out.push({ ref: f.id, title: (rules[f.id] && rules[f.id].taskTitle) || shortTitle(f.text),
        detail: f.text + (f.link ? `\n${f.link.label}: ${f.link.url}` : ''), team: t.team, sentAt: t.sentAt || null });
    });
    (s.tasks || []).forEach(t => out.push({ ref: t.ref, title: t.title, detail: t.detail || '', team: t.team, due: t.due || '', sentAt: t.sentAt || null }));
    return out;
  }
  function payload(A, list) {
    const s = A.session, st = s.station || {};
    const clean = t => (!t ? undefined : t.hub ? { hub: t.hub } : { name: t.name });
    return { v: 1, source: 'sort', session: s.id, forum: s.forum.date,
      station: { id: st.source === 'floodnet' ? st.id : '', number: st.number || '', name: st.name || '', hub: st.hubId || '' },
      tasks: list.slice(0, MAX_TASKS).map(t => Object.assign({ ref: t.ref, title: t.title, detail: t.detail }, t.team ? { team: clean(t.team) } : {}, t.due ? { due: t.due } : {})) };
  }
  const b64url = text => S.github.b64encode(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function handoffUrl(A, list) { return `${cfg(A).floodnet.replace(/\/?$/, '/')}#tasks=${b64url(JSON.stringify(payload(A, list)))}`; }

  function send(A) {
    const st = A.session.station;
    if (!st || !st.name) { A.toast('Choose the station first — every task is filed against it.'); return; }
    const list = pending(A);
    if (!list.length) { A.toast('Nothing to send: tick “Send as a task” on a follow-up, or add a task.'); return; }
    // A link click from the button press: a new tab no pop-up blocker stops,
    // and Flood-Net gets no handle back on this page.
    const a = h('a', { href: handoffUrl(A, list), target: '_blank', rel: 'noopener' });
    document.body.appendChild(a); a.click(); a.remove();
    const now = Date.now(), s = A.session;
    list.forEach(t => {
      if (s.followUpState[t.ref] && s.followUpState[t.ref].task) s.followUpState[t.ref].task.sentAt = now;
      const c = (s.tasks || []).find(x => x.ref === t.ref); if (c) c.sentAt = now;
    });
    A.changed({ light: true });
    A.toast(`${list.length} task${list.length > 1 ? 's' : ''} opened in Flood-Net — check them there and press Create.`);
  }

  /* ---------------- on the page ---------------- */
  function teamSelect(A, current, onPick) {
    const sel = h('select', { class: 'fu-team', 'aria-label': 'Team' }, h('option', { value: '' }, '— choose a team —'));
    const choices = teamChoices(A);
    const cur = teamValue(current);
    if (cur && !choices.some(c => c.value === cur)) choices.unshift({ value: cur, label: teamLabel(A, current), team: current });
    choices.forEach(c => sel.appendChild(h('option', { value: c.value, selected: c.value === cur }, c.label)));
    sel.appendChild(h('option', { value: '__other' }, 'Another team…'));
    sel.addEventListener('change', ev => {
      const v = ev.target.value;
      if (v === '__other') { const n = (G.prompt('The team’s name, as Flood-Net has it:') || '').trim(); if (n) onPick({ name: n, label: n }); else ev.target.value = cur; return; }
      const c = choices.find(x => x.value === v);
      onPick(c ? Object.assign({ label: c.label }, c.team) : null);
    });
    return sel;
  }
  const enabled = A => !!(A.defs.tasks && A.defs.tasks.enabled);
  // Where a follow-up lands in Word, and that ticking it done takes it out.
  function whereText(f) {
    const where = f.table === 'ps' ? 'Property Services table' : f.table === 'scope' ? 'scope table’s Follow-up Actions row' : '';
    if (!where) return f.done ? 'Done' : '';
    return f.done ? `Done — left out of the ${where} in Word` : `Goes in the ${where}; tick the box when it’s done and it’s left out of the Word tables`;
  }
  function render(A, root) {
    root.innerHTML = '';
    const s = A.session, list = R().followUps(A.ctx);
    if (!enabled(A)) return renderPlain(A, root, list);
    const rules = Object.fromEntries((A.defs.followUps || []).map(r => [r.id, r]));
    if (!list.length) root.appendChild(h('p', { class: 'muted' }, 'None — the answers so far don’t call for any.'));
    list.forEach(f => {
      const st = s.followUpState[f.id] = s.followUpState[f.id] || {};
      const t = st.task || (st.task = { send: !!(rules[f.id] && rules[f.id].team), team: teamFor(A, rules[f.id]) });
      const done = h('input', { type: 'checkbox', checked: f.done, disabled: f.doneAuto, title: f.doneAuto ? 'Done — the answer it was waiting for is in, so it is left out of the Word tables' : 'Tick when done — it is then left out of the Word tables' });
      done.addEventListener('change', ev => { st.status = ev.target.checked ? 'done' : 'open'; st.at = Date.now(); A.changed({ light: true }); });
      const sendBox = h('input', { type: 'checkbox', checked: t.send && !f.done, disabled: f.done });
      sendBox.addEventListener('change', ev => { t.send = ev.target.checked; A.changed({ light: true }); });
      root.appendChild(h('div', { class: 'fu' + (f.done ? ' done' : '') },
        h('label', { class: 'fu-check' }, done),
        h('div', { class: 'fu-body' },
          h('div', null, h('span', { class: 'owner' }, f.owner), ' ', f.text, f.link ? [' ', h('a', { href: f.link.url, target: '_blank', rel: 'noopener' }, f.link.label + ' ↗')] : null),
          h('div', { class: 'fu-meta' }, whereText(f)),
          f.done ? null : h('div', { class: 'fu-task' },
            h('label', { class: 'inline-check', title: 'Send it to Flood-Net as a task for a team' }, sendBox, ' Send as a task to'),
            teamSelect(A, t.team, team => { t.team = team; t.send = true; A.changed({ light: true }); }),
            t.sentAt ? h('span', { class: 'hint' }, ` sent to Flood-Net ${U().fmtWhen(t.sentAt)}`) : null))));
    });
    // The forum's own tasks.
    const own = s.tasks = s.tasks || [];
    root.appendChild(h('h3', null, 'Other tasks from this forum'));
    if (!own.length) root.appendChild(h('p', { class: 'muted' }, 'None yet.'));
    own.forEach((t, i) => root.appendChild(h('div', { class: 'fu' },
      h('div', { class: 'fu-body' },
        h('div', null, h('span', { class: 'owner' }, teamLabel(A, t.team)), ' ', h('b', null, t.title), t.detail ? ` — ${t.detail}` : '', t.due ? h('span', { class: 'hint' }, ` (by ${U().dmy(t.due)})`) : null),
        h('div', { class: 'fu-meta' }, 'Goes in the scope table’s Follow-up Actions row', t.sentAt ? ` · sent to Flood-Net ${U().fmtWhen(t.sentAt)}` : '')),
      h('button', { type: 'button', class: 'link', onclick: () => { own.splice(i, 1); A.changed(); } }, 'Remove'))));
    root.appendChild(addForm(A));
    // Send.
    const n = pending(A).length, st = s.station;
    root.appendChild(h('div', { class: 'out-acts' },
      h('button', { type: 'button', class: 'btn', disabled: !n || !st, onclick: () => send(A) }, n ? `Create ${n} task${n > 1 ? 's' : ''} in Flood-Net ↗` : 'Create tasks in Flood-Net ↗'),
      h('span', { class: 'hint' }, st ? 'Opens Flood-Net with them filled in; you check them and press Create there (Flood-Net decides who may).' : 'Choose the station first.')));
  }
  // Follow-ups only, with no task controls (tasks switched off in the definitions).
  function renderPlain(A, root, list) {
    const s = A.session;
    if (!list.length) { root.appendChild(h('p', { class: 'muted' }, 'None — the answers so far don’t call for any.')); return; }
    list.forEach(f => {
      const st = s.followUpState[f.id] = s.followUpState[f.id] || {};
      const done = h('input', { type: 'checkbox', checked: f.done, disabled: f.doneAuto, title: f.doneAuto ? 'Done — the answer it was waiting for is in, so it is left out of the Word tables' : 'Tick when done — it is then left out of the Word tables' });
      done.addEventListener('change', ev => { st.status = ev.target.checked ? 'done' : 'open'; st.at = Date.now(); A.changed({ light: true }); });
      root.appendChild(h('div', { class: 'fu' + (f.done ? ' done' : '') }, h('label', { class: 'fu-check' }, done),
        h('div', { class: 'fu-body' },
          h('div', null, h('span', { class: 'owner' }, f.owner), ' ', f.text, f.link ? [' ', h('a', { href: f.link.url, target: '_blank', rel: 'noopener' }, f.link.label + ' ↗')] : null),
          h('div', { class: 'fu-meta' }, whereText(f)))));
    });
  }
  function addForm(A) {
    const box = h('details', { class: 'fu-add' }, h('summary', null, '+ Add a task'));
    const title = h('input', { type: 'text', placeholder: 'What needs doing, in a few words' });
    const detail = h('textarea', { rows: 2, placeholder: 'Details (optional)' });
    const due = h('input', { type: 'date' });
    let team = null;
    const sel = teamSelect(A, null, t => { team = t; });
    box.appendChild(h('div', { class: 'fu-add-grid' },
      h('label', { class: 'fld fld-wide' }, h('span', { class: 'fld-label' }, 'Task'), title),
      h('label', { class: 'fld fld-wide' }, h('span', { class: 'fld-label' }, 'Details'), detail),
      h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Team'), sel),
      h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Due (optional)'), due),
      h('div', null, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        if (!title.value.trim()) { A.toast('Say what needs doing.'); return; }
        const s = A.session; s.tasks = s.tasks || [];
        const n = s.tasks.reduce((m, t) => Math.max(m, Number(String(t.ref).replace(/\D/g, '')) || 0), 0) + 1;
        s.tasks.push({ ref: `custom-${n}`, title: title.value.trim(), detail: detail.value.trim(), team, due: due.value || '', sentAt: null });
        A.changed();
      } }, 'Add'))));
    return box;
  }
  // The forum's own tasks belong in the Word copy's Follow-up Actions row too.
  function forWord(A) {
    if (!enabled(A)) return [];
    return (A.session.tasks || []).map(t => ({ owner: teamLabel(A, t.team), text: t.title + (t.detail ? ` — ${t.detail}` : '') + (t.due ? ` (by ${U().dmy(t.due)})` : '') }));
  }
  function summary(session) {
    const fu = Object.entries(session.followUpState || {}).filter(([, v]) => v.task && v.task.send).map(([id, v]) => ({ ref: id, team: v.task.team || null, sentAt: v.task.sentAt || null }));
    return fu.concat((session.tasks || []).map(t => ({ ref: t.ref, title: t.title, detail: t.detail, team: t.team || null, due: t.due || '', sentAt: t.sentAt || null })));
  }

  S.tasks = { enabled, render, pending, payload, handoffUrl, send, forWord, summary, MAX_TASKS };
})(typeof window !== 'undefined' ? window : globalThis);
