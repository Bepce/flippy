// Turning a project into a catalogue folder: catalogue.json/.js, page images, and the PDF
// with the links written into it (so it works in any PDF reader too).
import { zip } from './zip.js';

const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js';
export const VIEWER_CDN = 'https://cdn.jsdelivr.net/gh/Bepce/flippy@v0.3.0/dist/';

const r4 = v => Math.round(v * 10000) / 10000;
const pad3 = n => String(n).padStart(3, '0');

export function slugify(s) {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'catalogue';
}

// The viewer's catalogue.json
export function catalogueData(p, { pdf = 'catalogue.pdf' } = {}) {
  const first = p.pages[0];
  const data = {
    title: p.title || 'Catalogue',
    pdf: pdf || undefined,
    aspect: r4(first.w / first.h),
    pageCount: p.pages.length,
    pages: p.pages.map((pg, i) => ({
      n: i + 1,
      links: pg.links.filter(l => l.url || l.page).map(l => {
        const o = { x: r4(l.x), y: r4(l.y), w: r4(l.w), h: r4(l.h), kind: l.kind || 'link' };
        if (l.page) o.page = l.page; else o.url = l.url;
        return o;
      })
    }))
  };
  if (p.images.type !== 'webp') data.images = p.images.type;
  return data;
}

// The original PDF with its link annotations replaced by the project's links
export async function linkedPdf(p) {
  const { PDFDocument, PDFName, PDFString, PDFArray } = await import(PDFLIB);
  const doc = await PDFDocument.load(p.pdf, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const pg = p.pages[i];
    if (!pg) return;
    const annots = page.node.Annots();
    const keep = doc.context.obj([]);
    if (annots) {
      for (let k = 0; k < annots.size(); k++) {
        const a = annots.lookup(k);
        const sub = a && a.get && a.get(PDFName.of('Subtype'));
        if (!(sub && sub.toString() === '/Link')) keep.push(annots.get(k));       // forms, notes etc. stay
      }
    }
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    for (const l of pg.links) {
      if (!l.url && !l.page) continue;
      const rect = toPdfRect(l, box, rot);
      const dict = {
        Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4
      };
      if (l.page && pages[l.page - 1]) dict.Dest = [pages[l.page - 1].ref, 'Fit'];
      else if (l.url) dict.A = { Type: 'Action', S: 'URI', URI: PDFString.of(l.url) };
      else continue;
      keep.push(doc.context.register(doc.context.obj(dict)));
    }
    page.node.set(PDFName.of('Annots'), keep);
  });
  return doc.save({ useObjectStreams: true });
}

// fractions of the page as shown (top-left origin) -> PDF user space
function toPdfRect(l, b, rot) {
  let x0 = l.x, x1 = l.x + l.w, y0 = l.y, y1 = l.y + l.h;          // shown page, 0..1
  // undo the page rotation: map shown fractions to unrotated fractions (u right, v down)
  const pts = [[x0, y0], [x1, y1]].map(([x, y]) =>
    rot === 90 ? [y, 1 - x] : rot === 180 ? [1 - x, 1 - y] : rot === 270 ? [1 - y, x] : [x, y]);
  const us = pts.map(q => b.x + q[0] * b.width), vs = pts.map(q => b.y + b.height - q[1] * b.height);
  return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)].map(v => Math.round(v * 100) / 100);
}

function indexHtml(title, folder) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <style>html, body { height: 100%; margin: 0; background: #1f2228; }</style>
</head>
<body>
  <!-- Made with the flippy builder. Upload this folder to your site, or embed it elsewhere with
       <flip-book src="/path/to/${esc(folder)}/"></flip-book>  (see https://github.com/Bepce/flippy) -->
  <div class="flippy" data-src="../${esc(folder)}/" style="height: 100%"></div>
  <script src="${VIEWER_CDN}flippy.min.js"></script>
</body>
</html>
`;
}

// The project file, so the builder can reopen the zip with codes and settings intact
export function projectFile(p) {
  return {
    flippyBuilder: 1, title: p.title, folder: p.folder, settings: p.settings, codeUrls: p.codeUrls || {},
    pages: p.pages.map(pg => ({ links: pg.links }))
  };
}

export async function exportZip(p, onStep = () => {}) {
  const folder = p.folder || slugify(p.title);
  onStep('Writing links into the PDF');
  const pdf = await linkedPdf(p);
  const data = catalogueData(p);
  const json = JSON.stringify(data);
  const files = [
    { name: folder + '/catalogue.json', data: json },
    { name: folder + '/catalogue.js', data: 'window.FLIPPY_DATA=window.FLIPPY_DATA||{};window.FLIPPY_DATA[' + JSON.stringify(folder) + ']=' + json + ';\n' },
    { name: folder + '/catalogue.pdf', data: pdf },
    { name: folder + '/index.html', data: indexHtml(data.title, folder) },
    { name: folder + '/flippy-project.json', data: JSON.stringify(projectFile(p)) }
  ];
  p.images.pages.forEach((b, i) => files.push({ name: `${folder}/pages/${pad3(i + 1)}.${p.images.type}`, data: b }));
  p.images.thumbs.forEach((b, i) => files.push({ name: `${folder}/thumbs/${pad3(i + 1)}.${p.images.type}`, data: b }));
  onStep('Packing the zip');
  return { blob: await zip(files), folder, pdf };
}
