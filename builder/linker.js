// Finding product codes on a page and placing link boxes around them.
// Same rules as tools/add_links.py (minus drawn-shape detection, which needs the PDF's
// vector paths; the editor is there to adjust a box that comes out too big or small).
//
// Coordinates here are PDF points with the origin top-left of the page (as shown).

// One text item from pdf.js -> words with positions
export function wordsFromText(items, viewport, Util) {
  const out = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = Util.transform(viewport.transform, it.transform);
    if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue;      // rotated text: not a code label
    const h = Math.hypot(tx[2], tx[3]);
    const width = it.width * viewport.scale;
    const cw = width / it.str.length;
    const top = tx[5] - h * 0.85, bottom = tx[5] + h * 0.2;
    let i = 0;
    for (const part of it.str.split(/(\s+)/)) {
      if (part && !/^\s+$/.test(part)) {
        out.push({ text: part, x0: tx[4] + i * cw, x1: tx[4] + (i + part.length) * cw, top, bottom, size: h, font: it.fontName });
      }
      i += part.length;
    }
  }
  return out;
}

// Place a box around each code. Returns [{code, how, box:{x0,top,x1,bottom}}]
export function layoutCodes(words, codeRe, shapes, images) {
  const isCode = w => codeRe.test(w.text);
  const codes = words.filter(isCode);
  const laid = [];
  let lab;
  for (const w of codes) {
    const lineH = w.bottom - w.top;
    const column = codes.filter(u => u !== w && Math.abs(u.x0 - w.x0) < 3 && Math.abs(u.top - w.top) > 0 && Math.abs(u.top - w.top) < 2.5 * lineH);
    const line = words.filter(u => u !== w && Math.abs(u.top - w.top) < 2.5 && !isCode(u));
    const inText = line.some(u => (w.x0 - u.x1 >= 0 && w.x0 - u.x1 < 8) || (u.x0 - w.x1 >= 0 && u.x0 - w.x1 < 8));
    if (column.length) {                                    // list / table row
      const step = Math.min(...column.map(u => Math.abs(u.top - w.top)));
      let x1 = w.x1;
      for (const u of line.slice().sort((a, b) => a.x0 - b.x0)) {
        if (u.x0 >= x1 - 1 && u.x0 - x1 < 120) x1 = u.x1;
      }
      const mid = (w.top + w.bottom) / 2, hh = step / 2 - 1;
      laid.push({ w, how: 'row', box: { x0: w.x0 - 3, top: mid - hh, x1: x1 + 3, bottom: mid + hh } });
    } else if (!inText && (lab = labelAbove(w, words, isCode))) {   // a name printed right above the code
      laid.push({ w, how: 'label', box: lab });
    } else if (inText) {                                    // mentioned in a sentence
      laid.push({ w, how: 'text', box: { x0: w.x0 - 2, top: w.top - 2, x1: w.x1 + 2, bottom: w.bottom + 2 } });
    } else {                                                // swatch: colour above, name below
      laid.push({ w, how: 'swatch', sw: swatchParts(w, words, codes, shapes, isCode, images) });
    }
  }
  fitSwatches(laid.filter(l => l.how === 'swatch'));
  // rows of one list share the widest row's width
  const cols = new Map();
  laid.forEach((l, k) => { if (l.how === 'row') { const key = Math.round(l.w.x0); (cols.get(key) || cols.set(key, []).get(key)).push(k); } });
  for (const ks of cols.values()) {
    const right = Math.max(...ks.map(k => laid[k].box.x1));
    ks.forEach(k => { laid[k].box.x1 = right; });
  }
  // a code inside a sentence is skipped when the same code also has its own box
  const boxed = new Set(laid.filter(l => l.how !== 'text').map(l => l.w.text));
  return laid.filter(l => !(l.how === 'text' && boxed.has(l.w.text))).map(l => ({ code: l.w.text, how: l.how, box: l.box }));
}

