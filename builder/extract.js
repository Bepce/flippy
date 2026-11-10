// Reading a PDF in the browser: page images, words and the links already in it.
import { wordsFromText } from './linker.js';

export const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/';
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
  const task = pdf.getDocument({ data: bytes.slice(), isEvalSupported: false });
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
    pages.push({ w: vp.width, h: vp.height, words, links });
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
    page.cleanup();
  }
  onProgress(n, n, 'done');
  const title = (meta && meta.info && meta.info.Title) || '';
  await task.destroy();
  return { pageCount: n, pages, title, images: render ? { type, pages: imgs, thumbs } : null };
}

async function destPage(doc, dest) {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!d || !d[0]) return 0;
    if (typeof d[0] === 'number') return d[0] + 1;
    return (await doc.getPageIndex(d[0])) + 1;
  } catch (e) { return 0; }
}
