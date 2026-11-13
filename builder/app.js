// flippy builder: PDF in, linked flipbook folder out. Runs entirely in the browser.
import { readPdf } from './extract.js';
import { layoutCodes, codeRegex, parseLinkTable, withUtm, productBlocks } from './linker.js';
import { exportZip, linkedPdf, catalogueData, slugify, searchText } from './export.js';
import { unzip } from './zip.js';
import * as store from './store.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad3 = n => String(n).padStart(3, '0');

let P = null;           // the open project
let cur = 0;            // page index shown
let sel = null;         // selected link id
let zoom = 'page';      // 'page' (fit), 'width', or 'custom' with zoomFactor
let zoomFactor = 1;     // size relative to the whole page fitting the window
let undoStack = [], redoStack = [];
let urls = [];          // object URLs of the page images (revoked when the project closes)
let thumbUrls = [];
let codeFilter = 'missing';

const DEFAULTS = { pattern: '\\d{6}', source: 'table', table: '', tableName: '', template: '', utm: '', products: false, productUrl: 'first' };

/* ---------------- start screen ---------------- */

async function showStart() {
  if (P) await saveNow();
  closeProject();
  $('#start').hidden = false; $('#editor').hidden = true;
  $('.doc').hidden = $('.actions').hidden = true;
  document.title = 'flippy builder';
  let items = [];
  try { items = await store.list(); } catch (e) { /* private mode: no storage */ }
  const ul = $('#projects'); ul.textContent = '';
  $('#recent').hidden = !items.length;
  for (const it of items) {
    const src = URL.createObjectURL(it.thumb);
    ul.append(el('li', { class: 'proj' },
      el('button', { class: 'open', onclick: () => openSaved(it.id), title: 'Open' },
        el('img', { src, alt: '' }),
        el('div', { class: 'meta' }, el('strong', {}, it.title || 'Untitled'),
          el('span', {}, `${it.pageCount} pages · ${new Date(it.updated).toLocaleDateString()}`))),
      el('button', { class: 'del', onclick: async () => {
        if (!confirm(`Delete “${it.title || 'Untitled'}” from this browser?`)) return;
        await store.remove(it.id); showStart();
      } }, 'Delete')));
  }
}

async function openFile(file) {
  if (!file) return;
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const isPdf = String.fromCharCode(...head) === '%PDF-';
    if (isPdf) await importPdf(new Uint8Array(await file.arrayBuffer()), file.name);
    else if (head[0] === 0x50 && head[1] === 0x4b) await importZip(file);
    else throw new Error('That file isn’t a PDF or a zip.');
  } catch (e) {
    busy(false); console.error(e); toast(e.message || String(e), true);
  }
}

async function importPdf(bytes, name, extra = {}) {
  busy('Reading the PDF');
  const r = await readPdf(bytes, { onProgress: (i, n) => busy(`Reading page ${Math.min(i + 1, n)} of ${n}`, i / n) });
  const title = extra.title || r.title || (name || '').replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').trim() || 'Catalogue';
  const p = {
    id: crypto.randomUUID ? crypto.randomUUID() : uid() + uid(),
    title, folder: slugify(title), pdf: bytes, images: r.images,
    pages: r.pages.map(pg => ({ w: pg.w, h: pg.h, words: pg.words, images: pg.images || [], shapes: pg.shapes || [], links: pg.links.map(l => ({ ...l, id: uid() })) })),
    settings: { ...DEFAULTS }, codeUrls: {}
  };
  busy(false);
  openProject(p);
  await saveNow();
  const n = p.pages.reduce((s, pg) => s + pg.links.length, 0);
  toast(`${p.pages.length} pages read${n ? `, ${n} links already in the PDF kept` : ''}.`);
}

// A zip exported from the builder (or any catalogue folder, zipped)
async function importZip(file) {
  busy('Opening the zip');
  const files = await unzip(file);
  const names = [...files.keys()];
  const jsonName = names.find(n => /(^|\/)catalogue\.json$/.test(n));
  if (!jsonName) throw new Error('No catalogue.json in that zip.');
  const dir = jsonName.replace(/catalogue\.json$/, '');
  const text = async n => files.has(dir + n) ? files.get(dir + n).text() : null;
  const data = JSON.parse(await text('catalogue.json'));
  const proj = JSON.parse((await text('flippy-project.json')) || 'null');
  const pdfName = dir + (data.pdf || 'catalogue.pdf');
  if (!files.has(pdfName)) throw new Error('The zip has no PDF, so it can’t be edited.');
  const bytes = new Uint8Array(await files.get(pdfName).arrayBuffer());
  const r = await readPdf(bytes, { render: false, onProgress: (i, n) => busy(`Reading page ${Math.min(i + 1, n)} of ${n}`, i / n) });
  const type = data.images || 'webp';
  const mime = type === 'jpg' ? 'image/jpeg' : 'image/' + type;
  const img = (folder, i) => { const b = files.get(`${dir}${folder}/${pad3(i + 1)}.${type}`); return b && new Blob([b], { type: mime }); };
  const pages = [], thumbs = [];
  for (let i = 0; i < r.pageCount; i++) {
    const big = img('pages', i);
    if (!big) throw new Error(`Page image ${i + 1} is missing from the zip.`);
    pages.push(big); thumbs.push(img('thumbs', i) || big);
  }
  const p = {
    id: crypto.randomUUID ? crypto.randomUUID() : uid() + uid(),
    title: (proj && proj.title) || data.title || 'Catalogue',
    folder: (proj && proj.folder) || dir.replace(/\/$/, '').split('/').pop() || slugify(data.title),
    pdf: bytes, images: { type, pages, thumbs },
    settings: { ...DEFAULTS, ...((proj && proj.settings) || {}) }, codeUrls: (proj && proj.codeUrls) || {},
    pages: r.pages.map((pg, i) => ({
      w: pg.w, h: pg.h, words: pg.words, images: pg.images || [], shapes: pg.shapes || [],
      links: proj && proj.pages[i] ? proj.pages[i].links.map(l => ({ ...l, id: l.id || uid() }))
        : ((data.pages[i] && data.pages[i].links) || []).map(l => ({ ...l, id: uid(), from: l.kind === 'link' ? 'pdf' : undefined }))
    }))
  };
  busy(false);
  openProject(p);
  await saveNow();
  toast(proj ? 'Project reopened.' : 'Catalogue opened. Its links are kept as they are.');
}

