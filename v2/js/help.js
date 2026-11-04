/* SoRT v2 — help.js
   The ❔ Help guide (top right): how to start, a new session, and the things
   that catch people out. One list of sections below — keep it in step with the
   page when a control is renamed or moved. **bold** marks a control's name. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const h = (...a) => U().h(...a);
  const LS_SEEN = 'sortv2.helpSeen';

  const SECTIONS = [
    { id: 'start', title: 'Start here — a forum station in six steps', list: 'ol', items: [
      '**Forum details** (top of the page): the date is today’s; type attendees’ initials and press Enter after each. They are remembered for the rest of the day, so the next station starts with them.',
      '**Station**: search Flood-Net by name, Bureau number or ALERT ID and pick it. Check the **Scope table** it suggests (Rainfall, Water Level, Co-located or Repeater) — change it if it’s wrong.',
      '**Map**: check the station’s position against the imagery (Flood-Net’s can be rounded), then press **✓ Position checked**. Mark any other locations (relocation site, river line…).',
      '**Questions**: work down the sections. Anything filled in for you has a coloured badge — press its **✓** to keep it, or just choose something else.',
      '**Property Services**, then **Follow-ups and output**: choose the **Forum outcome** and what goes into Word. The **Preview** at the bottom shows exactly what will paste.',
      '**Copy for Word** (top right), then paste into the report with Ctrl+V. If you’re connected to GitHub, **Save to playbook** as well.'
    ] },
    { id: 'session', title: 'Starting a new session', items: [
      'A **session** is one station at one forum sitting. To start one: **Sessions** (top right) → **New session**. The map goes back to the whole of Queensland until you choose the station.',
      'Choosing a different station on a session that already has answers starts a new session by itself; the earlier one stays under **Sessions**.',
      'To go back to an earlier one: **Sessions** → **Open**. **Forget** removes one from this browser (it asks first, and warns if it was never saved to the playbook).',
      'To carry a session to another computer: **Download session** (bottom of the page), then on the other computer **Sessions** → **Open a session file…**.'
    ] },
    { id: 'saved', title: 'Where your work is kept', items: [
      'Every change is saved **in this browser** as you go — the footer shows the time of the last save. A reload or a crashed tab loses nothing.',
      '**Only in this browser on this computer.** Another computer, another browser, a private (InPrivate) window or clearing the browser’s data won’t have it.',
      'To keep it beyond this browser: **Save to playbook** (shared with the team; needs GitHub connected once per computer) or **Download session** (a file).'
    ] },
    { id: 'badges', title: 'Answers filled in for you (the coloured badges)', items: [
      '**Flood-Net**, **Map**, **Precedent** and **Earlier session** mark answers suggested from Flood-Net, the map, a similar station or this station’s last forum. They count as answered but **not confirmed**: press the badge’s **✓** to keep one, or change it. The header’s **“N to confirm”** jumps to the next one.',
      'They paste into Word exactly as they show, confirmed or not — so look them over before you copy.',
      '**Auto** answers come from a rule — e.g. the radio rows become **NA** for an IP logger, and **Comms Change** is worked out from Current Comms and the Comms Option. Choose another answer to override one.',
      '**Clear** empties a question, suggestions included. **+ Add note** adds a line under that answer in Word.'
    ] },
    { id: 'map', title: 'The map', items: [
      '**🔒 Zoom lock** (just above the map’s + / −) is on when the page opens, so the mouse wheel scrolls the page — or the list under the map — instead of zooming the map. Zoom with **+ / −**, or hold **Ctrl** while you scroll; press **🔒** to unlock (it shows **🔓**) and the wheel zooms the map again. On a touch screen, one finger scrolls the page and two move the map.',
      '**Flood-Net’s position can be rounded** (older records are often only good to 10–100 m). Always check it: turn on **✥ Move pins** and drag the red pin onto the equipment, or type the position in **Locations**, then **✓ Position checked**. Once the pin has moved, a dashed red ring shows where Flood-Net has it.',
      '**Locations** (beside or below the map) lists every location the table asks for. Type a coordinate (decimal or degrees-minutes-seconds), or press **Place** and click the map. Placing the relocation site answers **Relocation: Yes** and measures the distance.',
      '**Drawn for the scope**: the vegetation clearance circle (its radius comes from the Vegetation Management question), trees to remove (**T1, T2…**), and the access track — click along the route, then double-click, press Enter or **✓ Finish route**. **Esc** cancels placing or drawing.',
      '**Survey marks**: the nearest 5 within 2 km (**S1–S5**). An arrow at the edge points to one that’s off the map. Untick one to leave it out of Word; the mark’s number opens its State survey report.',
      '**The picture in Word is the map as you see it** — frame it first (**⤢ Fit locations**, zoom). Copy warns if a location falls outside the picture. Flood-Net’s ring and its other stations are left out of the picture.',
      '**⇅ Map above / ⇆ beside the questions** (on the map card) switches the layout; your choice is remembered.',
      'If the map won’t load (some networks block the map services), everything else still works — type coordinates into the questions. **Map details** at the bottom of the map card copies a report for troubleshooting.'
    ] },
    { id: 'comms', title: 'Comms, frequency and licences', items: [
      '**Current Comms** is Flood-Net’s best guess (ALERT IDs → ERRTS; a satellite terminal → satellite; otherwise probably a cellular IP logger). Check it — **Comms Change** is worked out from it.',
      'A change **to ERRTS** adds a follow-up for the hub rep to supply new ALERT IDs. IDs are never allocated in the forum.',
      'The **ERRTS/ALERT Frequency** is inferred from the repeaters that relay the station — confirm it.',
      '**Fade Margin** shows Flood-Net’s radio path to base, hop by hop, with the margin it saved for each, and the attenuator test measured on site when there is one. A figure marked **Stale** was worked out with an older model (which reads far too low) or before a station changed: a rough guide, not a pass or fail. Once Flood-Net has fresh figures, a station whose own hop clears 20 dB gets **Yes** filled in for you to confirm.',
      '**ACMA Licence**: the hint shows what Flood-Net and the ACMA register know about the site. The register copy can be months old — check anything recent on the ACMA register itself.'
    ] },
    { id: 'word', title: 'Copying into Word', items: [
      '**Copy for Word** puts the scope table, the map picture, the survey marks table and the Property Services table on the clipboard. Wait a few seconds for **“Copied — paste into Word”** while the map picture is made, then paste with Ctrl+V.',
      'Every table’s heading carries the **station name and number** — check it matches the report you’re pasting into.',
      'A follow-up you **tick as done** is left out of the Word tables; untick it to put it back. The ticks under **Follow-ups and output** choose what else goes in (header, empty rows, map picture, survey marks, Property Services).',
      '**“Copied as plain text only”** means the browser refused the formatted copy: click anywhere on the page and press Copy again.'
    ] },
    { id: 'tasks', title: 'Handing tasks to teams (Flood-Net)', items: [
      'A follow-up can go to Flood-Net as a task: tick **Send as a task to** and pick the team — the station’s hub team, SoRT Forum, Property Services, Radio licensing, OTE or ID. The forum’s own jobs go under **Other tasks from this forum**.',
      '**Create N tasks in Flood-Net ↗** opens Flood-Net with them filled in. Nothing is made until someone who may hand out tasks (a SoRT Forum member, or an administrator) checks them there and presses **Create**. If your account can’t, Flood-Net offers **Copy the link** to pass to someone who can.',
      'A **desktop task** (the local TBM to look up in HDB or the station file, for one) stays in the Word tables for technical staff and is never sent to Flood-Net.',
      'Sending again is safe: tasks already made are recognised and left out. Each team sees its tasks on Flood-Net’s **Tasks** tab; who is on a team is seen only by that team and Flood-Net’s administrators.'
    ] },
    { id: 'tbm', title: 'Local TBM (water level tables)', items: [
      'If the forum has the site’s TBM to hand (HDB or the hardcopy station file), choose **On hand – AHD value** or **On hand – LGH value** and type the value and where the TBM is.',
      'If not, choose **Not on hand** (or leave it): the Word table gets a **DESKTOP TASK** for technical staff to look it up. It leaves the table once the value and its location are filled in.',
      'It is the site’s own benchmark, not a State survey mark — those are the S1–S5 marks on the map.'
    ] },
    { id: 'ps', title: 'Property Services', items: [
      'It copies the coordinates and the relocation answer from the scope questions **until you change one there** — then it says **Overridden**, with a link back to the scope answer.',
      'On a rainfall table the water-level rows read **NA** by themselves.',
      'Untick **Include in the Word copy** (on its heading) to copy the scope table without it.'
    ] },
    { id: 'playbook', title: 'Playbook and precedents', items: [
      'The playbook keeps every saved session under its station, privately. **Connect GitHub** once per computer to use it.',
      'A station that has been to SoRT before offers **Continue from it** — its last answers come back marked **Earlier session**.',
      '**Similar stations** → **Use** copies the answers they share (never coordinates, licence numbers or notes), marked **Precedent** until you confirm them.',
      'Keep it clean: no landholder names, phone numbers or emails, and no gate, padlock or key codes. **Save to playbook** checks the text for them first.'
    ] },
    { id: 'questions', title: 'Changing the questions', items: [
      'For a quick change mid-forum: **Edit questions** (footer). It stays a draft **in your browser only** (a banner says so) until **Publish to GitHub** — then everyone gets it the next time they open the page.',
      'For anything bigger, ask Claude in chat — it edits the question file, checks it and publishes it.'
    ] },
    { id: 'small', title: 'Small things worth knowing', items: [
      'Attendees: comma, space or Enter adds initials; Backspace in the empty box removes the last; **Same as last forum** brings back the last list.',
      '**Refresh from Flood-Net** (station card) fetches the station again; **Open in Flood-Net ↗** opens it there.',
      'A name or number wrong in Flood-Net (some names are cut short)? **Edit details** on the station card corrects it for this scope: the Word tables use the correction, the card says what Flood-Net still has, and **Report to Flood-Net** asks for its record to be fixed. Flood-Net itself is not changed; **use Flood-Net’s** puts its value back.',
      'Not in Flood-Net? **Enter it by hand** under the station search (or from the search’s “no station” line): only the name is needed; what it measures picks the scope table, and its hub sends the hub’s tasks to the right team. **Edit details** on the station card corrects it later.',
      '🌙 / ☀️ switches dark mode. **Version 1** (top right, and at the foot of the page) opens the old page, kept as it was, if you need it.'
    ] }
  ];

  // "**bold**" → <b>, everything else as text (never innerHTML).
  function rich(text) {
    const out = [];
    String(text).split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (!part) return;
      out.push(part.startsWith('**') ? h('b', null, part.slice(2, -2)) : document.createTextNode(part));
    });
    return out;
  }

  let dlg = null;
  function build() {
    const body = h('div', { class: 'dlg-body help-body' });
    body.appendChild(h('nav', { class: 'help-toc', 'aria-label': 'Help contents' },
      SECTIONS.map(s => h('a', { href: `#help-${s.id}`, onclick: ev => { ev.preventDefault(); const t = body.querySelector(`#help-${s.id}`); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, s.title.split(' — ')[0]))));
    SECTIONS.forEach(s => body.appendChild(h('section', { id: `help-${s.id}`, class: 'help-sec' },
      h('h3', null, s.title),
      h(s.list || 'ul', null, s.items.map(i => h('li', null, rich(i)))))));
    dlg = h('dialog', { class: 'help-dlg', id: 'helpDlg', 'aria-labelledby': 'helpTitle' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'helpTitle' }, 'Help — using the SoRT Scope Builder'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close help', onclick: () => dlg.close() }, '✕')),
      body,
      h('div', { class: 'dlg-foot' }, h('span', { class: 'hint' }, 'Something unclear or wrong? Tell the SoRT forum chair, or ask Claude in chat.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Close')));
    document.body.appendChild(dlg);
  }
  function open(section) {
    if (!dlg) build();
    U().LS.set(LS_SEEN, '1');
    if (!dlg.open) dlg.showModal();
    const t = section && dlg.querySelector(`#help-${section}`);
    if (t) t.scrollIntoView({ block: 'start' }); else dlg.querySelector('.help-body').scrollTop = 0;
  }
  // First visit: a one-off nudge towards the guide.
  function init(A) {
    const b = document.getElementById('helpBtn');
    if (b) b.addEventListener('click', () => open());
    if (!U().LS.get(LS_SEEN)) {
      U().LS.set(LS_SEEN, '1');
      setTimeout(() => A.toast('New to this page? ❔ Help (top right) has a six-step start and the things that catch people out.', { label: 'Open help', run: () => open() }), 1200);
    }
  }

  S.help = { open, init, SECTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
