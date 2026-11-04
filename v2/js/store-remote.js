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
  const tidy = p => String(p || '').trim().toUpperCase().replace(/\s+/g, '');

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
  // → { text, sha } or null when the file doesn't exist yet.
  async function getFile(path) {
    const res = await call('GET', `/files/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) { const e = new Error(`Flood-Net’s server answered ${res.status}`); e.status = res.status; throw e; }
    return { text: await res.text(), sha: res.headers.get('ETag') || '' };
  }
  // Create (no sha) or replace (the sha from the last read). A file changed in
  // between comes back as status 409, which the playbook re-reads and retries.
  async function putFile(path, text, msg, sha) {
    const res = await call('PUT', `/files/${path}`, { body: text, headers: Object.assign({ 'Content-Type': 'application/json' }, sha ? { 'If-Match': sha } : { 'If-None-Match': '*' }) });
    if (res.status === 412) { const e = new Error('someone else saved it a moment ago'); e.status = 409; throw e; }
    if (!res.ok) { const out = await res.json().catch(() => ({})); const e = new Error(out.error || `Flood-Net’s server answered ${res.status}`); e.status = res.status; throw e; }
    const out = await res.json().catch(() => ({}));
    return { sha: res.headers.get('ETag') || out.etag || '' };
  }

  // Asking for the passphrase, once per computer.
  function dialog(o) {
    o = o || {};
    const input = h('input', { type: 'password', placeholder: 'e.g. ABCDE-12345-…', autocomplete: 'off', spellcheck: 'false', id: 'passInput' });
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

  S.shared = { BASE, has, check, getFile, putFile, dialog, forget, passphrase };
})(typeof window !== 'undefined' ? window : globalThis);