async function openSaved(id) {
  const p = await store.load(id);
  if (p) openProject(p);
}

async function loadDemo() {
  try {
    busy('Fetching the demo catalogue');
    const base = new URL('../examples/hollowbrook/', location.href);
    const [pdf, csv] = await Promise.all(['catalogue-source.pdf', 'links.csv'].map(f => fetch(new URL(f, base)).then(r => {
      if (!r.ok) throw new Error('Couldn’t fetch the demo (' + r.status + ')'); return f.endsWith('.pdf') ? r.arrayBuffer() : r.text();
    })));
    await importPdf(new Uint8Array(pdf), 'Hollowbrook Goods', { title: 'Hollowbrook Goods · Autumn Collection' });
    P.settings.table = csv; P.settings.tableName = 'links.csv (demo)';
    showSettings();
    toast('Demo loaded. Press “Find and link codes”.');
  } catch (e) { busy(false); toast(e.message, true); }
}

/* ---------------- project ---------------- */

function openProject(p) {
  closeProject();
  P = p; cur = 0; sel = null; undoStack = []; redoStack = [];
  urls = P.images.pages.map(b => URL.createObjectURL(b));
  thumbUrls = P.images.thumbs.map(b => URL.createObjectURL(b));
  $('#start').hidden = true; $('#editor').hidden = false;
  $('.doc').hidden = $('.actions').hidden = false;
  $('#title').value = P.title;
  document.title = P.title + ' · flippy builder';
  showSettings();
  renderThumbs(); renderPage(); renderCodes(); updateUndo();
  $('#saved').textContent = '';
  history.replaceState(null, '', location.pathname + '#' + P.id);
}

function closeProject() {
  if (P) saveNow();
  urls.concat(thumbUrls).forEach(u => URL.revokeObjectURL(u));
  urls = []; thumbUrls = []; P = null;
}

let saveTimer = 0;
function changed() {
  clearTimeout(saveTimer);
  $('#saved').textContent = 'Saving…';
  saveTimer = setTimeout(saveNow, 600);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!P) return;
  try { await store.save(P); $('#saved').textContent = 'Saved in this browser'; }
  catch (e) { $('#saved').textContent = 'Not saved (browser storage unavailable)'; }
}

/* undo: snapshots of every page's links */
function snapshot() { return JSON.stringify(P.pages.map(pg => pg.links)); }
function restore(s) { JSON.parse(s).forEach((links, i) => { P.pages[i].links = links; }); }
function pushUndo(before) {
  undoStack.push(before ?? snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = []; updateUndo();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); afterEdit(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); afterEdit(); }
function updateUndo() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }
function afterEdit() {
  if (sel && !findLink(sel)) sel = null;
  updateUndo(); renderPage(); renderThumbCounts(); renderCodes(); changed();
}
const findLink = id => { for (const pg of P.pages) { const l = pg.links.find(x => x.id === id); if (l) return l; } return null; };
const linkState = l => l.page || l.url ? (l.from === 'pdf' ? 'pdf' : '') : 'nourl';

/* ---------------- thumbnails ---------------- */

function renderThumbs() {
  const nav = $('#thumbs'); nav.textContent = '';
  P.pages.forEach((pg, i) => nav.append(el('button', { class: 'thumb', 'aria-label': 'Page ' + (i + 1), onclick: () => go(i) },
    el('img', { src: thumbUrls[i], alt: '', loading: 'lazy', style: `aspect-ratio:${pg.w}/${pg.h}` }),
    el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'c', hidden: true }))));
  renderThumbCounts();
}
function renderThumbCounts() {
  $$('#thumbs .thumb').forEach((t, i) => {
    const links = P.pages[i].links, bad = links.filter(l => !l.url && !l.page).length;
    const c = t.querySelector('.c');
    c.hidden = !links.length; c.textContent = bad ? `${bad} !` : links.length;
    c.classList.toggle('bad', !!bad);
    c.title = bad ? `${bad} without an address` : `${links.length} links`;
    t.classList.toggle('on', i === cur);
  });
}
function go(i) {
  i = clamp(i, 0, P.pages.length - 1);
  if (i === cur) return;
  cur = i; sel = null; renderPage(); renderThumbCounts();
  const t = $$('#thumbs .thumb')[i]; t && t.scrollIntoView({ block: 'nearest' });
}

