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
      '**Copy for Word** (top right), then paste into the report with Ctrl+V. With the forum passphrase on this computer, the session is shared with the whole forum by itself.'
    ] },
    { id: 'session', title: 'Starting a new session', items: [
      'A **session** is one station at one forum sitting. To start one: **Sessions** (top right) → **New session**. The map goes back to the whole of Queensland until you choose the station.',
      'Choosing a different station on a session that already has answers starts a new session by itself; the earlier one stays under **Sessions**.',
      'To go back to one: **Sessions** — type a station’s name or number in its search box — then **Open**. Under **Shared with the forum**, **Open** carries on with a station’s last session as it was saved (from any computer), **Start from it** begins today’s session from its answers, and **Use as a precedent** fills this session from it. **Forget** removes one from this browser only.',
      'Choosing a station that already has a session (here or in the shared sessions) shows a **⚠ already has a session** note on its card: **Show its sessions** opens Sessions searched for it.',
      'To carry a session to another computer: **Download session** (bottom of the page), then on the other computer **Sessions** → **Open a session file…**.'
    ] },
    { id: 'saved', title: 'Where your work is kept', items: [
      'Every change is saved **in this browser** as you go — the footer shows the time of the last save. A reload or a crashed tab loses nothing.',
      'Once this computer has the **forum passphrase** (typed once: **Enter the forum passphrase** on the warning bar — the forum chair has it), each session is also **shared with the forum** by itself a few seconds after a change, so every forum computer can open it. Until then a **⚠ Saved only in this browser** bar says so: nobody else can open it, and clearing the browser loses it.',
      '**Download a copy** (on that bar, or **Download session** at the foot of the page) saves the session as a file — the fallback if anything is ever wrong.',
      'If a session’s text looks like it holds a phone number, email or gate code, it is **not** shared by itself — the bar says what it found; remove it, or **save it anyway**.'
    ] },
    { id: 'badges', title: 'Answers filled in for you (the coloured badges)', items: [
      '**Flood-Net**, **Map**, **Precedent** and **Earlier session** mark answers suggested from Flood-Net, the map, a similar station or this station’s last forum. They count as answered but **not checked**: the question has an **orange** bar until you press the badge’s **✓** (or change it), then a **green** bar and **✓ checked**. The header’s **“N to confirm”** jumps to the next one.',
      'They paste into Word exactly as they show, confirmed or not — so look them over before you copy.',
      '**Auto** answers come from a rule — e.g. the radio rows become **NA** for an IP logger, and **Comms Change** is worked out from Current Comms and the Comms Option. Choose another answer to override one.',
      '**Clear** empties a question, suggestions included. **+ Add note** adds a line under that answer in Word.'
    ] },
    { id: 'map', title: 'The map', items: [
      '**🔒 Zoom lock** (just above the map’s + / −) is on when the page opens, so the mouse wheel scrolls the page — or the list under the map — instead of zooming the map. Zoom with **+ / −**, or hold **Ctrl** while you scroll; press **🔒** to unlock (it shows **🔓**) and the wheel zooms the map again. On a touch screen, one finger scrolls the page and two move the map.',
      '**Flood-Net’s position can be rounded** (older records are often only good to 10–100 m). Always check it: turn on **✥ Move pins** and drag the red pin onto the equipment, or type the position in **Locations**, then **✓ Position checked**. Once the pin has moved, tick **Flood-Net position** (above the map) to see where Flood-Net has it — a dashed red ring, on this map only, never in the Word picture.',
      '**Locations** (beside or below the map) lists every location the table asks for. Type a coordinate (decimal or degrees-minutes-seconds), or press **Place** and click the map. Placing the relocation site answers **Relocation: Yes** and measures the distance.',
      '**Drawn for the scope**: the vegetation clearance circle (its radius comes from the Vegetation Management question), trees to remove (**T1, T2…**), and the access track — click along the route, then double-click, press Enter or **✓ Finish route**. **Esc** cancels placing or drawing.',
      '**State survey marks** (Queensland’s, from QSpatial): the nearest 5 within 2 km (**S1–S5**). An arrow at the edge points to one that’s off the map. Untick one to leave it out of Word; the mark’s number opens its State survey report. They are not the station’s own **Bureau benchmarks** — those are on the Local TBM question.',
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
    { id: 'tbm', title: 'Local TBM and the Bureau benchmarks (water level tables)', items: [
      '**Bureau benchmarks (HDB)** are the station’s own marks — level, datum, height on the gauge (LGH), what each is and where — from the Bureau’s HDB, kept in Flood-Net for its editors. On the Local TBM question press **Get them from Flood-Net ↗**: sign in there as an editor and press **Send to SoRT**, and they come back to this tab only. **Use** fills the Local TBM with one; they also go into Word as their own table (B1, B2…), apart from the State survey marks (S1–S5).',
      'If Flood-Net says it can’t reach this tab (a sign-in can lose the link), press its **Copy for SoRT**, then **Paste from Flood-Net** here.',
      'If the forum has the site’s TBM to hand (HDB or the hardcopy station file), choose **On hand – AHD value** or **On hand – LGH value** and type the value and where the TBM is.',
      'If not, choose **Not on hand** (or leave it): the Word table gets a **DESKTOP TASK** for technical staff to look it up. It leaves the table once the value and its location are filled in.',
      'It is the site’s own benchmark, not a State survey mark — those are the S1–S5 marks on the map.'
    ] },
    { id: 'corrosion', title: 'Infrastructure options and corrosion (water level tables)', items: [
      'Salt from the sea corrodes steel and aluminium, so the materials go by how far the site is from the shore. Choose a **Corrosion category** (OTE’s instruction): **C3 and below** (standard galvanised tower, aluminium enclosure, galvanised orifice run), **C4** (a stainless steel enclosure and orifice run) or **C5 and CX** (all stainless). The tick boxes follow the category.',
      'Change a tick and the category becomes **Custom** (or the category those ticks are exactly), e.g. a stainless orifice run in a polluted river. **Custom** keeps the ticks as they are.',
      'Once the site’s position is known, the card measures its distance to the sea (QSpatial’s Queensland coastline; river mouths are closed off, so a river bank upstream isn’t “the shore”) and fills in the category it suggests, marked **Map** until you press **✓**. It follows a relocation’s new location. **🗺 Map of these distances** opens the guide with a map of its own: the site, and a line to the nearest surf beach and other shore. A rounded position only gets a warning when it could change the category; move the pin onto the equipment and press **✓ Position checked**.',
      '**📖 More about corrosion** opens the guide: the categories, OTE’s distances for each kind of shore (surf, semi-sheltered, quiet, tropical) with this site’s, the standard’s own table beside them (OTE is stricter in places, never less strict), and AS 4312’s grades. In Word the category is a bold line, with each part as a bullet under it. The forum knows the site best — strong onshore winds or industry nearby can push it up a category.'
    ] },
    { id: 'ass', title: 'Acid sulfate soil (water level and rainfall tables)', items: [
      'Acid sulfate soil is harmless while wet and undisturbed; dug up or drained it makes sulfuric acid, which attacks concrete and steel. The **Acid sulfate soil** question flags a site where it is possible or likely, so the scope asks for testing — the contractor tests the soil, and decides how to manage it.',
      'Once the site’s position is known, the card reads Queensland’s acid sulfate soil maps there (the finest that covers it, else the national atlas, else the station’s ground height against 5 m above sea level) and the nearest tested soil core, and fills in the **Risk** it suggests, marked **Map** until you press **✓**.',
      '**Likely or present** ticks soil testing, managing what is disturbed, and materials to suit; **Possible** ticks the soil test. Either adds a **Contractor** task to the Word table’s Follow-up Actions — it is not sent to Flood-Net. **Not expected** adds nothing.',
      '**📖 More about acid sulfate soil** explains how it is worked out and its limits, and links the Queensland Government’s own pages. Not mapped is not the same as absent.'
    ] },
    { id: 'ps', title: 'Property Services', items: [
      'It copies the coordinates and the relocation answer from the scope questions **until you change one there** — then it says **Overridden**, with a link back to the scope answer.',
      'On a rainfall table the water-level rows read **NA** by themselves.',
      'Untick **Include in the Word copy** (on its heading) to copy the scope table without it.'
    ] },
    { id: 'playbook', title: 'Shared sessions and precedents', items: [
      'The shared sessions keep every forum’s session under its station, for whoever has the forum passphrase — typed once per computer.',
      'The passphrase is a sentence: capitals, spaces and punctuation don’t matter. Anyone who has it can change it — **Sessions** → **Change the forum passphrase** — and every other computer then asks for the new one.',
      'A station that has been to SoRT before offers **Continue from it** — its last answers come back marked **Earlier session**.',
      '**A precedent**: when this station is best handled like one done before, **Sessions** → find that station → **Use as a precedent** (or **Similar stations** → **Use** on the card). Its answers fill the questions still empty here — never coordinates, licence numbers, the TBM or notes — each **orange** until you check it.',
      'Keep it clean: no landholder names, phone numbers or emails, and no gate, padlock or key codes. Sharing checks the text for them first, and holds the session back if it finds one.'
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
