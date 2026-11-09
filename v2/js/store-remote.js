/* SoRT v2 — store-remote.js
   The shared sessions: kept by Flood-Net's server (floodwarning.net/api/sort/v1)
   for whoever has the forum passphrase — typed once per computer, no accounts,
   no tokens. The playbook (playbook.js) reads and writes its two kinds of file
   through here: index.json and stations/<key>.json, each with an ETag so two
   computers saving at once can't overwrite each other unseen.
   Contract: Flood-Net's docs/sort-store.md (Atlas `sort-session-store`). */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const h = (...a) => U().h(...a);
  const BASE = 'https://floodwarning.net/api/sort/v1';
  const LS_KEY = 'sortv2.passphrase';

  function passphrase() {
    try { return G.localStorage.getItem(LS_KEY) || G.sessionStorage.getItem(LS_KEY) || ''; } catch (_) { return ''; }
  }
  function remember(p, keep) {
    try {
      G.localStorage.removeItem(LS_KEY); G.sessionStorage.removeItem(LS_KEY);
      if (p) (keep ? G.localStorage : G.sessionStorage).setItem(LS_KEY, p);
    } catch (_) { /* private window: this tab only, in memory */ mem = p; }
  }
  let mem = '';
  const has = () => !!(passphrase() || mem);
  // Letters and digits, in capitals — as Flood-Net holds it — so a sentence works
  // however it is typed, and the header carries only plain characters.
  const tidy = p => String(p || '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function call(method, path, opts) {
    const o = opts || {};
    const headers = Object.assign({ 'X-SoRT-Passphrase': passphrase() || mem }, o.headers || {});
    let res;
    try { res = await fetch(`${BASE}${path}`, { method, headers, body: o.body, cache: 'no-store' }); }
    catch (e) { const err = new Error('Flood-Net’s server can’t be reached'); err.status = 0; throw err; }
    if (res.status === 401) { const err = new Error('the forum passphrase isn’t right (or has changed)'); err.status = 401; throw err; }
    return res;
  }
  async function check(p) {
    try {
      const res = await fetch(`${BASE}/check`, { headers: { 'X-SoRT-Passphrase': p }, cache: 'no-store' });
      return res.status === 200 ? 'ok' : res.status === 401 ? 'wrong' : 'error';
    } catch (_) { return 'offline'; }
  }
  // A file's version tag, as the server gave it. Cloudflare, in front of
  // Flood-Net, turns the tag weak — W/"…" — whenever it compresses an answer
  // (which it does for every browser), and the server refuses a save that
  // quotes a weak tag. Until 9 Nov 2026 SoRT sent them back as they came, so
  // every save after a read was refused as "someone else saved it", over and
  // over: sessions stopped being shared. The tag under the W/ is the file's own.
  const strong = t => String(t || '').trim().replace(/^W\//i, '');
  // → { text, sha } or null when the file doesn't exist yet.
  async function getFile(path) {
    const res = await call('GET', `/files/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) { const e = new Error(`Flood-Net’s server answered ${res.status}`); e.status = res.status; throw e; }
    return { text: await res.text(), sha: strong(res.headers.get('ETag')) };
  }
  // The server's refusals, in plain words.
  const SAY = { 'too large': 'the session is too big for the shared store (over 4 MB)', 'slow down': 'too many saves from this office in the last minute — it waits a minute',
    storage: 'Flood-Net’s storage didn’t answer', 'not JSON': 'the session didn’t go across whole', path: 'the station’s file name wasn’t accepted' };
  // Create (no sha) or replace (the sha from the last read). A file changed in
  // between comes back as status 409, which the playbook re-reads and retries.
  async function putFile(path, text, msg, sha) {
    const res = await call('PUT', `/files/${path}`, { body: text, headers: Object.assign({ 'Content-Type': 'application/json' }, sha ? { 'If-Match': sha } : { 'If-None-Match': '*' }) });
    if (res.status === 412) { const e = new Error('another computer saved it at the same moment'); e.status = 409; throw e; }
    if (!res.ok) { const out = await res.json().catch(() => ({})); const e = new Error(SAY[out.error] || out.error || `Flood-Net’s server answered ${res.status}`); e.status = res.status; throw e; }
    const out = await res.json().catch(() => ({}));
    // The answer's own words first: Cloudflare can weaken the header, never the body.
    return { sha: strong(out.etag || res.headers.get('ETag')) };
  }

  // Asking for the passphrase, once per computer.
  function dialog(o) {
    o = o || {};
    const input = h('input', { type: 'password', placeholder: 'The forum passphrase — capitals and spaces don’t matter', autocomplete: 'off', spellcheck: 'false', id: 'passInput' });
    const keep = h('input', { type: 'checkbox', checked: true });
    const msg = h('p', { class: 'hint', id: 'passMsg' });
    const go = async () => {
      const p = tidy(input.value);
      if (!p) { msg.textContent = 'Type or paste the forum passphrase.'; return; }
      msg.textContent = 'Checking…';
      const r = await check(p);
      if (r === 'ok') { remember(p, keep.checked); dlg.close(); dlg.remove(); if (o.onDone) o.onDone(true); return; }
      msg.textContent = r === 'wrong' ? 'That isn’t the forum passphrase — check it and try again.' : 'Flood-Net’s server can’t be reached just now — try again in a moment.';
    };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
    const dlg = h('dialog', { class: 'gh-dlg pass-dlg', 'aria-label': 'Forum passphrase' },
      h('div', { class: 'dlg-head' }, h('h2', null, 'The forum passphrase'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => { dlg.close(); dlg.remove(); } }, '✕')),
      h('div', { class: 'dlg-body' },
        h('p', null, o.why || 'With the forum passphrase, this computer keeps every session where the whole forum can open it — saved by itself as you go.'),
        h('p', { class: 'hint' }, 'Ask the SoRT forum chair for it. It is the same on every computer; you type it once here.'),
        input, h('label', { class: 'inline-check' }, keep, ' Remember on this computer'), msg),
      h('div', { class: 'dlg-foot' }, h('span'), h('button', { type: 'button', class: 'btn btn-primary', onclick: go }, 'Use it')));
    document.body.appendChild(dlg);
    dlg.showModal();
    input.focus();
  }
  function forget() { remember('', false); mem = ''; }

  // A new forum passphrase, set by someone who has the current one. Only its
  // fingerprint leaves the browser; Flood-Net keeps that privately.
  async function sha256Hex(text) {
    const d = await G.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function changeDialog(o) {
    o = o || {};
    const a = h('input', { type: 'password', id: 'passNew', autocomplete: 'off', spellcheck: 'false', placeholder: 'A sentence, e.g. six or more words' });
    const b = h('input', { type: 'password', id: 'passNew2', autocomplete: 'off', spellcheck: 'false', placeholder: 'The same again' });
    const msg = h('p', { class: 'hint', id: 'passNewMsg' });
    const go = async () => {
      const p = tidy(a.value);
      if (p.length < 20) { msg.textContent = 'Make it longer — a sentence of six or more words, ideally a little odd (harder to guess).'; return; }
      if (p !== tidy(b.value)) { msg.textContent = 'The two don’t match.'; return; }
      msg.textContent = 'Changing…';
      let res;
      try { res = await call('PUT', '/passphrase', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha256: await sha256Hex('sort-forum-v1:' + p) }) }); }
      catch (e) { msg.textContent = `Couldn’t change it: ${e.message}.`; return; }
      if (res.status === 409) { msg.textContent = 'It is set in Flood-Net’s Cloudflare settings, so it can’t be changed from here — ask an agent (Flood-Net’s docs/sort-store.md).'; return; }
      if (!res.ok) { msg.textContent = `Couldn’t change it (Flood-Net answered ${res.status}).`; return; }
      remember(p, true);
      dlg.close(); dlg.remove();
      if (o.onDone) o.onDone(true);
    };
    const dlg = h('dialog', { class: 'gh-dlg pass-dlg', 'aria-label': 'Change the forum passphrase' },
      h('div', { class: 'dlg-head' }, h('h2', null, 'Change the forum passphrase'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => { dlg.close(); dlg.remove(); } }, '✕')),
      h('div', { class: 'dlg-body' },
        h('p', null, 'Every forum computer will need the new one: each asks for it the next time it opens SoRT (within a minute or so). Capitals, spaces and punctuation don’t matter.'),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'New passphrase'), a),
        h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, 'Again'), b), msg),
      h('div', { class: 'dlg-foot' }, h('span', { class: 'hint' }, 'Tell the forum by Teams or in person.'), h('button', { type: 'button', class: 'btn btn-primary', onclick: go }, 'Change it')));
    document.body.appendChild(dlg);
    dlg.showModal(); a.focus();
  }

  S.shared = { BASE, has, check, getFile, putFile, dialog, changeDialog, forget, passphrase, tidy, strong };
})(typeof window !== 'undefined' ? window : globalThis);