/* ---------------- page editor ---------------- */

const sheet = $('#sheet'), stage = $('#stage');

function layoutSheet() {
  if (!P) return;
  const pg = P.pages[cur], ar = pg.w / pg.h;
  const W = stage.clientWidth - 48, H = stage.clientHeight - 48;
  const fit = Math.max(200, Math.min(W, H * ar));
  const w = zoom === 'width' ? Math.max(200, W) : zoom === 'custom' ? fit * zoomFactor : fit;
  zoomFactor = w / fit;
  sheet.style.width = w + 'px'; sheet.style.height = w / ar + 'px';
  const pct = Math.round(zoomFactor * 100);
  $('#zoom').value = String(pct);
  $('#zoom-val').textContent = pct + '%';
  $$('[data-zoom]').forEach(x => x.classList.toggle('on', x.dataset.zoom === zoom));
}

// zoom keeping the point under the cursor (or the middle of the view) where it is
function setZoom(mode, factor, anchor) {
  const st = stage.getBoundingClientRect(), before = sheet.getBoundingClientRect();
  const ax = anchor ? anchor.x : st.left + st.width / 2, ay = anchor ? anchor.y : st.top + st.height / 2;
  const px = (ax - before.left) / before.width, py = (ay - before.top) / before.height;
  zoom = mode;
  if (mode === 'custom') zoomFactor = clamp(factor, 0.5, 4);
  layoutSheet();
  const after = sheet.getBoundingClientRect();
  stage.scrollLeft += after.left + px * after.width - ax;
  stage.scrollTop += after.top + py * after.height - ay;
}

function renderPage() {
  if (!P) return;
  const pg = P.pages[cur];
  $('#pageimg').src = urls[cur];
  $('#pageno').textContent = `${cur + 1} / ${P.pages.length}`;
  $('#prev').disabled = cur === 0; $('#next').disabled = cur === P.pages.length - 1;
  layoutSheet();
  sheet.querySelectorAll('.box, .draft').forEach(b => b.remove());
  for (const l of pg.links) {
    const st = linkState(l);
    const label = l.page ? `→ page ${l.page}` : l.kind === 'title' ? `name · ${l.product}` : l.kind === 'photo' ? `photo · ${l.product}` : (l.code || (l.url ? shortUrl(l.url) : 'no address'));
    const b = el('div', { class: 'box' + (st ? ' ' + st : '') + (l.id === sel ? ' sel' : ''), 'data-id': l.id, title: l.page ? `Turns to page ${l.page}` : (l.url || 'No address yet') },
      el('span', { class: 'lab' }, label + (!l.url && !l.page && l.code ? ' · no address' : '')),
      ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => el('i', { class: 'h ' + d, 'data-h': d })));
    place(b, l);
    sheet.append(b);
  }
  renderInspector();
}
function place(b, l) {
  Object.assign(b.style, { left: l.x * 100 + '%', top: l.y * 100 + '%', width: l.w * 100 + '%', height: l.h * 100 + '%' });
}
function shortUrl(u) { try { const x = new URL(u); return (x.pathname + x.search).replace(/^\/$/, x.host).slice(0, 40); } catch (e) { return u.slice(0, 40); } }

