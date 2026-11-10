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
        out.push({ text: part, x0: tx[4] + i * cw, x1: tx[4] + (i + part.length) * cw, top, bottom, size: h });
      }
      i += part.length;
    }
  }
  return out;
}

// Place a box around each code. Returns [{code, how, box:{x0,top,x1,bottom}}]
export function layoutCodes(words, codeRe) {
  const isCode = w => codeRe.test(w.text);
  const codes = words.filter(isCode);
  const laid = [];
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
    } else if (inText) {                                    // mentioned in a sentence
      laid.push({ w, how: 'text', box: { x0: w.x0 - 2, top: w.top - 2, x1: w.x1 + 2, bottom: w.bottom + 2 } });
    } else {                                                // swatch: colour above, name below
      const cx = (w.x0 + w.x1) / 2;
      const gaps = codes.filter(u => u !== w && Math.abs(u.top - w.top) < 4).map(u => Math.abs((u.x0 + u.x1) / 2 - cx));
      const half = Math.min(19, ...gaps.map(g => g / 2 - 3.5));
      const above = codes.filter(u => u !== w && u.top < w.top - 4 && Math.abs((u.x0 + u.x1) / 2 - cx) < 2 * half)
        .map(u => u.bottom + 20).filter(b => b < w.top);
      const top = Math.max(w.top - 33, ...above.map(b => b + 1));
      laid.push({ w, how: 'swatch', box: { x0: cx - half, top, x1: cx + half, bottom: w.bottom + 20 } });
    }
  }
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