// The pieces of one swatch: the colour (a filled shape or small picture right above the code),
// the code, and the colour name under it (up to two short lines).
function swatchParts(w, words, codes, shapes, isCode, images) {
  const cx = (w.x0 + w.x1) / 2, lineH = w.bottom - w.top;
  let shape = null;
  // a product photo the code sits under (or on the bottom edge of): the whole photo is the link
  let photo = null;
  for (const p of images || []) {
    const pw = p.x1 - p.x0, pcx = (p.x0 + p.x1) / 2;
    if (pw < 30 || pw > 300 || Math.abs(pcx - cx) > pw * 0.3) continue;
    if (p.top > w.top - lineH * 2 || p.bottom < w.top - lineH * 3 || p.bottom > w.bottom + lineH * 3) continue;
    if (!photo || p.bottom > photo.bottom) photo = p;
  }
  for (const s of shapes || []) {
    const sw = s.x1 - s.x0, scx = (s.x0 + s.x1) / 2;
    if (s.bottom > w.top + 2 || w.top - s.bottom > Math.max(30, lineH * 3) || Math.abs(scx - cx) > Math.max(sw * 0.3, 4) || sw > 140) continue;
    // the nearest one above; of shapes stacked on the same spot (a ring around a dot), the biggest
    if (!shape || s.bottom > shape.bottom + 3 || (Math.abs(s.bottom - shape.bottom) <= 3 && sw > shape.x1 - shape.x0)) shape = s;
  }
  const name = [];
  let ref = w;
  for (let k = 0; k < 2; k++) {
    const line = words.filter(u => !isCode(u) && u.top >= ref.bottom - 2 && u.top - ref.bottom < lineH * 0.9 &&
      Math.abs((u.x0 + u.x1) / 2 - cx) < Math.max(30, (u.x1 - u.x0) / 2 + 6));
    if (!line.length) break;
    const l = { x0: Math.min(...line.map(u => u.x0)), x1: Math.max(...line.map(u => u.x1)), top: Math.min(...line.map(u => u.top)), bottom: Math.max(...line.map(u => u.bottom)) };
    name.push(l); ref = l;
  }
  // a dot or square right above the code wins; otherwise the photo above it
  if (!shape && photo) shape = photo;
  const parts = [w, ...(shape ? [shape] : []), ...name];
  return {
    cx, shape,
    top: shape ? Math.min(shape.top, w.top) : w.top - Math.max(26, lineH * 3),
    bottom: name.length ? name[name.length - 1].bottom : w.bottom,
    half: Math.max(...parts.map(p => Math.max(cx - p.x0, p.x1 - cx)))
  };
}

// Boxes for a page's swatches: just around the colour and its name, the same width along a row,
// and an even gap between neighbours, so nothing overlaps.
function fitSwatches(list) {
  const PAD = 3, GAP = 4;
  // rows: swatches whose codes share a line
  const rows = [];
  for (const l of list.slice().sort((a, b) => a.w.top - b.w.top || a.sw.cx - b.sw.cx)) {
    const r = rows.find(r => Math.abs(r[0].w.top - l.w.top) < 4);
    r ? r.push(l) : rows.push([l]);
  }
  for (const row of rows) {
    row.sort((a, b) => a.sw.cx - b.sw.cx);
    const want = Math.max(...row.map(l => l.sw.half)) + PAD;
    let room = Infinity;
    for (let i = 1; i < row.length; i++) {
      const d = row[i].sw.cx - row[i - 1].sw.cx;
      if (d < 200) room = Math.min(room, (d - GAP) / 2);
    }
    const half = Math.max(8, Math.min(want, room));
    for (const l of row) l.box = { x0: l.sw.cx - half, top: l.sw.top - PAD, x1: l.sw.cx + half, bottom: l.sw.bottom + PAD };
  }
  // rows stacked above each other: the upper box ends a gap above the lower one
  for (const a of list) for (const b of list) {
    if (a === b || a.box.top >= b.box.top) continue;
    const xo = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
    if (xo > 0 && a.box.bottom > b.box.top - GAP) a.box.bottom = Math.max(a.box.top + 8, b.box.top - GAP);
  }
}