// pointer: move, resize, or draw
let drag = null;
sheet.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const r = sheet.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  const boxEl = e.target.closest('.box');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // keyboard shortcuts act on the page again
  const before = snapshot();
  if (boxEl) {
    const l = findLink(boxEl.dataset.id);
    select(l.id);
    drag = { mode: e.target.dataset.h || 'move', l, start: { ...l }, fx, fy, before, r };
  } else {
    select(null);
    const d = el('div', { class: 'draft' }); sheet.append(d);
    drag = { mode: 'draw', fx, fy, d, before, r };
  }
  sheet.setPointerCapture(e.pointerId);
  e.preventDefault();
});
sheet.addEventListener('pointermove', e => {
  if (!drag) return;
  const { r } = drag;
  const fx = clamp((e.clientX - r.left) / r.width, 0, 1), fy = clamp((e.clientY - r.top) / r.height, 0, 1);
  const dx = fx - drag.fx, dy = fy - drag.fy;
  if (drag.mode === 'draw') {
    drag.box = { x: Math.min(fx, drag.fx), y: Math.min(fy, drag.fy), w: Math.abs(dx), h: Math.abs(dy) };
    place(drag.d, drag.box);
    return;
  }
  const s = drag.start, l = drag.l, min = 0.006;
  if (drag.mode === 'move') {
    l.x = clamp(s.x + dx, 0, 1 - s.w); l.y = clamp(s.y + dy, 0, 1 - s.h);
  } else {
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (drag.mode.includes('w')) x0 = clamp(s.x + dx, 0, x1 - min);
    if (drag.mode.includes('e')) x1 = clamp(x1 + dx, x0 + min, 1);
    if (drag.mode.includes('n')) y0 = clamp(s.y + dy, 0, y1 - min);
    if (drag.mode.includes('s')) y1 = clamp(y1 + dy, y0 + min, 1);
    Object.assign(l, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  drag.moved = true;
  place(sheet.querySelector(`.box[data-id="${l.id}"]`), l);
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'draw') {
    d.d.remove();
    const pxW = d.box ? d.box.w * d.r.width : 0, pxH = d.box ? d.box.h * d.r.height : 0;
    if (pxW < 6 || pxH < 6) return;
    pushUndo(d.before);
    const l = { id: uid(), ...d.box, kind: 'box', url: '' };
    P.pages[cur].links.push(l);
    sel = l.id; afterEdit();
    $('#l-url').focus();
  } else if (d.moved) {
    if (d.l.auto) d.l.manual = true;           // a box adjusted by hand survives re-running auto-link
    pushUndo(d.before); afterEdit();
  }
};
sheet.addEventListener('pointerup', endDrag);
sheet.addEventListener('pointercancel', endDrag);
sheet.addEventListener('lostpointercapture', endDrag);

function select(id) {
  sel = id;
  sheet.querySelectorAll('.box').forEach(b => b.classList.toggle('sel', b.dataset.id === id));
  renderInspector();
}

/* ---------------- selected link ---------------- */

function renderInspector() {
  const l = sel && findLink(sel);
  if (l && (layout.noSide || (layout.folded || {}).inspector)) {
    layout.noSide = false; if (layout.folded) layout.folded.inspector = false; saveLayout(); applyLayout();
  }
  $('#inspector .empty').hidden = !!l;
  $('#inspector .fields').hidden = !l;
  if (!l) return;
  const target = l.page ? 'page' : 'url';
  $$('[data-target]').forEach(b => b.classList.toggle('on', b.dataset.target === target));
  $('.f-url').hidden = target !== 'url'; $('.f-page').hidden = target !== 'page';
  if (document.activeElement !== $('#l-url')) $('#l-url').value = l.url || '';
  if (document.activeElement !== $('#l-page')) $('#l-page').value = l.page || '';
  if (document.activeElement !== $('#l-code')) $('#l-code').value = l.code || '';
  $('#l-page').max = P.pages.length;
  const o = $('#l-open');
  o.hidden = target !== 'url' || !/^https?:\/\//.test(l.url || '');
  o.href = l.url || '#';
}

// field edits: one undo step per field focus
let fieldBefore = null;
function editField(fn) {
  const l = sel && findLink(sel); if (!l) return;
  if (fieldBefore == null) fieldBefore = snapshot();
  fn(l);
  renderPage(); renderThumbCounts(); changed();
}
['#l-url', '#l-page', '#l-code'].forEach(s => {
  $(s).addEventListener('focus', () => { fieldBefore = null; });
  $(s).addEventListener('blur', () => { if (fieldBefore != null) { pushUndo(fieldBefore); fieldBefore = null; renderCodes(); } });
});
$('#l-url').addEventListener('input', e => editField(l => { l.url = e.target.value.trim(); delete l.page; if (l.auto) l.manual = true; }));
$('#l-page').addEventListener('input', e => editField(l => { const n = parseInt(e.target.value, 10); l.page = n >= 1 && n <= P.pages.length ? n : 0; delete l.url; if (!l.page) delete l.page; }));
$('#l-code').addEventListener('input', e => editField(l => { l.code = e.target.value.trim() || undefined; }));
$$('[data-target]').forEach(b => b.addEventListener('click', () => {
  const l = sel && findLink(sel); if (!l) return;
  pushUndo();
  if (b.dataset.target === 'page') { l.page = l.page || Math.min(cur + 2, P.pages.length); delete l.url; }
  else { delete l.page; l.url = l.url || ''; }
  afterEdit();
  (b.dataset.target === 'page' ? $('#l-page') : $('#l-url')).focus();
}));
$('#l-del').addEventListener('click', () => deleteSel());
$('#l-dup').addEventListener('click', () => duplicateSel());

function deleteSel() {
  const pg = P.pages[cur], i = pg.links.findIndex(l => l.id === sel);
  if (i < 0) return;
  pushUndo(); pg.links.splice(i, 1); sel = null; afterEdit();
}
function duplicateSel() {
  const l = sel && findLink(sel); if (!l) return;
  pushUndo();
  const c = { ...l, id: uid(), x: clamp(l.x + 0.015, 0, 1 - l.w), y: clamp(l.y + 0.015, 0, 1 - l.h), auto: false };
  P.pages[cur].links.push(c); sel = c.id; afterEdit();
}
function nudge(dx, dy) {
  const l = sel && findLink(sel); if (!l) return;
  if (!nudge.t) pushUndo();
  clearTimeout(nudge.t); nudge.t = setTimeout(() => { nudge.t = 0; }, 700);       // a burst of nudges is one undo step
  l.x = clamp(l.x + dx, 0, 1 - l.w); l.y = clamp(l.y + dy, 0, 1 - l.h);
  place(sheet.querySelector(`.box[data-id="${l.id}"]`), l); changed();
}

/* ---------------- auto-linking ---------------- */

function showSettings() {
  const s = P.settings;
  $('#pattern').value = s.pattern; $('#table').value = s.table; $('#template').value = s.template; $('#utm').value = s.utm;
  $('#table-name').textContent = s.tableName || 'CSV, or a Google Merchant / shop product feed';
  $$('[name=source]').forEach(r => { r.checked = r.value === s.source; });
  $('#products').checked = s.products === true;
  $('#product-url').value = s.productUrl || 'first';
  showSource();
}
function showSource() {
  $('.src-table').hidden = P.settings.source !== 'table';
  $('.src-template').hidden = P.settings.source !== 'template';
  $('.src-products').hidden = P.settings.products !== true;
}
$('#pattern').addEventListener('input', e => { P.settings.pattern = e.target.value; e.target.setCustomValidity(codeRegex(e.target.value) ? '' : 'Not a valid pattern'); changed(); });
$('#table').addEventListener('input', e => { P.settings.table = e.target.value; P.settings.tableName = ''; $('#table-name').textContent = 'Pasted list'; changed(); });
$('#template').addEventListener('input', e => { P.settings.template = e.target.value; changed(); });
$('#utm').addEventListener('input', e => { P.settings.utm = e.target.value.trim(); changed(); });
$('#products').addEventListener('change', e => { P.settings.products = e.target.checked; showSource(); changed(); });
$('#product-url').addEventListener('change', e => { P.settings.productUrl = e.target.value; changed(); });
$$('[name=source]').forEach(r => r.addEventListener('change', () => { P.settings.source = r.value; showSource(); changed(); }));
$('#table-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  P.settings.table = await f.text(); P.settings.tableName = f.name;
  $('#table').value = P.settings.table.length > 20000 ? P.settings.table.slice(0, 20000) + '\n…' : P.settings.table;
  $('#table-name').textContent = f.name;
  const n = parseLinkTable(P.settings.table).size;
  toast(n ? `${n} codes with addresses in ${f.name}.` : `No code and address columns found in ${f.name}.`, !n);
  e.target.value = ''; changed();
});

function urlFor(code, table) {
  const s = P.settings;
  let u = P.codeUrls[code];
  if (!u && s.source === 'table') u = table.get(code);
  if (!u && s.source === 'template' && s.template.includes('{code}')) u = s.template.split('{code}').join(encodeURIComponent(code));
  return u ? withUtm(u, s.utm) : '';
}
const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
};

