// flippy admin: catalogue library, statistics, users. Talks to ../api/.
const API = '../api';
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(k => k != null && k !== false && e.append(k));
  return e;
};
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
};
const fmt = n => n.toLocaleString();
const date = t => new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
const mb = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';

let me = null;          // { user, csrf, site, siteUrl, ... }

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = me ? me.csrf : '';
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined), credentials: 'same-origin' });
  let data = null;
  try { data = await r.json(); } catch (e) { /* not json */ }
  if (r.status === 401 && me && me.user) { me.user = null; route(); }
  if (!r.ok) { const err = new Error((data && data.error) || `The server answered ${r.status}.`); err.status = r.status; err.data = data; throw err; }
  return data;
}

let toastT = 0;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.toggle('bad', !!bad);
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
}
function view(...kids) { const v = $('#view'); v.textContent = ''; v.append(...kids); window.scrollTo(0, 0); }

/* ---------------- session ---------------- */

async function loadMe() {
  me = await api('/me');
  $('#site').textContent = me.site || 'flippy';
  document.title = (me.site || 'flippy') + ' · flippy';
  const signedIn = !!me.user;
  $('#nav').hidden = $('#who').hidden = !signedIn;
  if (signedIn) {
    $('#who-name').textContent = me.user.name || me.user.username;
    $('#nav-users').hidden = me.user.role !== 'admin';
    checkHealth();
  }
}

async function checkHealth() {
  const warn = [];
  if (location.protocol !== 'https:' && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
    warn.push('This admin isn’t on HTTPS, so passwords travel unencrypted. Turn on HTTPS for this site.');
  }
  try {
    const r = await fetch('../data/flippy.sqlite', { method: 'HEAD', cache: 'no-store' });
    if (r.ok) warn.push('The data folder can be downloaded from the web. Move it outside the web root (data_dir in config.php) or block it in your web server; see the README.');
  } catch (e) { /* fine */ }
  if (me.user && me.maxUploadMb && me.maxUploadMb < 50) {
    warn.push(`PHP on this server accepts uploads up to ${me.maxUploadMb} MB, which is too small for most catalogues. Raise upload_max_filesize and post_max_size (to 300M, say).`);
  }
  $('#banner').hidden = !warn.length;
  $('#banner').textContent = warn.join(' ');
}

function authForm({ title, intro, fields, submit, onSubmit }) {
  const err = el('p', { class: 'err', role: 'alert' });
  const btn = el('button', { class: 'primary', type: 'submit' }, submit);
  const form = el('form', { class: 'stack', novalidate: true }, ...fields, err, btn);
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(form))); }
    catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; }
  });
  view(el('div', { class: 'auth' }, el('div', { class: 'card' }, el('h1', {}, title), el('p', {}, intro), form)));
  form.querySelector('input').focus();
}
const field = (label, attrs, help) => el('label', { class: 'f' }, label, el('input', attrs), help && el('span', { class: 'help' }, help));

function showSetup() {
  authForm({
    title: 'Set up flippy', intro: 'Create the first account. It can add other people later.', submit: 'Create account',
    fields: [
      field('Your name', { name: 'name', autocomplete: 'name' }),
      field('Username', { name: 'username', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }),
      field('Password', { name: 'password', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }, 'At least 10 characters.'),
      field('Password again', { name: 'password2', type: 'password', required: true, autocomplete: 'new-password' })
    ],
    onSubmit: async d => {
      if (d.password !== d.password2) throw new Error('The passwords don’t match.');
      await api('/setup', { method: 'POST', body: d });
      await loadMe(); location.hash = '#/'; route();
    }
  });
}

function showLogin() {
  authForm({
    title: 'Sign in', intro: me.site ? 'to ' + me.site : '', submit: 'Sign in',
    fields: [
      field('Username', { name: 'username', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }),
      field('Password', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })
    ],
    onSubmit: async d => { await api('/login', { method: 'POST', body: d }); await loadMe(); route(); }
  });
}

$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); await loadMe(); location.hash = '#/'; route(); });

/* ---------------- library ---------------- */

