// Reading a PDF in the browser: page images, words and the links already in it.
import { wordsFromText } from './linker.js';

const PDFJS_ROOT = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/';
export const PDFJS = PDFJS_ROOT + 'build/';
// decoders and data pdf.js loads on demand: JPEG 2000 and JBIG2 images (common in print PDFs),
// colour profiles, fonts that aren't embedded, and character maps for CJK text
const PDF_OPTIONS = {
  wasmUrl: PDFJS_ROOT + 'wasm/',
  iccUrl: PDFJS_ROOT + 'iccs/',
  standardFontDataUrl: PDFJS_ROOT + 'standard_fonts/',
  cMapUrl: PDFJS_ROOT + 'cmaps/',
  cMapPacked: true
};
let lib = null;
export async function pdfjs() {
  if (!lib) {
    lib = await import(PDFJS + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  }
  return lib;
}

const PAGE_H = 1600, THUMB_H = 300;

// canvas -> Blob, WebP where the browser can make it (Safari can't), otherwise JPEG
function toBlob(canvas, type) {
  return new Promise(res => canvas.toBlob(res, 'image/' + type, 0.86));
}
async function encode(canvas, prefer) {
  if (prefer === 'webp') {
    const b = await toBlob(canvas, 'webp');
    if (b && b.type === 'image/webp') return { blob: b, type: 'webp' };
  }
  return { blob: await toBlob(canvas, 'jpeg'), type: 'jpg' };
}

function shrink(src, h) {
  const c = document.createElement('canvas');
  c.height = h; c.width = Math.round(src.width * h / src.height);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// bytes: Uint8Array of the PDF. onProgress(done, total, stage).
// Returns { pageCount, pages: [{ w, h, words, links }], images: { type, pages: [Blob], thumbs: [Blob] }, title }
export async function readPdf(bytes, { render = true, onProgress = () => {} } = {}) {
  const pdf = await pdfjs();
  const task = pdf.getDocument({ data: bytes.slice(), isEvalSupported: false, ...PDF_OPTIONS });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => null);
  const n = doc.numPages, pages = [], imgs = [], thumbs = [];
  let type = 'webp';
  for (let i = 1; i <= n; i++) {
    onProgress(i - 1, n, 'page');
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });                 // 1 unit = 1 PDF point, origin top-left
    const text = await page.getTextContent();
    const words = wordsFromText(text.items, vp, pdf.Util);
    const links = [];
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Link' || !a.rect) continue;
      const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
      const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const box = { x: Math.min(x1, x2) / vp.width, y: Math.min(y1, y2) / vp.height,
        w: Math.abs(x2 - x1) / vp.width, h: Math.abs(y2 - y1) / vp.height };
      if (a.url || a.unsafeUrl) links.push({ ...box, kind: 'link', url: a.url || a.unsafeUrl, from: 'pdf' });
      else if (a.dest) {
        const target = await destPage(doc, a.dest);
        if (target) links.push({ ...box, kind: 'link', page: target, from: 'pdf' });
      }
    }
    const pg = { w: vp.width, h: vp.height, words, links };
    pages.push(pg);
    if (render) {
      const scale = PAGE_H / vp.height;
      const view = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(view.width); c.height = Math.round(view.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: view }).promise;
      const big = await encode(c, type);
      type = big.type;                                          // keep one format for the whole catalogue
      imgs.push(big.blob);
      thumbs.push((await encode(shrink(c, THUMB_H), type)).blob);
      c.width = c.height = 0;
    }
    // where the pictures are, and which words are bold (fonts are loaded by now)
    try {
      const ops = await page.getOperatorList();
      pg.images = pageImages(ops, pdf, vp);
      const bold = {};
      for (const w of words) {
        if (!(w.font in bold)) {
          let name = '';
          try { name = page.commonObjs.has(w.font) ? (page.commonObjs.get(w.font).name || '') : ''; } catch (e) { /* not loaded */ }
          bold[w.font] = /bold|black|heavy|semibold|demi/i.test(name);
        }
        if (bold[w.font]) w.bold = true;
        delete w.font;
      }
    } catch (e) { console.warn("[flippy] layout", e); pg.images = []; }
    page.cleanup();
  }
  onProgress(n, n, 'done');
  const title = (meta && meta.info && meta.info.Title) || '';
  await task.destroy();
  return { pageCount: n, pages, title, images: render ? { type, pages: imgs, thumbs } : null };
}

// Bounding boxes of the images drawn on a page, in points from the top-left, cut to their
// clipping frames (InDesign places photos in frames, often larger than what shows).
function pageImages(ops, pdf, vp) {
  const { OPS, Util } = pdf;
  const out = [], stack = [];
  let ctm = [1, 0, 0, 1, 0, 0], clip = null, pendingClip = false;
  const rect = (m, x0, y0, x1, y1) => {
    const t = Util.transform(vp.transform, m);
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), top: Math.min(...ys), x1: Math.max(...xs), bottom: Math.max(...ys) };
  };
  const cut = (a, b) => {
    if (!b) return a;
    const r = { x0: Math.max(a.x0, b.x0), top: Math.max(a.top, b.top), x1: Math.min(a.x1, b.x1), bottom: Math.min(a.bottom, b.bottom) };
    return r.x1 > r.x0 && r.bottom > r.top ? r : null;
  };
  const paints = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter(Boolean));
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push([ctm, clip]);
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) [ctm, clip] = s; }
    else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, clip]); if (a && a[0]) ctm = Util.transform(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, clip] = s; }
    else if (fn === OPS.clip || fn === OPS.eoClip) pendingClip = true;
    else if (fn === OPS.constructPath) {
      const mm = a && a[2];
      if (pendingClip && mm && isFinite(mm[0])) clip = cut(rect(ctm, mm[0], mm[1], mm[2], mm[3]), clip) || { x0: 0, top: 0, x1: 0, bottom: 0 };
      pendingClip = false;
    } else if (paints.has(fn)) {
      const r = cut(rect(ctm, 0, 0, 1, 1), clip);
      if (r) out.push(r);
    }
  }
  return out;
}

async function destPage(doc, dest) {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!d || !d[0]) return 0;
    if (typeof d[0] === 'number') return d[0] + 1;
    return (await doc.getPageIndex(d[0])) + 1;
  } catch (e) { return 0; }
}