async function runAuto() {
  const re = codeRegex(P.settings.pattern);
  if (!re) { toast('The code pattern isn’t a valid regular expression.', true); return; }
  if (P.settings.source === 'template' && !P.settings.template.includes('{code}')) { toast('Put {code} in the address pattern.', true); $('#template').focus(); return; }
  const table = P.settings.source === 'table' ? parseLinkTable(P.settings.table) : new Map();
  if (P.settings.source === 'table' && !table.size) toast('The list has no codes with addresses yet; codes are boxed so you can fill them in.', true);
  // projects from before shape and picture detection: read the page layout once more
  if (P.pages.some(pg => !pg.shapes)) {
    try {
      busy('Reading the page layout');
      const r = await readPdf(P.pdf, { render: false, onProgress: (i, n) => busy(`Reading page ${Math.min(i + 1, n)} of ${n}`, i / n) });
      r.pages.forEach((rp, i) => { if (P.pages[i]) { P.pages[i].words = rp.words; P.pages[i].images = rp.images || []; P.pages[i].shapes = rp.shapes || []; } });
    } catch (e) { console.error(e); }
    busy(false);
  }
  pushUndo();
  let found = 0, linked = 0, kept = 0, products = 0;
  const productUrl = codes => {
    const first = codes.map(c => urlFor(c, table)).find(Boolean);
    if (!first) return '';
    return P.settings.productUrl === 'strip' ? withUtm(first.split('?')[0].split('#')[0], P.settings.utm) : first;
  };
  const toBox = (pg, b) => {
    const box = { x: clamp(b.x0 / pg.w, 0, 1), y: clamp(b.top / pg.h, 0, 1) };
    box.w = clamp(b.x1 / pg.w, 0, 1) - box.x; box.h = clamp(b.bottom / pg.h, 0, 1) - box.y;
    return box;
  };
  for (const pg of P.pages) {
    // hand-edited auto boxes stay; the rest are placed again
    pg.links = pg.links.filter(l => !l.auto || l.manual);
    const laid = layoutCodes(pg.words, re, pg.shapes, pg.images);
    for (const c of laid) {
      const box = toBox(pg, c.box);
      if (box.w <= 0 || box.h <= 0) continue;
      found++;
      if (pg.links.some(l => overlap(l, box) > 0.5)) { kept++; continue; }      // already linked by hand or in the PDF
      const url = urlFor(c.code, table);
      if (url) linked++;
      pg.links.push({ id: uid(), ...box, kind: c.how === 'swatch' ? 'swatch' : c.how, code: c.code, url, auto: true });
    }
    // the product's name and photo, found next to its colour codes
    if (P.settings.products === true) {
      for (const b of productBlocks(pg.words, laid, pg.images, pg, re)) {
        for (const [kind, r] of [['title', b.title], ['photo', b.photo]]) {
          if (!r) continue;
          const box = toBox(pg, r);
          if (box.w <= 0 || box.h <= 0 || pg.links.some(l => overlap(l, box) > 0.5)) continue;
          pg.links.push({ id: uid(), ...box, kind, product: b.codes[0], url: productUrl(b.codes), auto: true });
          products++;
        }
      }
    }
  }
  P.settings.lastRun = Date.now();
  afterEdit();
  const missing = found - linked - kept;
  $('#result').innerHTML = found
    ? `<span class="ok">${found} codes found</span>, ${linked} linked` + (kept ? `, ${kept} already had a link` : '') +
      (products ? `, ${products} product names and photos linked` : '') +
      (missing ? ` · <span class="warn-t">${missing} need an address</span> (orange boxes)` : '.')
    : 'No codes matching the pattern were found. Check “What a code looks like”.';
  codeFilter = missing ? 'missing' : 'all';
  renderCodes();
}
$('#run').addEventListener('click', runAuto);