const fileInput = el('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
document.body.append(fileInput);
let uploadTarget = null;           // slug to replace, or null for a new catalogue
function pickZip(slug) { uploadTarget = slug; fileInput.value = ''; fileInput.click(); }
fileInput.addEventListener('change', () => fileInput.files[0] && upload(fileInput.files[0], uploadTarget));

async function upload(file, replaceSlug) {
  if (!/\.zip$/i.test(file.name)) { toast('Choose a zip exported from the builder.', true); return; }
  if (me.maxUploadMb && file.size > me.maxUploadMb * 1048576) { toast(`That zip is ${mb(file.size)}; this server accepts up to ${me.maxUploadMb} MB.`, true); return; }
  let slug = replaceSlug || file.name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'catalogue';
  const send = async replace => {
    const form = new FormData();
    form.append('zip', file); form.append('slug', slug); form.append('replace', replace ? '1' : '0');
    return api('/catalogues', { method: 'POST', form });
  };
  toast('Uploading ' + file.name + '…');
  try {
    let r;
    try { r = await send(!!replaceSlug); }
    catch (e) {
      if (e.status !== 409) throw e;
      if (confirm(`A catalogue at “${slug}” already exists. Replace it with ${file.name}?\n\nCancel to upload it as a new catalogue instead.`)) r = await send(true);
      else {
        const other = prompt('Address for the new catalogue (lowercase letters, digits and dashes):', slug + '-2');
        if (!other) return;
        slug = other.trim(); r = await send(false);
      }
    }
    toast(replaceSlug ? 'Catalogue replaced.' : 'Catalogue added.');
    location.hash = '#/c/' + r.catalogue.slug;
    route();
  } catch (e) { toast(e.message, true); }
}

async function showLibrary() {
  view(el('p', { class: 'muted' }, 'Loading…'));
  const { catalogues } = await api('/catalogues');
  const actions = el('div', { class: 'row' },
    el('a', { class: 'btn primary', href: '../builder/' }, 'New catalogue'),
    el('button', { class: 'ghost', onclick: () => pickZip(null) }, 'Upload zip'));
  const bar = el('div', { class: 'bar' }, el('h1', {}, 'Catalogues'), actions);
  if (!catalogues.length) {
    view(bar, el('div', { class: 'empty', id: 'dropzone' },
      el('h2', {}, 'No catalogues yet'),
      el('p', {}, 'Make one from a PDF in the builder, or upload a zip exported from it. You can also drop a zip here.'),
      el('div', { class: 'row' }, el('a', { class: 'btn primary', href: '../builder/' }, 'Open the builder'), el('button', { class: 'ghost', onclick: () => pickZip(null) }, 'Upload zip'))));
    return;
  }
  view(bar, el('ul', { class: 'grid', id: 'dropzone' }, catalogues.map(c => el('li', {},
    el('a', { class: 'cat', href: '#/c/' + c.slug },
      el('div', { class: 'img' }, el('img', { src: c.thumb, alt: '', loading: 'lazy' })),
      el('div', { class: 'meta' },
        el('strong', { title: c.title }, c.title),
        el('span', { class: 'badge' + (c.published ? '' : ' off') }, c.published ? 'Published' : 'Hidden'),
        el('div', { class: 'nums' }, el('span', {}, `${c.pages} pages`), el('span', { title: 'Views in the last 30 days' }, plural(c.views30, 'view')), el('span', { title: 'Product clicks in the last 30 days' }, plural(c.clicks30, 'click')))))))));
}

// drop a zip anywhere on the library
['dragover', 'dragenter'].forEach(t => document.addEventListener(t, e => {
  if (!me || !me.user || !document.getElementById('dropzone')) return;
  e.preventDefault(); document.getElementById('dropzone').classList.add('drop-hint');
}));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => {
  const z = document.getElementById('dropzone'); if (!z) return;
  e.preventDefault(); if (t === 'drop' || !e.relatedTarget) z.classList.remove('drop-hint');
  if (t === 'drop' && e.dataTransfer.files[0]) upload(e.dataTransfer.files[0], null);
}));

/* ---------------- one catalogue ---------------- */