// Up to three short lines directly above a code, starting at the same left edge
// ("AERIAL PRO LADY / Butterfly Whisper / 560018"): name and code become one box.
function labelAbove(code, words, isCode) {
  const lineH = code.bottom - code.top;
  const lineAt = start => {
    const ws = words.filter(u => Math.abs(u.top - start.top) < 2 && u.x0 >= start.x0 - 1).sort((a, b) => a.x0 - b.x0);
    const out = [start];
    for (const u of ws) { if (u === start) continue; const last = out[out.length - 1]; if (u.x0 - last.x1 < 2 * u.size && u.x0 > last.x0) out.push(u); }
    return { words: out, x0: start.x0, x1: Math.max(...out.map(u => u.x1)), top: Math.min(...out.map(u => u.top)), bottom: Math.max(...out.map(u => u.bottom)),
      text: out.map(u => u.text).join(' ') };
  };
  const lines = [];
  let ref = code;
  for (let k = 0; k < 3; k++) {
    // the next line up: starts within a few points of the code's left edge, just above the line before
    const start = words.filter(u => !isCode(u) && Math.abs(u.x0 - code.x0) < 4 && u.bottom <= ref.top + 1 && ref.top - u.bottom < Math.max(lineH, u.size) * 0.9)
      .sort((a, b) => b.bottom - a.bottom)[0];
    if (!start) break;
    const line = lineAt(start);
    if (line.text.length > 45 || line.words.some(isCode)) break;
    lines.push(line);
    ref = line;
  }
  if (!lines.length) return null;
  return {
    x0: Math.min(code.x0, ...lines.map(l => l.x0)) - 3, top: Math.min(...lines.map(l => l.top)) - 3,
    x1: Math.max(code.x1, ...lines.map(l => l.x1)) + 3, bottom: code.bottom + 3
  };
}

// "^...$" around the user's pattern, so the whole word has to match
export function codeRegex(pattern) {
  try { return new RegExp('^(?:' + pattern + ')$'); } catch (e) { return null; }
}