/* codes list: every code with a box, its pages, and its address */
function renderCodes() {
  if (!P) return;
  const by = new Map();
  P.pages.forEach((pg, i) => pg.links.forEach(l => {
    if (!l.code) return;
    const c = by.get(l.code) || by.set(l.code, { code: l.code, pages: new Set(), links: [] }).get(l.code);
    c.pages.add(i); c.links.push(l);
  }));
  const all = [...by.values()];
  $('#codes').hidden = !all.length;
  if (!all.length) return;
  const missing = all.filter(c => c.links.some(l => !l.url && !l.page));
  $('#codes-count').textContent = missing.length ? `${missing.length} of ${all.length} need an address` : `${all.length}`;
  $$('[data-filter]').forEach(b => b.classList.toggle('on', b.dataset.filter === codeFilter));
  const show = codeFilter === 'missing' ? missing : all;
  const ul = $('#code-list');
  const focused = document.activeElement && document.activeElement.dataset.code;
  ul.textContent = '';
  if (!show.length) ul.append(el('li', { class: 'none' }, 'Every code has an address.'));
  for (const c of show.slice(0, 500)) {
    const miss = c.links.some(l => !l.url && !l.page);
    const input = el('input', { type: 'url', value: c.links.find(l => l.url)?.url || '', placeholder: 'https://…', 'data-code': c.code, 'aria-label': 'Address for ' + c.code, spellcheck: 'false' });
    let before = null;
    input.addEventListener('focus', () => { before = snapshot(); });
    input.addEventListener('input', () => {
      const v = input.value.trim();
      P.codeUrls[c.code] = v;
      c.links.forEach(l => { if (!l.page) l.url = v; });
      // the product's name and photo follow its first colour
      const pv = P.settings.productUrl === 'strip' ? v.split('?')[0].split('#')[0] : v;
      P.pages.forEach(pg => pg.links.forEach(l => { if (l.product === c.code && !l.manual) l.url = pv; }));
      renderPage(); renderThumbCounts(); changed();
    });
    input.addEventListener('change', () => { if (before) pushUndo(before); before = null; renderCodes(); });
    ul.append(el('li', { class: miss ? 'missing' : '' },
      el('span', { class: 'code' }, c.code),
      el('span', { class: 'pages' }, 'p. ', ...[...c.pages].slice(0, 6).map(i => el('button', { onclick: () => { go(i); select(c.links.find(l => P.pages[i].links.includes(l)).id); } }, String(i + 1)))),
      input));
  }
  if (focused) { const f = ul.querySelector(`[data-code="${CSS.escape(focused)}"]`); f && f.focus(); }
}
$$('[data-filter]').forEach(b => b.addEventListener('click', () => { codeFilter = b.dataset.filter; renderCodes(); }));

/* ---------------- preview ---------------- */

let pv = null;
function openPreview() {
  const data = catalogueData(P, { pdf: null });
  const map = {};
  P.images.pages.forEach((_, i) => { map[`pages/${pad3(i + 1)}.${P.images.type}`] = urls[i]; map[`thumbs/${pad3(i + 1)}.${P.images.type}`] = thumbUrls[i]; });
  if (data.search) { if (pv && pv.searchUrl) URL.revokeObjectURL(pv.searchUrl); map['search.json'] = URL.createObjectURL(new Blob([searchText(P)], { type: 'application/json' })); }
  $('#pv').hidden = false; $('#toast').hidden = true;
  pv = window.Flippy.mount($('#pv-book'), {
    data, resolve: path => map[path] || '', hash: false, setTitle: false, page: cur + 1, pdf: false
  });
}
function closePreview() {
  if (pv) { pv.destroy(); pv = null; }
  $('#pv-book').textContent = '';
  $('#pv').hidden = true;
}
$('#preview').addEventListener('click', openPreview);
$('#pv-close').addEventListener('click', closePreview);

/* ---------------- export ---------------- */