let statDays = 30;
async function showCatalogue(slug) {
  view(el('p', { class: 'muted' }, 'Loading…'));
  let c;
  try { ({ catalogue: c } = await api('/catalogues/' + encodeURIComponent(slug))); }
  catch (e) { view(el('a', { class: 'crumb', href: '#/' }, '← Catalogues'), el('p', {}, e.message)); return; }

  const patch = async (body, msg) => {
    try { const r = await api('/catalogues/' + encodeURIComponent(c.slug), { method: 'PATCH', body }); toast(msg); return r.catalogue; }
    catch (e) { toast(e.message, true); return null; }
  };

  const title = el('h1', { contenteditable: 'plaintext-only', spellcheck: 'false', title: 'Click to rename' }, c.title);
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.textContent = c.title; title.blur(); } });
  title.addEventListener('blur', async () => {
    const t = title.textContent.trim();
    if (!t || t === c.title) { title.textContent = c.title; return; }
    const r = await patch({ title: t }, 'Renamed.'); if (r) c = r; else title.textContent = c.title;
  });

  const pubBtn = el('button', { class: 'ghost', onclick: async () => {
    const r = await patch({ published: !c.published }, c.published ? 'Hidden. Visitors can’t open it now.' : 'Published.');
    if (r) showCatalogue(r.slug);
  } }, c.published ? 'Hide' : 'Publish');

  const head = el('div', { class: 'head' },
    el('img', { src: c.thumb, alt: '' }),
    el('div', {},
      title,
      el('div', { class: 'facts' },
        el('span', { class: 'badge' + (c.published ? '' : ' off') }, c.published ? 'Published' : 'Hidden'), ' ',
        `${c.pages} pages · ${mb(c.bytes)} · updated ${date(c.updated)}`),
      el('div', { class: 'row' },
        el('a', { class: 'btn primary', href: c.url, target: '_blank', rel: 'noopener' }, 'Open ↗'),
        el('a', { class: 'btn ghost', href: '../builder/?open=' + encodeURIComponent(c.slug) }, 'Edit in builder'),
        el('button', { class: 'ghost', onclick: () => pickZip(c.slug) }, 'Replace with zip'),
        pubBtn)));

  // embed
  const dist = me.siteUrl + '/dist/flippy.min.js';
  const embed = `<script src="${dist}"></script>\n<flip-book src="${c.url}"></flip-book>`;
  const iframe = `<iframe src="${c.url}" title="${c.title.replace(/"/g, '&quot;')}" style="width:100%;height:85vh;border:0" allow="fullscreen"></iframe>`;
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(what + ' copied.'), () => toast('Couldn’t copy; select the text instead.', true));
  const share = el('section', { class: 'panel' },
    el('h2', {}, 'Share and embed'),
    el('p', { class: 'note' }, 'Link to it directly:'),
    el('div', { class: 'row' }, el('a', { href: c.url, target: '_blank', rel: 'noopener', class: 'mono' }, c.url), el('button', { class: 'ghost small', onclick: () => copy(c.url, 'Link') }, 'Copy')),
    el('p', { class: 'note' }, 'Or show it inside any page of your website:'),
    el('pre', { class: 'code' }, embed),
    el('div', { class: 'row' }, el('button', { class: 'ghost small', onclick: () => copy(embed, 'Code') }, 'Copy code'),
      el('span', { class: 'help' }, 'Size it with CSS, e.g. flip-book { height: 700px }')),
    el('p', { class: 'note' }, 'Or, where scripts aren’t allowed, as an iframe:'),
    el('pre', { class: 'code' }, iframe),
    el('div', { class: 'row' }, el('button', { class: 'ghost small', onclick: () => copy(iframe, 'Iframe code') }, 'Copy iframe code'),
      el('span', { class: 'help' }, 'Products then open in a new tab, not over the catalogue.')));

  // settings
  const slugIn = el('input', { value: c.slug, pattern: '[a-z0-9-]+', spellcheck: 'false', 'aria-label': 'Address' });
  const settings = el('section', { class: 'panel' },
    el('h2', {}, 'Address'),
    el('label', { class: 'f' }, 'The last part of the link', slugIn,
      el('span', { class: 'help' }, 'Changing it breaks links and embeds that use the old address.')),
    el('div', { class: 'row' }, el('button', { class: 'ghost small', onclick: async () => {
      const s = slugIn.value.trim();
      if (s === c.slug) return;
      const r = await patch({ slug: s }, 'Address changed.');
      if (r) { location.hash = '#/c/' + r.slug; }
    } }, 'Change address')));

  const danger = el('section', { class: 'panel danger-zone' },
    el('h2', {}, 'Files'),
    el('div', { class: 'row' },
      el('a', { class: 'btn ghost small', href: `${API}/catalogues/${encodeURIComponent(c.slug)}/zip`, download: '' }, 'Download zip'),
      c.hasPdf && el('a', { class: 'btn ghost small', href: c.url + 'catalogue.pdf', target: '_blank', rel: 'noopener' }, 'PDF'),
      el('button', { class: 'danger small', onclick: async () => {
        if (!confirm(`Delete “${c.title}”? Its pages, PDF and statistics are removed for good, and links to it stop working.`)) return;
        try { await api('/catalogues/' + encodeURIComponent(c.slug), { method: 'DELETE' }); toast('Deleted.'); location.hash = '#/'; }
        catch (e) { toast(e.message, true); }
      } }, 'Delete')));

  const stats = el('section', { class: 'panel' }, el('h2', {}, 'Statistics'), el('p', { class: 'note' }, 'Loading…'));
  const look = appearancePanel(c, r => { c = r; });
  view(el('a', { class: 'crumb', href: '#/' }, '← Catalogues'), head,
    el('div', { class: 'sections' }, el('div', {}, look, stats), el('div', {}, share, settings, danger)));
  renderStats(stats, c);
}