// CSV / TSV / Google Merchant feed -> Map(code -> url)
export function parseLinkTable(text) {
  const map = new Map();
  if (/<rss|<feed|<item[\s>]|<entry[\s>]/i.test(text.slice(0, 2000))) {        // XML product feed
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const items = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
    for (const it of items) {
      const get = names => { for (const n of names) { const el = it.getElementsByTagName(n)[0]; if (el && el.textContent.trim()) return el.textContent.trim(); } return ''; };
      const link = get(['g:link', 'link']) || (it.querySelector('link[href]') || {}).getAttribute?.('href') || '';
      for (const c of [get(['g:id', 'id']), get(['g:mpn', 'mpn']), get(['g:gtin', 'gtin']), get(['g:sku', 'sku'])]) {
        if (c && link && !map.has(c)) map.set(c, link);
      }
    }
    return map;
  }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return map;
  const sep = (lines[0].match(/\t/g) || []).length > (lines[0].match(/;/g) || []).length
    ? '\t' : ((lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',');
  const split = l => { const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map(s => s.trim()); };
  let head = split(lines[0]).map(h => h.toLowerCase());
  let ci = head.findIndex(h => /^(code|sku|id|article|art|mpn|product.?code|item)$/.test(h));
  let ui = head.findIndex(h => /^(url|link|href|product.?url|address)$/.test(h));
  let start = 1;
  if (ci < 0 || ui < 0) { ci = 0; ui = 1; start = /^https?:/i.test(split(lines[0])[1] || '') ? 0 : 1; }
  for (const l of lines.slice(start)) {
    const r = split(l);
    if (r[ci] && r[ui] && /^https?:\/\//i.test(r[ui])) map.set(r[ci], r[ui]);
  }
  return map;
}

export function withUtm(url, campaign) {
  if (!url || !campaign) return url;
  return url + (url.includes('?') ? '&' : '?') + 'utm_source=catalogue&utm_medium=flipbook&utm_campaign=' + encodeURIComponent(campaign);
}

// Product blocks: each group of colour swatches is one product. Its name is the nearest bold
// (or larger) line above the swatches, in the same column; its photo is the nearest picture.
// laid: layoutCodes() output; images: picture boxes on the page; pg: { w, h }.
// Returns [{ codes: [...], title: box|null, photo: box|null }]
export function productBlocks(words, laid, images, pg, codeRe) {
  const sw = laid.filter(l => l.how === 'swatch');
  if (!sw.length) return [];
  // group swatches: side by side on one row, or rows stacked closely
  const parent = sw.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sw.length; i++) for (let j = i + 1; j < sw.length; j++) {
    const a = sw[i].box, b = sw[j].box, w = Math.max(a.x1 - a.x0, b.x1 - b.x0), h = Math.max(a.bottom - a.top, b.bottom - b.top);
    const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), gapY = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
    const sameRow = Math.abs(a.top - b.top) < 6 && gapX < 1.5 * w;
    const stacked = gapY >= -2 && gapY < 0.6 * h && gapX < 0.5 * w;
    if (sameRow || stacked) parent[find(i)] = find(j);
  }
  const groups = new Map();
  sw.forEach((s, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(s); });

  const area = r => (r.x1 - r.x0) * (r.bottom - r.top);
  const pageArea = pg.w * pg.h;
  // pictures: on the page, not tiny (icons, swatch dots), not the whole page (backgrounds)
  const pics = (images || []).map(r => ({ x0: Math.max(0, r.x0), top: Math.max(0, r.top), x1: Math.min(pg.w, r.x1), bottom: Math.min(pg.h, r.bottom) }))
    .filter(r => r.x1 > r.x0 && r.bottom > r.top && area(r) > pageArea * 0.02 && area(r) < pageArea * 0.7);
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)) + Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

  // lines of text, each in one size and weight
  // the body text size: the one most of the page's text is set in
  const bySize = new Map();
  for (const w of words) { const k = Math.round(w.size * 2) / 2; bySize.set(k, (bySize.get(k) || 0) + w.text.length); }
  const median = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const lines = [];
  for (const w of words.slice().sort((a, b) => a.top - b.top || a.x0 - b.x0)) {
    if (codeRe.test(w.text)) continue;
    const l = lines.find(l => Math.abs(l.top - w.top) < 2 && Math.abs(l.size - w.size) < 0.5 && !!l.bold === !!w.bold && w.x0 - l.x1 < 2.5 * w.size && w.x0 >= l.x0 - 1);
    if (l) { l.x1 = Math.max(l.x1, w.x1); l.bottom = Math.max(l.bottom, w.bottom); l.text += ' ' + w.text; }
    else lines.push({ x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom, size: w.size, bold: w.bold, text: w.text });
  }
  // a name: bold or larger than the body text, with at least four letters (not a "NEW" badge)
  const heading = l => (l.bold || l.size >= median * 1.2) && (l.text.match(/\p{L}/gu) || []).length >= 4;
  const inside = (l, b) => l.x1 > b.x0 && l.x0 < b.x1 && l.bottom > b.top && l.top < b.bottom;

  const out = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.box.top - b.box.top || a.box.x0 - b.box.x0);
    const gb = { x0: Math.min(...g.map(s => s.box.x0)), top: Math.min(...g.map(s => s.box.top)), x1: Math.max(...g.map(s => s.box.x1)), bottom: Math.max(...g.map(s => s.box.bottom)) };
    const colW = Math.max(gb.x1 - gb.x0, pg.w * 0.25);
    // name: nearest heading line above the swatches, starting in the same column
    let title = null;
    // the name is already inside the code's own box (a label right above the code): nothing to add
    const own = lines.some(l => heading(l) && inside(l, gb));
    for (const l of own ? [] : lines) {
      if (!heading(l) || l.bottom > gb.top + 2 || gb.top - l.bottom > pg.h * 0.45) continue;
      if (l.x0 < gb.x0 - colW * 0.35 || l.x0 > gb.x0 + colW * 0.6) continue;
      if (!title || l.bottom > title.bottom) title = l;
    }
    // photo: a nearby picture, preferring big ones beside or above the colours (pictures below
    // them are usually close-ups of details)
    let photo = null, best = Infinity;
    for (const r of pics) {
      if (gap(r, gb) === 0 && area(r) < area(gb) * 3) continue;        // a picture behind the swatches themselves
      const d = gap(r, gb);
      if (d > Math.max(pg.w, pg.h) * 0.2) continue;
      const score = d + (r.top >= gb.bottom - 2 ? 60 : 0) - 0.5 * Math.sqrt(area(r));
      if (score < best) { best = score; photo = r; }
    }
    out.push({
      codes: g.map(s => s.code),
      title: title && { x0: title.x0 - 3, top: title.top - 3, x1: title.x1 + 3, bottom: title.bottom + 3 },
      photo
    });
  }
  // colour rows under one name are one product
  const merged = [];
  for (const b of out) {
    const same = b.title && merged.find(m => m.title && Math.abs(m.title.top - b.title.top) < 1 && Math.abs(m.title.x0 - b.title.x0) < 1);
    if (same) { same.codes.push(...b.codes); same.photo = same.photo || b.photo; }
    else merged.push(b);
  }
  // a picture shared by several products links to none of them
  const uses = new Map();
  merged.forEach(b => { if (b.photo) uses.set(b.photo, (uses.get(b.photo) || 0) + 1); });
  merged.forEach(b => { if (b.photo && uses.get(b.photo) > 1) b.photo = null; });
  return merged;
}
