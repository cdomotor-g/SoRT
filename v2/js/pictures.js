/* SoRT v2 — pictures.js
   Pictures on a question: a Snipping Tool snip pasted with Ctrl+V while the
   question is clicked into, "📋 Add picture" (the clipboard, else a file), or an
   image file dropped on the card. Each goes into Word under that row's answer
   and note, with its caption.

   The session keeps only references — answers[code].pictures =
   [{ id, w, h, type, caption, at }] — never the bytes: sessions live in
   localStorage, about 5 MB for the whole cdomotor-g.github.io site. The bytes
   are kept here: in memory, and in IndexedDB (database "sortv2", store
   "pictures", keyed by id); without IndexedDB (some private windows) in memory
   for this tab only, and the page says so.

   id = the first 16 hex characters of the SHA-256 of the encoded picture, so a
   picture is the same file wherever it goes. Saved to the forum (Flood-Net's
   store, store-remote.js) as its own file that never changes,
   stations/pic-<id>.json = {"schema":"sort-picture/1","id","type","w","h","data":"<base64>"}:
   created, never replaced (already there = done). The playbook shares a
   session's pictures before the session itself (playbook.js save()); a session
   opened from the store fetches the pictures it hasn't got. Station keys never
   start with "pic-", and index.json never lists these files.

   Pictures hold no landholder names or contact details and no gate, padlock or
   key codes — the privacy check reads text only, so the card says so. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const h = (...a) => U().h(...a);

  const MAX_EDGE = 1600;              // px on the long edge, after downscaling
  const MAX_BYTES = 700 * 1024;       // the encoded picture, at most
  const MAX_COUNT = 12;               // per session: past this, a warning
  const JPEG_Q = 0.82;
  const ID_RE = /^[0-9a-f]{16}$/;
  const LS_SHARED = 'sortv2.pics.shared';
  const RETRY_MS = 30000;             // a picture not found is looked for again after this
  const HINT = 'Pictures go into Word under this row and are saved to the forum — no landholder names, contact details or gate codes in them.';

  const mem = new Map();              // id → { id, type, w, h, dataUrl, at }
  const want = new Map();             // id → { p: Promise|null, failedAt }
  const app = () => S.app;

  /* ---------------- the session's references ---------------- */
  function of(session, code, make) {
    const answers = (session && session.answers) || {};
    if (make && !answers[code]) answers[code] = { value: null, fields: {} };
    const a = answers[code];
    if (!a) return [];
    if (make && !Array.isArray(a.pictures)) a.pictures = [];
    return Array.isArray(a.pictures) ? a.pictures.filter(p => p && ID_RE.test(p.id)) : [];
  }
  function idsOf(session) {
    const out = new Set();
    Object.values((session && session.answers) || {}).forEach(a => {
      ((a && Array.isArray(a.pictures)) ? a.pictures : []).forEach(p => { if (p && ID_RE.test(p.id)) out.add(p.id); });
    });
    return [...out];
  }
  const get = id => mem.get(id) || null;

  /* ---------------- IndexedDB (or memory only) ---------------- */
  let dbp = null, noIdb = false;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!G.indexedDB) { rej(new Error('no IndexedDB')); return; }
      let req;
      try { req = G.indexedDB.open('sortv2', 1); } catch (e) { rej(e); return; }
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('pictures')) d.createObjectStore('pictures'); };
      // Let go when the database is deleted or upgraded elsewhere; the next use opens it again.
      req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
      req.onerror = () => rej(req.error || new Error('IndexedDB refused'));
      req.onblocked = () => rej(new Error('IndexedDB blocked'));
    }).catch(() => { noIdb = true; dbp = Promise.resolve(null); return null; });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    if (!d) return undefined;
    return new Promise((res, rej) => {
      let t;
      try { t = d.transaction('pictures', mode); } catch (e) { rej(e); return; }
      let out;
      const r = fn(t.objectStore('pictures'));
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB'));
    });
  }
  const idbGet = id => tx('readonly', st => st.get(id)).catch(() => undefined);
  const idbPut = rec => tx('readwrite', st => st.put(rec, rec.id)).then(() => true, () => { noIdb = true; return false; });

  /* ---------------- which pictures the forum already has ---------------- */
  let sharedSet = null;
  function sharedIds() { if (!sharedSet) sharedSet = new Set(U().LS.json(LS_SHARED, []).filter(x => ID_RE.test(x))); return sharedSet; }
  function markShared(id) {
    const s = sharedIds();
    if (s.has(id)) return;
    s.add(id);
    const list = [...s].slice(-1000);   // newest kept; a forgotten one is only sent again (and found there)
    sharedSet = new Set(list);
    U().LS.set(LS_SHARED, JSON.stringify(list));
  }

  /* ---------------- getting a picture into memory ---------------- */
  function fromFile(o, id) {
    if (!o || o.schema !== 'sort-picture/1' || o.id !== id || !/^image\/(png|jpeg)$/.test(o.type) || typeof o.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(o.data)) return null;
    return { id, type: o.type, w: Number(o.w) || 0, h: Number(o.h) || 0, dataUrl: `data:${o.type};base64,${o.data}`, at: Date.now() };
  }
  // Memory, else this browser's IndexedDB, else the forum's store. → true when it is in memory.
  function ensure(id, force) {
    if (mem.has(id)) return Promise.resolve(true);
    if (!ID_RE.test(id)) return Promise.resolve(false);
    const w = want.get(id);
    if (w && w.p) return w.p;
    if (w && !force && Date.now() - w.failedAt < RETRY_MS) return Promise.resolve(false);
    const p = (async () => {
      let rec = await idbGet(id);
      if (!rec && S.shared && S.shared.has()) {
        try {
          const f = await S.shared.getFile(`stations/pic-${id}.json`);
          rec = f ? fromFile(JSON.parse(f.text), id) : null;
          if (rec) { markShared(id); idbPut(rec); }
        } catch (_) { rec = null; }
      }
      if (rec && rec.dataUrl) { mem.set(id, rec); want.delete(id); redraw(id); return true; }
      want.set(id, { p: null, failedAt: Date.now() }); redraw(id);
      return false;
    })();
    want.set(id, { p, failedAt: 0 });
    return p;
  }
  // All of a session's pictures in memory (or given up on), for Copy for Word.
  // Never rejects, and never waits more than a few seconds.
  function ready(session) {
    const all = Promise.all(idsOf(session).map(id => ensure(id, true)));
    return Promise.race([all, new Promise(r => setTimeout(r, 8000))]).then(() => undefined);
  }

  /* ---------------- making a picture small enough ---------------- */
  async function decode(blob) {
    if (G.createImageBitmap) {
      try { const b = await G.createImageBitmap(blob); return { src: b, w: b.width, h: b.height, done: () => b.close && b.close() }; } catch (_) { /* the older route */ }
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
  const b64Bytes = b64 => Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  function cyrb(str) {   // playbook.js's fingerprint: for the rare page without crypto.subtle
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  async function idOf(b64) {
    if (G.crypto && G.crypto.subtle) {
      const bin = G.atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const d = new Uint8Array(await G.crypto.subtle.digest('SHA-256', bytes));
      return Array.from(d.slice(0, 8), x => x.toString(16).padStart(2, '0')).join('');
    }
    return cyrb(b64);
  }
  // At most MAX_EDGE on the long edge, on white; JPEG or PNG, whichever is
  // smaller (a snip of text is often smaller, and crisper, as PNG). Re-drawing
  // it also leaves behind whatever the file carried besides the picture (a
  // photo's location, say).
  async function encode(blob) {
    let d;
    try { d = await decode(blob); } catch (_) { throw new Error('it couldn’t be read as a picture — save it as a PNG or JPEG and try again'); }
    try {
      if (!d.w || !d.h) throw new Error('it couldn’t be read as a picture');
      const k = Math.min(1, MAX_EDGE / Math.max(d.w, d.h));
      const w = Math.max(1, Math.round(d.w * k)), ht = Math.max(1, Math.round(d.h * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = ht;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, ht);
      g.imageSmoothingQuality = 'high';
      g.drawImage(d.src, 0, 0, w, ht);
      const png = c.toDataURL('image/png'), jpg = c.toDataURL('image/jpeg', JPEG_Q);
      const dataUrl = jpg.startsWith('data:image/jpeg') && jpg.length < png.length ? jpg : png;
      const type = dataUrl.slice(5, dataUrl.indexOf(';'));
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      return { id: await idOf(b64), type, w, h: ht, dataUrl, bytes: b64Bytes(b64), at: Date.now() };
    } finally { d.done(); }
  }
  const kb = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  /* ---------------- adding and removing ---------------- */
  async function add(A, code, blobs) {
    const q = A && A.ctx && A.ctx.byCode[code];
    if (!q || !blobs.length) return;
    const sessionId = A.session.id;
    A.toast(blobs.length > 1 ? 'Adding the pictures…' : 'Adding the picture…');
    const added = [], problems = [];
    for (const b of blobs) {
      try {
        const rec = await encode(b);
        if (rec.bytes > MAX_BYTES) { problems.push(`it is too big, even made smaller (${kb(rec.bytes)}; the most is ${kb(MAX_BYTES)}) — crop it to the part that matters and paste it again`); continue; }
        if (!A.session || A.session.id !== sessionId) return;   // another session was opened meanwhile
        const list = of(A.session, code, true), all = A.session.answers[code].pictures;
        if (list.some(p => p.id === rec.id)) { problems.push('it is already on this question'); continue; }
        delete rec.bytes;
        mem.set(rec.id, rec); want.delete(rec.id);
        await idbPut(rec);
        all.push({ id: rec.id, w: rec.w, h: rec.h, type: rec.type, caption: '', at: Date.now() });
        added.push(rec.id);
      } catch (e) { problems.push(e.message || String(e)); }
    }
    if (added.length) {
      A.changed();
      // Straight into the new picture's caption (a paste there adds the next picture to the same question).
      const cap = document.querySelector(`[data-fk="${CSS.escape(`${code}::pic::${added[added.length - 1]}`)}"]`);
      if (cap) cap.focus({ preventScroll: true });
    }
    const total = idsOf(A.session).length;
    const msgs = [];
    if (added.length) msgs.push(`${added.length > 1 ? `${added.length} pictures` : 'Picture'} added to “${q.label}”.`);
    if (problems.length) msgs.push(`${added.length ? 'One wasn’t' : blobs.length > 1 ? 'They weren’t' : 'That picture wasn’t'} added: ${problems[0]}.`);
    if (added.length && total > MAX_COUNT) msgs.push(`This session has ${total} pictures now — Word copies get heavy past ${MAX_COUNT}; keep the ones that matter.`);
    if (added.length && noIdb) msgs.push('This browser isn’t keeping pictures (a private window?): they last until this tab is closed — unless saved to the forum first.');
    A.toast(msgs.join(' '));
  }
  function remove(A, code, id) {
    const a = A.session.answers[code];
    if (!a || !Array.isArray(a.pictures)) return;
    a.pictures = a.pictures.filter(p => p.id !== id);
    if (!a.pictures.length) delete a.pictures;
    A.changed();
  }

  /* ---------------- on the card ---------------- */
  // The control beside "+ Add note": the clipboard first (a snip just taken), else a file.
  function button(A, q) {
    return h('button', { type: 'button', class: 'link pic-add', title: 'Add a picture from the clipboard (a snip) or a file. Or click into the question and press Ctrl+V, or drop an image file on it.',
      onclick: () => fromClipboard(A, q.code) }, '📋 Add picture');
  }
  async function fromClipboard(A, code) {
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const blobs = [];
        for (const it of await navigator.clipboard.read()) {
          const t = it.types.find(x => /^image\//.test(x));
          if (t) blobs.push(await it.getType(t));
        }
        if (blobs.length) { await add(A, code, blobs); return; }
      } catch (_) { /* refused, or nothing there: a file instead */ }
    }
    chooseFile(A, code);
  }
  let picker = null, pickFor = null;
  function chooseFile(A, code) {
    if (!picker) {
      picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, id: 'picFile' });
      picker.addEventListener('change', () => {
        const files = Array.from(picker.files || []); picker.value = '';
        if (files.length && pickFor) add(app(), pickFor, files);
      });
      document.body.appendChild(picker);
    }
    pickFor = code;
    // A file chooser needs a click just before it; the clipboard's permission prompt can use that up.
    try { if (picker.showPicker) picker.showPicker(); else picker.click(); }
    catch (_) { A.toast('No picture on the clipboard.', { label: 'Choose a file…', run: () => chooseFile(A, code) }); }
  }

  function block(A, q) {
    const list = of(A.session, q.code);
    if (!list.length) return null;
    return h('div', { class: 'q-pics', dataset: { q: q.code } },
      h('div', { class: 'pic-list' }, list.map(p => figure(A, q, p))),
      h('div', { class: 'hint pic-hint' }, HINT));
  }
  function figure(A, q, p) {
    const view = h('button', { type: 'button', class: 'pic-view', onclick: () => viewer(q, p) });
    fillView(view, p.id);
    const cap = h('input', { type: 'text', class: 'pic-cap', value: p.caption || '', maxlength: 200, placeholder: 'Caption (optional)',
      'data-fk': `${q.code}::pic::${p.id}`, 'aria-label': `Caption for this picture — ${q.label}` });
    cap.addEventListener('input', ev => { p.caption = ev.target.value; A.changed({ light: true }); });
    cap.addEventListener('change', () => A.changed());
    const del = h('button', { type: 'button', class: 'pic-del', title: 'Remove this picture', 'aria-label': 'Remove this picture', onclick: () => {
      if (G.confirm(`Remove this picture from “${q.label}”?`)) remove(A, q.code, p.id);
    } }, '✕');
    return h('figure', { class: 'pic', dataset: { pic: p.id } }, view, h('figcaption', null, cap, del));
  }
  function fillView(view, id) {
    view.innerHTML = '';
    const rec = mem.get(id), w = want.get(id);
    if (rec) {
      view.disabled = false; view.title = 'See it larger';
      view.appendChild(h('img', { src: rec.dataUrl, alt: 'Picture' }));
      return;
    }
    const gone = w && !w.p;
    view.disabled = true;
    view.title = gone ? 'It was added on another computer and hasn’t reached this one: it comes once that computer has saved it to the forum and this one has the forum passphrase.' : '';
    view.appendChild(h('span', { class: 'pic-ph' }, gone ? 'Picture not on this computer yet' : 'Loading the picture…'));
    ensure(id);
  }
  // A picture arrived (or was given up on): its thumbnails, and the preview.
  let previewTimer = null;
  function redraw(id) {
    document.querySelectorAll(`.pic[data-pic="${id}"] .pic-view`).forEach(v => fillView(v, id));
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { const A = app(); if (A && A.picturesLoaded) A.picturesLoaded(); }, 150);
  }

  let dlg = null;
  function viewer(q, p) {
    const rec = mem.get(p.id);
    if (!rec) return;
    if (!dlg) {
      dlg = h('dialog', { class: 'pic-dlg', id: 'picDlg', 'aria-label': 'Picture' });
      dlg.addEventListener('click', ev => { if (ev.target === dlg) dlg.close(); });   // the backdrop
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = '';
    dlg.append(h('div', { class: 'dlg-head' }, h('h2', null, q.label), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
      h('div', { class: 'pic-big' }, h('img', { src: rec.dataUrl, alt: p.caption || 'Picture' })));
    if (p.caption) dlg.append(h('p', { class: 'pic-big-cap' }, p.caption));
    dlg.showModal();
  }

  /* ---------------- paste and drop ---------------- */
  // The question last clicked into: a click on a card's empty space focuses
  // nothing, so a paste then lands on the page itself.
  let lastCard = null;
  const cardOf = el => (el && el.closest ? el.closest('#form .q[data-q]') : null);
  const pageItself = t => !t || t === document.body || t === document.documentElement;
  document.addEventListener('pointerdown', ev => { const c = cardOf(ev.target); lastCard = c ? c.dataset.q : null; }, true);
  document.addEventListener('focusin', ev => { const c = cardOf(ev.target); if (c) lastCard = c.dataset.q; else if (!pageItself(ev.target)) lastCard = null; }, true);
  function imageFiles(dt) {
    let out = Array.from((dt && dt.files) || []).filter(f => /^image\//.test(f.type));
    if (!out.length) out = Array.from((dt && dt.items) || []).filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean);
    return out;
  }
  const textBox = t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|url|email|tel|number|password|)$/i.test(t.getAttribute('type') || '')));
  document.addEventListener('paste', ev => {
    const A = app(), dt = ev.clipboardData;
    if (ev.defaultPrevented || !A || !A.session || !dt) return;
    const files = imageFiles(dt);
    if (!files.length) return;                                   // words: untouched
    // Words copied from Word or Excel come with a picture of themselves: into a text box, the words win.
    if (textBox(ev.target) && /[\p{L}\p{N}]/u.test(dt.getData('text/plain') || '')) return;
    const card = cardOf(ev.target);
    const code = card ? card.dataset.q : (pageItself(ev.target) && lastCard && document.getElementById(`q-${lastCard}`) ? lastCard : null);
    if (!code) { A.toast('Click into the question the picture belongs to, then paste.'); return; }
    ev.preventDefault();
    add(A, code, files);
  });
  let dropCard = null;
  const setDrop = c => { if (dropCard === c) return; if (dropCard) dropCard.classList.remove('pic-drop'); dropCard = c; if (c) c.classList.add('pic-drop'); };
  const fileDrag = ev => !!ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  const fileInput = t => !!(t && t.closest && t.closest('input[type="file"]'));
  document.addEventListener('dragover', ev => {
    if (!fileDrag(ev) || fileInput(ev.target)) return;
    // A file let go anywhere else would replace the page with it: nothing happens instead.
    ev.preventDefault();
    const c = cardOf(ev.target);
    ev.dataTransfer.dropEffect = c ? 'copy' : 'none';
    setDrop(c);
  });
  document.addEventListener('dragleave', ev => { if (!ev.relatedTarget) setDrop(null); });
  document.addEventListener('drop', ev => {
    setDrop(null);
    if (!fileDrag(ev) || fileInput(ev.target)) return;
    ev.preventDefault();
    const A = app(), c = cardOf(ev.target), files = imageFiles(ev.dataTransfer);
    if (!A || !A.session) return;
    if (!c) { if (files.length) A.toast('Drop the picture onto the question it belongs to.'); return; }
    if (!files.length) { A.toast('Only pictures can go on a question (PNG, JPEG and the like).'); return; }
    add(A, c.dataset.q, files);
  });

  /* ---------------- sharing with the forum ---------------- */
  // Before the session itself (playbook.js save()): each picture not yet known
  // to be there, as its own file. A failure throws, so the playbook's retry
  // takes over; one already there (created elsewhere) counts as done.
  async function share(session) {
    if (!S.shared || !S.shared.has()) return;
    for (const id of idsOf(session)) {
      if (sharedIds().has(id)) continue;
      const rec = mem.get(id) || await idbGet(id);
      if (!rec || !rec.dataUrl) continue;   // not on this computer: whoever added it shares it
      const body = JSON.stringify({ schema: 'sort-picture/1', id, type: rec.type, w: rec.w, h: rec.h, data: rec.dataUrl.slice(rec.dataUrl.indexOf(',') + 1) });
      try { await S.shared.putFile(`stations/pic-${id}.json`, body, '', ''); }
      catch (e) {
        if (e.status !== 409) { const err = new Error(`a picture couldn’t be sent (${e.message})`); err.status = e.status; throw err; }
      }
      markShared(id);
    }
  }

  /* ---------------- in a downloaded session file ---------------- */
  // Download session carries the pictures (pictureFiles: {id: {type, w, h, data}}),
  // so a session opened from a file elsewhere has them too.
  async function bundle(session) {
    const ids = idsOf(session);
    if (!ids.length) return null;
    await ready(session);
    const out = {};
    ids.forEach(id => { const r = mem.get(id); if (r) out[id] = { type: r.type, w: r.w, h: r.h, data: r.dataUrl.slice(r.dataUrl.indexOf(',') + 1) }; });
    return Object.keys(out).length ? out : null;
  }
  async function unbundle(files) {
    for (const [id, f] of Object.entries(files || {})) {
      const rec = ID_RE.test(id) && !mem.has(id) ? fromFile(Object.assign({ schema: 'sort-picture/1', id }, f), id) : null;
      if (rec) { mem.set(id, rec); want.delete(id); await idbPut(rec); }
    }
  }

  /* ---------------- tidying this browser's store ---------------- */
  // Pictures no session in this browser uses any more go after a month.
  async function sweep() {
    try {
      const keep = new Set();
      S.store.index().forEach(x => idsOf(S.store.load(x.id)).forEach(id => keep.add(id)));
      if (app() && app().session) idsOf(app().session).forEach(id => keep.add(id));
      const before = Date.now() - 30 * 864e5;
      await tx('readwrite', st => {
        const cur = st.openCursor();
        cur.onsuccess = () => {
          const c = cur.result; if (!c) return;
          if (!keep.has(c.key) && !((c.value || {}).at > before)) c.delete();
          c.continue();
        };
        return null;
      });
    } catch (_) { /* next time */ }
  }
  setTimeout(sweep, 20000);

  S.pictures = { of, idsOf, get, ensure, ready, add, remove, button, block, share, bundle, unbundle, HINT, MAX_EDGE, MAX_BYTES, MAX_COUNT };
})(typeof window !== 'undefined' ? window : globalThis);