// theme, colours, link colour and language, with a live preview
const LANGS = { '': 'Visitor’s page language', en: 'English', bg: 'Български', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', nl: 'Nederlands', pl: 'Polski' };
function appearancePanel(c, onSaved) {
  const saved = { theme: 'dark', bg: '', accent: '', linkColor: 'grey', lang: '', ...c.look };
  let cur = { ...saved };
  const select = (name, opts) => {
    const s = el('select', { name }, Object.entries(opts).map(([v, t]) => el('option', { value: v, selected: v === cur[name] }, t)));
    s.addEventListener('change', () => { cur[name] = s.value; changed(); });
    return s;
  };
  const colour = (name, fallback) => {
    const input = el('input', { type: 'color', value: cur[name] || fallback, 'aria-label': name });
    const reset = el('button', { type: 'button', class: 'ghost small' }, 'Default');
    const state = el('span', { class: 'help' });
    const show = () => { state.textContent = cur[name] ? cur[name] : 'theme default'; reset.disabled = !cur[name]; };
    input.addEventListener('input', () => { cur[name] = input.value; show(); changed(); });
    reset.addEventListener('click', () => { cur[name] = ''; input.value = fallback; show(); changed(); });
    show();
    return el('div', { class: 'row' }, input, state, reset);
  };
  const frame = el('iframe', { class: 'look-preview', title: 'Preview', loading: 'lazy' });
  const save = el('button', { class: 'primary small', disabled: true }, 'Save');
  const undo = el('button', { class: 'ghost small', disabled: true }, 'Undo changes');
  const previewUrl = () => {
    const q = new URLSearchParams({ theme: cur.theme });
    q.set('bg', cur.bg ? cur.bg.slice(1) : 'none');
    q.set('accent', cur.accent ? cur.accent.slice(1) : 'none');
    q.set('lang', cur.lang || 'en');
    q.set('links', cur.linkColor);
    return c.url + '?' + q;
  };
  let t = 0, frameLang = cur.lang;
  // colours change in the running preview straight away; only a new language reloads it
  const darker = (hex, f) => '#' + hex.slice(1).match(/../g).map(h => Math.round(parseInt(h, 16) * (1 - f)).toString(16).padStart(2, '0')).join('');
  function paintFrame() {
    try {
      const root = frame.contentDocument && frame.contentDocument.querySelector('.fb');
      if (!root || !root.flippy) return false;
      const light = cur.theme === 'light';
      root.dataset.theme = cur.theme;
      root.dataset.links = cur.linkColor;
      root.style.setProperty('--fb-bg', cur.bg || (light ? '#f3f4f6' : '#2b2f36'));
      root.style.setProperty('--fb-bg-2', cur.bg ? darker(cur.bg, 0.1) : (light ? '#e3e6eb' : '#1f2228'));
      root.style.setProperty('--fb-accent', cur.accent || '#2f6fe4');
      frame.contentDocument.body.style.background = cur.bg || (light ? '#e3e6eb' : '#1f2228');
      return true;
    } catch (e) { return false; }
  }
  function changed() {
    const dirty = JSON.stringify(cur) !== JSON.stringify(saved);
    save.disabled = undo.disabled = !dirty;
    if (cur.lang === frameLang && paintFrame()) return;
    clearTimeout(t); t = setTimeout(() => { frameLang = cur.lang; frame.src = previewUrl(); }, 250);
  }
  save.addEventListener('click', async () => {
    try {
      const look = { theme: cur.theme, bg: cur.bg, accent: cur.accent, linkColor: cur.linkColor, lang: cur.lang };
      const r = await api('/catalogues/' + encodeURIComponent(c.slug), { method: 'PATCH', body: { look } });
      Object.assign(saved, cur); onSaved(r.catalogue); changed();
      toast('Appearance saved. It applies everywhere the catalogue is shown, embeds and iframes included.');
    } catch (e) { toast(e.message, true); }
  });
  undo.addEventListener('click', () => { panel.replaceWith(appearancePanel(c, onSaved)); });
  frame.src = previewUrl();
  const panel = el('section', { class: 'panel' },
    el('h2', {}, 'Appearance'),
    el('div', { class: 'look' },
      el('div', { class: 'look-fields' },
        el('label', { class: 'f' }, 'Theme', select('theme', { dark: 'Dark', light: 'Light' })),
        el('div', { class: 'f' }, 'Background', colour('bg', cur.theme === 'light' ? '#f3f4f6' : '#2b2f36')),
        el('div', { class: 'f' }, 'Accent (buttons that are on)', colour('accent', '#2f6fe4')),
        el('label', { class: 'f' }, 'Link highlight', select('linkColor', { grey: 'Grey', red: 'Red', blue: 'Blue', white: 'White' })),
        el('label', { class: 'f' }, 'Toolbar language', select('lang', LANGS)),
        el('div', { class: 'row' }, save, undo)),
      frame),
    el('p', { class: 'help' }, 'Applies to the catalogue’s page, iframes and embeds. A website can still restyle an embedded <flip-book> with its own CSS. Visitors who picked a link colour themselves keep theirs.'));
  return panel;
}

async function renderStats(panel, c) {
  let s;
  try { s = await api(`/catalogues/${encodeURIComponent(c.slug)}/stats?days=${statDays}`); }
  catch (e) { panel.replaceChildren(el('h2', {}, 'Statistics'), el('p', { class: 'note' }, e.message)); return; }
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Period' }, [7, 30, 90].map(d =>
    el('button', { class: d === statDays ? 'on' : '', onclick: () => { statDays = d; renderStats(panel, c); } }, d + ' days')));
  const kids = [el('h2', {}, 'Statistics', seg),
    el('div', { class: 'totals' },
      el('div', {}, el('b', {}, fmt(s.totals.views)), el('span', {}, el('i', { class: 'key' }), 'views')),
      el('div', {}, el('b', {}, fmt(s.totals.clicks)), el('span', {}, el('i', { class: 'key c' }), 'product clicks')),
      el('div', {}, el('b', {}, s.totals.views ? (s.totals.clicks / s.totals.views).toFixed(2) : '–'), el('span', {}, 'clicks per view'))),
    chart(s.days)];
  if (!s.totals.views && !s.totals.clicks) {
    kids.push(el('p', { class: 'note' }, c.published
      ? 'No visits yet in this period. Views are counted when someone opens the catalogue, here or embedded on another site.'
      : 'The catalogue is hidden, so nothing is counted.'));
  }
  if (s.links.length) {
    const max = s.links[0].clicks;
    kids.push(el('h2', {}, 'Most clicked links'), el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Address'), el('th', { class: 'n' }, 'Clicks'), el('th', {}))),
      el('tbody', {}, s.links.slice(0, 15).map(l => el('tr', {},
        el('td', { class: 'url' }, el('a', { href: l.url, target: '_blank', rel: 'noopener', title: l.url }, prettyUrl(l.url))),
        el('td', { class: 'n' }, fmt(l.clicks)),
        el('td', { class: 'n' }, meter(l.clicks / max, 'c', 80)))))));
  }
  if (s.pages.length) {
    const max = Math.max(...s.pages.map(p => p.views));
    kids.push(el('h2', {}, 'Pages'), el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Page'), el('th', { class: 'n' }, 'Seen'), el('th', {}), el('th', { class: 'n' }, 'Clicks'))),
      el('tbody', {}, s.pages.map(p => el('tr', {},
        el('td', {}, String(p.page)), el('td', { class: 'n' }, fmt(p.views)), el('td', { class: 'n' }, meter(p.views / max, '', 120)),
        el('td', { class: 'n' }, fmt(p.clicks)))))));
  }
  kids.push(el('div', { class: 'row' }, el('button', { class: 'ghost small', onclick: () => downloadCsv(c, s) }, 'Download CSV'),
    el('span', { class: 'help' }, 'Anonymous counts: no cookies, no addresses stored. Days are in UTC.')));
  panel.replaceChildren(...kids);
}