function openExport() {
  const links = P.pages.reduce((s, pg) => s + pg.links.filter(l => l.url || l.page).length, 0);
  const missing = P.pages.reduce((s, pg) => s + pg.links.filter(l => !l.url && !l.page).length, 0);
  $('#ex-summary').textContent = `${P.pages.length} pages, ${links} links.`;
  $('#ex-warn').hidden = !missing;
  $('#ex-warn').textContent = `${missing} box${missing > 1 ? 'es have' : ' has'} no address and will be left out.`;
  $('#ex-folder').value = P.folder || slugify(P.title);
  snippet();
  $('#ex').showModal();
}
function snippet() {
  const f = slugify($('#ex-folder').value);
  $('#ex-snippet').textContent = server
    ? `<script src="${server.siteUrl}/dist/flippy.min.js"></script>\n<flip-book src="${server.siteUrl}/c/${f}/"></flip-book>`
    : `<script src="https://cdn.jsdelivr.net/gh/Bepce/flippy@v0.4.0/dist/flippy.min.js"></script>\n<flip-book src="/catalogues/${f}/"></flip-book>`;
}
$('#ex-folder').addEventListener('input', snippet);
$('#ex-folder').addEventListener('change', e => { P.folder = slugify(e.target.value); e.target.value = P.folder; snippet(); changed(); });
$('#ex-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#ex-snippet').textContent); toast('Copied.'); } catch (e) { toast('Couldn’t copy; select the text instead.', true); }
});
function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
$('#ex-zip').addEventListener('click', async () => {
  P.folder = slugify($('#ex-folder').value); $('#ex-folder').value = P.folder;
  $('#ex').close();
  try {
    busy('Exporting', 0.2);
    const { blob, folder } = await exportZip(P, step => busy(step, step.startsWith('Pack') ? 0.7 : 0.3));
    busy(false);
    download(blob, folder + '.zip');
    saveNow();
    toast(`${folder}.zip is ready (${(blob.size / 1048576).toFixed(1)} MB).`);
  } catch (e) { busy(false); console.error(e); toast('Export failed: ' + e.message, true); }
});
$('#ex-pdf').addEventListener('click', async () => {
  $('#ex').close();
  try {
    busy('Writing links into the PDF', 0.4);
    const bytes = await linkedPdf(P);
    busy(false);
    download(new Blob([bytes], { type: 'application/pdf' }), (P.folder || slugify(P.title)) + '.pdf');
  } catch (e) { busy(false); console.error(e); toast('Export failed: ' + e.message, true); }
});
$('#export').addEventListener('click', openExport);

/* ---------------- flippy server: publish, and open catalogues from it ---------------- */

let server = null;          // the server's /api/me when the builder is served by a flippy server

async function detectServer() {
  try {
    const r = await fetch('../api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const d = r.ok ? await r.json() : null;
    if (d && d.flippyServer) server = d;
  } catch (e) { /* not on a server: the builder works on its own */ }
  if (!server) return;
  $('.actions').prepend(el('a', { class: 'btn ghost', href: '../admin/', title: 'Back to the catalogue library' }, 'Library'));
  const site = server.site || 'your site';
  if (server.user) {
    const pub = el('button', { id: 'ex-publish', class: 'primary', type: 'button' }, 'Publish to ' + site);
    pub.addEventListener('click', publish);
    $('.ex-buttons').prepend(pub);
    $('#ex-zip').className = 'ghost';
    $('#ex-zip').textContent = 'Download zip';
    $('.how summary').textContent = 'Using it on your website';
    $('.how ol').replaceChildren(
      el('li', {}, 'Publish, then open the catalogue in the library for its link and statistics.'),
      el('li', {}, 'To show it inside a page of your website:', el('pre', { id: 'ex-snippet' }), $('#ex-copy')));
  } else {
    $('.ex-buttons').append(el('a', { class: 'btn ghost', href: '../admin/' }, 'Sign in to publish'));
  }
}

async function publish() {
  P.folder = slugify($('#ex-folder').value); $('#ex-folder').value = P.folder;
  $('#ex').close();
  const folder = P.folder;
  try {
    busy('Preparing the catalogue', 0.2);
    const { blob } = await exportZip(P, step => busy(step, step.startsWith('Pack') ? 0.5 : 0.3));
    if (server.maxUploadMb && blob.size > server.maxUploadMb * 1048576) {
      throw new Error(`The catalogue is ${(blob.size / 1048576).toFixed(0)} MB; the server accepts up to ${server.maxUploadMb} MB.`);
    }
    const send = async replace => {
      busy('Uploading to ' + (server.site || 'the site'), 0.75);
      const fd = new FormData();
      fd.append('zip', blob, folder + '.zip'); fd.append('slug', folder); fd.append('replace', replace ? '1' : '0');
      const r = await fetch('../api/catalogues', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': server.csrf } });
      let d = null; try { d = await r.json(); } catch (e) { /* not json */ }
      return { r, d };
    };
    let { r, d } = await send(P.server && P.server.slug === folder);
    if (r.status === 409) {
      busy(false);
      if (!confirm(`The site already has a catalogue at “${folder}”. Replace it with this one?\n\nCancel to change the folder name instead.`)) { openExport(); $('#ex-folder').focus(); return; }
      ({ r, d } = await send(true));
    }
    if (r.status === 401) throw new Error('You’ve been signed out. Sign in to the admin in another tab, then publish again.');
    if (!r.ok) throw new Error((d && d.error) || 'The server answered ' + r.status + '.');
    busy(false);
    P.server = { slug: d.catalogue.slug, url: d.catalogue.url, published: Date.now() };
    saveNow();
    toast(`Published: ${d.catalogue.url}`);
  } catch (e) { busy(false); console.error(e); toast('Publishing failed: ' + e.message, true); }
}

async function openFromServer(slug) {
  try {
    busy('Downloading ' + slug, 0.1);
    const r = await fetch('../api/catalogues/' + encodeURIComponent(slug) + '/zip', { credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status === 401 ? 'Sign in to the admin first.' : 'The catalogue couldn’t be downloaded (' + r.status + ').');
    await importZip(new File([await r.blob()], slug + '.zip'));
    P.folder = slug;
    P.server = { slug };
    saveNow();
  } catch (e) { busy(false); toast(e.message, true); showStart(); }
}

/* ---------------- small UI ---------------- */

function busy(text, frac) {
  $('#busy').hidden = text === false;
  if (text === false) return;
  $('#busy-text').textContent = text;
  $('#busy-bar').style.width = (frac == null ? 5 : Math.round(frac * 100)) + '%';
}
let toastT = 0;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.toggle('bad', !!bad);
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3500);
}

$('#file').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
$('#demo').addEventListener('click', loadDemo);
const drop = $('#drop');
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } });
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }));
document.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (!f) return;
  if (P && !/\.(pdf|zip)$/i.test(f.name)) return;
  if (P && !confirm('Open ' + f.name + '? The current project stays saved in this browser.')) return;
  openFile(f);
});

