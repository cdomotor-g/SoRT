/* SoRT v2 — github.js
   The GitHub connection: a fine-grained token, pasted in once and kept in this
   browser only — the same key v1 uses ("sort.github"), so connecting in either
   version connects both. It reads and writes files through the contents API:
   v2/definitions.json in this (public) repo, and the playbook in the private
   cdomotor-g/SoRT-playbook repo. Everything still works without a token,
   except the playbook (which is private) and publishing. */
(function (G) {
  'use strict';
  const S = G.SoRT = G.SoRT || {};
  const U = () => S.util;
  const KEY = 'sort.github';
  const TIMEOUT = 15000;

  function auth() {
    for (const store of [G.localStorage, G.sessionStorage]) {
      try { const v = JSON.parse(store.getItem(KEY) || 'null'); if (v && v.token) return v; } catch (_) { /* blocked storage */ }
    }
    return null;
  }
  const authHeader = () => { const a = auth(); return a ? { Authorization: `Bearer ${a.token}` } : {}; };
  function save(a, remember) { forget(); try { (remember ? G.localStorage : G.sessionStorage).setItem(KEY, JSON.stringify(a)); } catch (_) { /* ignore */ } }
  function forget() { try { G.localStorage.removeItem(KEY); } catch (_) { /* */ } try { G.sessionStorage.removeItem(KEY); } catch (_) { /* */ } }

  async function api(url, opts) {
    const o = opts || {};
    const headers = Object.assign({ Accept: 'application/vnd.github+json' }, o.token ? { Authorization: `Bearer ${o.token}` } : authHeader());
    if (o.body) headers['Content-Type'] = 'application/json';
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), o.timeoutMs || TIMEOUT);
    try {
      const res = await fetch(url, { method: o.method || 'GET', headers, cache: 'no-store', body: o.body ? JSON.stringify(o.body) : undefined, signal: ctl.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) { const e = new Error(`GitHub: HTTP ${res.status}${data && data.message ? ' — ' + data.message : ''}`); e.status = res.status; throw e; }
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') { const x = new Error(`GitHub didn’t answer within ${Math.round((o.timeoutMs || TIMEOUT) / 1000)} s`); x.timeout = true; throw x; }
      throw e;
    } finally { clearTimeout(t); }
  }
  // UTF-8 safe base64, either way.
  function b64encode(text) {
    const bytes = new TextEncoder().encode(text); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s+/g, '')); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const contentsUrl = (repo, path, branch) => `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${branch ? '?ref=' + encodeURIComponent(branch) : ''}`;
  // → { text, sha } or null when the file doesn't exist.
  async function getFile(repo, path) {
    try {
      const d = await api(contentsUrl(repo, path, repo.branch));
      if (d && d.content != null && d.encoding === 'base64') return { text: b64decode(d.content), sha: d.sha };
      if (d && d.sha && d.download_url) {   // over 1 MB: fetch the raw copy
        const raw = await api(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/blobs/${d.sha}`);
        return { text: b64decode(raw.content), sha: d.sha };
      }
      return null;
    } catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function putFile(repo, path, text, message, sha) {
    const body = { message, content: b64encode(text), branch: repo.branch };
    if (sha) body.sha = sha;
    const d = await api(contentsUrl(repo, path), { method: 'PUT', body });
    return { sha: d && d.content && d.content.sha, commit: d && d.commit && d.commit.sha };
  }
  async function canWrite(repo, token) {
    const r = await api(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, { token });
    return !!(r && r.permissions && (r.permissions.push || r.permissions.admin));
  }

  // "Connect GitHub" — paste a token; it is checked before it is kept.
  function connectDialog(opts) {
    const o = opts || {};
    const h = U().h;
    const createUrl = 'https://github.com/settings/personal-access-tokens/new?' + new URLSearchParams({
      name: 'SoRT', description: 'SoRT scope builder: publish questions to SoRT, save sessions to SoRT-playbook',
      target_name: 'cdomotor-g', expires_in: '366', contents: 'write' });
    const input = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const remember = h('input', { type: 'checkbox', checked: true });
    const msg = h('p', { class: 'hint' });
    const dlg = h('dialog', { class: 'gh-dlg', 'aria-label': 'Connect GitHub' },
      h('div', { class: 'dlg-head' }, h('h2', null, 'Connect GitHub'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
      h('div', { class: 'dlg-body' },
        h('p', null, o.why || 'The playbook is private, so reading and saving it needs a GitHub token that can reach it.'),
        h('ol', null,
          h('li', null, h('a', { href: createUrl, target: '_blank', rel: 'noopener' }, 'Create a token on GitHub ↗'), ' — under ', h('b', null, 'Repository access'), ' pick ', h('b', null, 'Only select repositories'), ' → ', h('b', null, 'SoRT'), ' and ', h('b', null, 'SoRT-playbook'), '; ', h('b', null, 'Contents: Read and write'), '. (Already have v1’s SoRT token? Edit it on GitHub to add SoRT-playbook instead — same token, nothing to paste.)'),
          h('li', null, 'Paste it here:')),
        input,
        h('label', { class: 'inline-check' }, remember, ' Remember on this computer'),
        msg),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
          const token = input.value.trim();
          if (!token) { msg.textContent = 'Paste the token first.'; return; }
          msg.textContent = 'Checking it with GitHub…';
          try {
            const user = await api('https://api.github.com/user', { token });
            save({ token, login: user.login }, remember.checked);
            msg.textContent = `Connected as @${user.login}.`;
            dlg.close();
            if (o.onDone) o.onDone(user.login);
          } catch (e) { msg.textContent = e.status === 401 ? 'GitHub didn’t accept that token.' : `Couldn’t check it: ${e.message}`; }
        } }, 'Connect'),
        auth() ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { forget(); dlg.close(); if (o.onDone) o.onDone(null); } }, `Disconnect @${auth().login || ''}`) : null));
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    dlg.showModal();
    setTimeout(() => input.focus(), 0);
  }

  S.github = { auth, authHeader, save, forget, api, getFile, putFile, canWrite, connectDialog, b64encode, b64decode };
})(typeof window !== 'undefined' ? window : globalThis);