function meter(frac, cls, w) {
  const m = el('div', { class: 'meter ' + cls });
  m.style.width = Math.max(2, Math.round(frac * w)) + 'px';
  return m;
}
function prettyUrl(u) {
  try { const x = new URL(u); [...x.searchParams.keys()].filter(k => k.startsWith('utm_')).forEach(k => x.searchParams.delete(k)); return x.host + x.pathname + x.search; }
  catch (e) { return u; }
}

// views (bars) and clicks (narrow bars in front), one pair per day
function chart(days) {
  const W = 600, H = 150, top = 8, bottom = 18, left = 30;
  const max = Math.max(1, ...days.map(d => Math.max(d.views, d.clicks)));
  const nice = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const bw = (W - left) / days.length;
  const y = v => top + (H - top - bottom) * (1 - v / nice);
  const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img',
    'aria-label': `Views and clicks per day for the last ${days.length} days` });
  g.append(svg('line', { class: 'axis', x1: left, x2: W, y1: H - bottom, y2: H - bottom }));
  g.append(svg('text', { x: 0, y: top + 8 }, String(nice)), svg('text', { x: 0, y: H - bottom }, '0'));
  days.forEach((d, i) => {
    const x = left + i * bw, label = `${d.day}: ${d.views} views, ${d.clicks} clicks`;
    g.append(svg('rect', { class: 'v', x: x + bw * 0.12, width: bw * 0.76, y: y(d.views), height: H - bottom - y(d.views) }, svg('title', {}, label)));
    if (d.clicks) g.append(svg('rect', { class: 'c', x: x + bw * 0.35, width: bw * 0.3, y: y(d.clicks), height: H - bottom - y(d.clicks) }, svg('title', {}, label)));
  });
  const step = Math.ceil(days.length / 6);
  days.forEach((d, i) => {
    const lastOne = i === days.length - 1;
    if (i % step === 0 && i < days.length - step / 2 || lastOne) g.append(svg('text', lastOne ? { x: W, y: H - 4, 'text-anchor': 'end' } : { x: left + i * bw, y: H - 4 }, d.day.slice(5)));
  });
  return g;
}