$('#title').addEventListener('input', e => { P.title = e.target.value; document.title = P.title + ' · flippy builder'; changed(); });
$('#prev').addEventListener('click', () => go(cur - 1));
$('#next').addEventListener('click', () => go(cur + 1));
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$$('[data-zoom]').forEach(b => b.addEventListener('click', () => setZoom(b.dataset.zoom)));
$('#zoom').addEventListener('input', e => setZoom('custom', e.target.value / 100));
$('#zoom-in').addEventListener('click', () => setZoom('custom', zoomFactor * 1.25));
$('#zoom-out').addEventListener('click', () => setZoom('custom', zoomFactor / 1.25));
// Ctrl + scroll (and pinch on a trackpad, which browsers send the same way)
stage.addEventListener('wheel', e => {
  if (!P || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom('custom', zoomFactor * Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
}, { passive: false });
window.addEventListener('resize', layoutSheet);
// the logo leads home: the library when the builder runs on a flippy server, else the start screen
$('.brand').addEventListener('click', async e => {
  e.preventDefault();
  if (server) { await saveNow(); location.href = '../admin/'; return; }
  history.replaceState(null, '', location.pathname); showStart();
});

// layout preferences: side bars shown or hidden, panels folded (remembered in this browser)
const LAYOUT_KEY = 'flippy-builder-layout';
let layout = {};
try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (e) { layout = {}; }
const saveLayout = () => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) { /* private mode */ } };
function applyLayout() {
  $('#editor').classList.toggle('no-thumbs', !!layout.noThumbs);
  $('#editor').classList.toggle('no-side', !!layout.noSide);
  $('#toggle-thumbs').setAttribute('aria-pressed', String(!layout.noThumbs));
  $('#toggle-side').setAttribute('aria-pressed', String(!layout.noSide));
  $$('.side .panel').forEach(p => {
    const f = !!(layout.folded || {})[p.id];
    p.classList.toggle('folded', f);
    p.querySelector('h2').setAttribute('aria-expanded', String(!f));
  });
  layoutSheet();
}
$('#toggle-thumbs').addEventListener('click', () => { layout.noThumbs = !layout.noThumbs; saveLayout(); applyLayout(); });
$('#toggle-side').addEventListener('click', () => { layout.noSide = !layout.noSide; saveLayout(); applyLayout(); });
$$('.side .panel > h2').forEach(h => {
  h.classList.add('fold'); h.tabIndex = 0; h.setAttribute('role', 'button');
  const flip = () => { layout.folded = layout.folded || {}; const id = h.parentElement.id; layout.folded[id] = !layout.folded[id]; saveLayout(); applyLayout(); };
  h.addEventListener('click', e => { if (!e.target.closest('.seg')) flip(); });
  h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
});
applyLayout();

document.addEventListener('keydown', e => {
  if (!P || !$('#pv').hidden || $('#ex').open) { if (e.key === 'Escape' && !$('#pv').hidden) closePreview(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom('custom', zoomFactor * 1.25); return; }
  if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); setZoom('custom', zoomFactor / 1.25); return; }
  if (mod && e.key === '0') { e.preventDefault(); setZoom('page'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteSel(); } return; }
  if (e.key === 'Escape') { select(null); return; }
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !sel)) { e.preventDefault(); go(cur + 1); return; }
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !sel)) { e.preventDefault(); go(cur - 1); return; }
  if (sel && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const s = e.shiftKey ? 0.01 : 0.001;
    nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
  }
});
window.addEventListener('beforeunload', () => { if (P) store.save(P); });

// open the project named in the address (#id), else the start screen
(async () => {
  await detectServer();
  const open = new URLSearchParams(location.search).get('open');
  if (open && server && server.user) { await openFromServer(open); return; }
  const id = location.hash.slice(1);
  if (id) { try { const p = await store.load(id); if (p) { openProject(p); return; } } catch (e) { /* fall through */ } }
  showStart();
})();

// for tests and the curious
window.flippyBuilder = { get project() { return P; }, runAuto, openFile, exportZip: () => exportZip(P) };