function downloadCsv(c, s) {
  const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = [['date', 'views', 'clicks'], ...s.days.map(d => [d.day, d.views, d.clicks]), [],
    ['page', 'seen', 'clicks'], ...s.pages.map(p => [p.page, p.views, p.clicks]), [],
    ['link', 'clicks'], ...s.links.map(l => [l.url, l.clicks])];
  const blob = new Blob([lines.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${c.slug}-stats-${statDays}d.csv` });
  document.body.append(a); a.click(); a.remove();
}

/* ---------------- users ---------------- */

async function showUsers() {
  if (me.user.role !== 'admin') { location.hash = '#/'; return; }
  const { users } = await api('/users');
  const roleSel = u => {
    const s = el('select', { 'aria-label': 'Role of ' + u.username }, ['admin', 'editor'].map(r => el('option', { value: r, selected: r === u.role }, r === 'admin' ? 'Admin' : 'Editor')));
    s.addEventListener('change', async () => {
      try { await api('/users/' + u.id, { method: 'PATCH', body: { role: s.value } }); toast('Role changed.'); }
      catch (e) { toast(e.message, true); s.value = u.role; }
    });
    return s;
  };
  const table = el('table', { class: 'users' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Username'), el('th', {}, 'Name'), el('th', {}, 'Role'), el('th', {}, 'Last sign-in'), el('th', {}))),
    el('tbody', {}, users.map(u => el('tr', {},
      el('td', {}, u.username), el('td', {}, u.name || '–'), el('td', {}, roleSel(u)),
      el('td', { class: 'muted' }, u.lastLogin ? date(u.lastLogin) : 'never'),
      el('td', { class: 'n' }, el('div', { class: 'row' },
        el('button', { class: 'ghost small', onclick: async () => {
          const pw = prompt(`New password for ${u.username} (at least 10 characters):`, randomPassword());
          if (!pw) return;
          try { await api('/users/' + u.id, { method: 'PATCH', body: { password: pw } }); toast('Password set. Pass it on to ' + u.username + ' safely.'); }
          catch (e) { toast(e.message, true); }
        } }, 'Set password'),
        u.id !== me.user.id && el('button', { class: 'danger small', onclick: async () => {
          if (!confirm(`Remove ${u.username}? They won’t be able to sign in. Their catalogues stay.`)) return;
          try { await api('/users/' + u.id, { method: 'DELETE' }); showUsers(); } catch (e) { toast(e.message, true); }
        } }, 'Remove')))))));

  const err = el('p', { class: 'err', role: 'alert' });
  const pwIn = el('input', { name: 'password', required: true, minlength: 10, value: randomPassword(), autocomplete: 'off', spellcheck: 'false' });
  const form = el('form', { class: 'inline-form' },
    el('label', { class: 'f' }, 'Username', el('input', { name: 'username', required: true, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off' })),
    el('label', { class: 'f' }, 'Name', el('input', { name: 'name', autocomplete: 'off' })),
    el('label', { class: 'f' }, 'Role', el('select', { name: 'role' }, el('option', { value: 'editor' }, 'Editor'), el('option', { value: 'admin' }, 'Admin'))),
    el('label', { class: 'f' }, 'Password', pwIn),
    el('button', { class: 'primary', type: 'submit' }, 'Add'));
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    try { const d = Object.fromEntries(new FormData(form)); await api('/users', { method: 'POST', body: d }); toast(`${d.username} added. Give them the password; they can change it under Account.`); showUsers(); }
    catch (x) { err.textContent = x.message; }
  });
  view(el('div', { class: 'bar' }, el('h1', {}, 'Users')),
    el('div', { class: 'stack' },
      el('section', { class: 'panel' }, table),
      el('section', { class: 'panel' }, el('h2', {}, 'Add someone'),
        el('p', { class: 'note' }, 'Editors can add, change and delete catalogues. Admins can also manage users.'), form, err)));
}

function randomPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(14));
  return [...r].map(n => a[n % a.length]).join('');
}

/* ---------------- account ---------------- */

function showAccount() {
  const err = el('p', { class: 'err', role: 'alert' });
  const form = el('form', { class: 'stack' },
    field('Current password', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' }),
    field('New password', { name: 'password', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }, 'At least 10 characters.'),
    field('New password again', { name: 'password2', type: 'password', required: true, autocomplete: 'new-password' }),
    err, el('button', { class: 'primary', type: 'submit' }, 'Change password'));
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const d = Object.fromEntries(new FormData(form));
    if (d.password !== d.password2) { err.textContent = 'The new passwords don’t match.'; return; }
    try { const r = await api('/password', { method: 'POST', body: d }); me.csrf = r.csrf; form.reset(); toast('Password changed.'); }
    catch (x) { err.textContent = x.message; }
  });
  view(el('div', { class: 'bar' }, el('h1', {}, 'Account')),
    el('div', { class: 'card stack' },
      el('p', { class: 'note' }, `Signed in as ${me.user.username} (${me.user.role}).`), form));
}

/* ---------------- routing ---------------- */

async function route() {
  if (!me) await loadMe();
  if (me.setup) return showSetup();
  if (!me.user) return showLogin();
  const h = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on',
    a.dataset.nav === (h.startsWith('/users') ? 'users' : h.startsWith('/account') ? 'account' : 'library')));
  try {
    const m = h.match(/^\/c\/([a-z0-9-]+)/);
    if (m) return await showCatalogue(m[1]);
    if (h === '/users') return await showUsers();
    if (h === '/account') return showAccount();
    return await showLibrary();
  } catch (e) { view(el('p', { class: 'err' }, e.message)); }
}
window.addEventListener('hashchange', route);
(async () => {
  try { await loadMe(); } catch (e) { view(el('div', { class: 'auth card' }, el('h1', {}, 'The server isn’t answering'), el('p', {}, e.message))); return; }
  route();
})();
