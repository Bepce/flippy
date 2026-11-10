// Builds the sample catalogue for flippy: an invented brand ("Hollowbrook Goods") with
// drawn products, so the demo contains nothing anyone else owns.
//
//   node examples/hollowbrook/make.js
//
// Writes catalogue-source.pdf (12 A4 pages, contents page with page links) and links.csv
// (code -> product URL) next to this file. Needs Playwright (npm i -D playwright).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = __dirname;

const C = {                      // colour names -> swatch colour
  Sage: '#9aae8f', Rust: '#b5583a', Navy: '#2c3e5c', Oat: '#e6dccb', Charcoal: '#3d3f43', Mustard: '#d2a23a',
  Forest: '#3f5b45', Clay: '#c98b6b', Sky: '#9cc3d9', Plum: '#6d4a6b', Cream: '#f4efe4', Slate: '#6b7a86'
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// drawings: simple flat illustrations in the product's first colour
const art = {
  mug: c => `<rect x="70" y="80" width="150" height="170" rx="18" fill="${c}"/><path d="M220 120 h28 a42 42 0 0 1 0 84 h-28" fill="none" stroke="${c}" stroke-width="22"/><rect x="70" y="80" width="150" height="22" rx="10" fill="#000" opacity=".12"/><ellipse cx="145" cy="262" rx="95" ry="10" fill="#000" opacity=".12"/>`,
  beanie: c => `<path d="M60 200 C60 100 120 60 160 60 C200 60 260 100 260 200 Z" fill="${c}"/><rect x="50" y="190" width="220" height="50" rx="12" fill="${c}"/><rect x="50" y="190" width="220" height="50" rx="12" fill="#000" opacity=".15"/><circle cx="160" cy="52" r="22" fill="${c}"/><g opacity=".18" stroke="#000" stroke-width="4">${[80,100,120,140,160,180,200,220,240].map(x => `<line x1="${x}" y1="196" x2="${x}" y2="236"/>`).join('')}</g>`,
  tote: c => `<path d="M110 110 C110 50 210 50 210 110" fill="none" stroke="${c}" stroke-width="14"/><path d="M60 110 H260 L245 270 H75 Z" fill="${c}"/><path d="M60 110 H260 L256 140 H64 Z" fill="#000" opacity=".1"/><rect x="125" y="170" width="70" height="44" rx="6" fill="#fff" opacity=".55"/>`,
  bottle: c => `<rect x="125" y="40" width="70" height="30" rx="8" fill="#3d3f43"/><path d="M118 80 h84 q18 18 18 40 v140 q0 18 -18 18 h-84 q-18 0 -18 -18 v-140 q0 -22 18 -40z" fill="${c}"/><rect x="100" y="150" width="120" height="60" fill="#fff" opacity=".25"/><rect x="132" y="66" width="56" height="16" fill="#000" opacity=".2"/>`,
  notebook: c => `<rect x="80" y="50" width="170" height="230" rx="10" fill="${c}"/><rect x="80" y="50" width="22" height="230" rx="6" fill="#000" opacity=".18"/><rect x="232" y="50" width="8" height="230" fill="#000" opacity=".1"/><rect x="130" y="110" width="80" height="28" rx="4" fill="#fff" opacity=".6"/><path d="M200 50 v60 l12 -10 l12 10 v-60" fill="#b5583a"/>`,
  scarf: c => `<path d="M90 60 h140 v70 c0 30 -40 40 -70 40 s-70 -10 -70 -40z" fill="${c}"/><rect x="170" y="140" width="56" height="140" rx="10" fill="${c}"/><rect x="170" y="140" width="56" height="140" rx="10" fill="#000" opacity=".12"/><g stroke="${c}" stroke-width="5">${[176,186,196,206,216].map(x => `<line x1="${x}" y1="278" x2="${x}" y2="298"/>`).join('')}</g><g opacity=".15" fill="#000">${[80,100,120].map(y => `<rect x="90" y="${y}" width="140" height="6"/>`).join('')}</g>`,
  socks: c => `<path d="M100 50 h60 v150 c0 30 -20 50 -50 50 h-40 c-22 0 -30 -30 -10 -40 l40 -20z" fill="${c}"/><path d="M180 70 h60 v150 c0 30 -20 50 -50 50 h-40 c-22 0 -30 -30 -10 -40 l40 -20z" fill="${c}"/><g fill="#000" opacity=".15"><rect x="100" y="50" width="60" height="22"/><rect x="180" y="70" width="60" height="22"/></g>`,
  apron: c => `<path d="M120 40 h80 v60 l50 20 v170 h-180 v-170 l50 -20z" fill="${c}"/><path d="M120 40 C100 10 220 10 200 40" fill="none" stroke="${c}" stroke-width="8"/><rect x="115" y="170" width="90" height="60" rx="6" fill="#000" opacity=".12"/><line x1="160" y1="170" x2="160" y2="230" stroke="#000" stroke-opacity=".15" stroke-width="3"/>`
};

const products = [
  { n: 1, name: 'Field Mug', art: 'mug', price: '€18', colours: ['Sage', 'Rust', 'Navy', 'Oat', 'Charcoal'],
    copy: 'A stoneware mug thrown with a wide base and a handle that fits four fingers. Holds a proper 350 ml.',
    details: ['Dishwasher and microwave safe', 'Reactive glaze, each one slightly different', '350 ml'] },
  { n: 2, name: 'Ridge Beanie', art: 'beanie', price: '€29', colours: ['Mustard', 'Forest', 'Rust', 'Charcoal', 'Oat', 'Sky'],
    copy: 'Rib-knit merino with a deep fold-up cuff. Warm enough for the ridge, soft enough for the office.',
    details: ['100% merino wool', 'One size, stretches to fit', 'Pom-pom detachable'] },
  { n: 3, name: 'Market Tote', art: 'tote', price: '€34', colours: ['Oat', 'Navy', 'Forest', 'Clay'],
    copy: 'Heavy canvas tote with long handles and an inside pocket for keys and a phone.',
    details: ['16 oz cotton canvas', '40 × 38 × 14 cm', 'Inside zip pocket'] },
  { n: 4, name: 'Trail Bottle', art: 'bottle', price: '€26', colours: ['Sky', 'Sage', 'Plum', 'Charcoal', 'Cream'],
    copy: 'Double-walled steel bottle that keeps drinks cold for a day and hot until lunch.',
    details: ['750 ml', 'Cold 24 h, hot 12 h', 'Leak-proof screw cap'] },
  { n: 5, name: 'Pocket Notebook', art: 'notebook', price: '€12', colours: ['Navy', 'Rust', 'Forest', 'Mustard'],
    copy: 'A5 notebook with a linen cover, dot-grid pages and a ribbon to find your place.',
    details: ['160 pages, 100 g paper', 'Lay-flat binding', 'Ribbon marker'] },
  { n: 6, name: 'Harbor Scarf', art: 'scarf', price: '€45', colours: ['Slate', 'Clay', 'Plum', 'Forest', 'Oat', 'Charcoal'],
    copy: 'A long scarf in brushed lambswool with fringed ends. Wraps twice.',
    details: ['100% lambswool', '190 × 30 cm', 'Hand wash'] },
  { n: 7, name: 'Camp Socks', art: 'socks', price: '€15', colours: ['Rust', 'Mustard', 'Sage', 'Navy', 'Cream'],
    copy: 'Cushioned hiking socks with a reinforced heel and toe. Sold in pairs.',
    details: ['Merino blend', 'Sizes 36–46', 'Cushioned sole'] },
  { n: 8, name: 'Canvas Apron', art: 'apron', price: '€39', colours: ['Charcoal', 'Oat', 'Forest', 'Clay'],
    copy: 'Workshop apron with cross-back straps, so the weight sits on your shoulders, not your neck.',
    details: ['Waxed canvas', 'Two front pockets', 'Adjustable cross-back straps'] }
];
const code = (p, i) => String(300000 + p.n * 100 + i + 1);

const extras = [   // the list page: small items in a code / name / colour table
  ['Enamel Pin', 'Sage'], ['Enamel Pin', 'Rust'], ['Enamel Pin', 'Navy'], ['Key Fob', 'Oat'], ['Key Fob', 'Charcoal'],
  ['Postcard Set', 'Cream'], ['Postcard Set', 'Sky'], ['Patch', 'Forest'], ['Patch', 'Mustard'], ['Patch', 'Plum']
].map((e, i) => ({ code: String(309001 + i), name: e[0], colour: e[1] }));

const css = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, sans-serif; color: #2b2a27; }
.page { width: 210mm; height: 297mm; position: relative; overflow: hidden; page-break-after: always; background: #fbf8f2; }
.page:last-child { page-break-after: auto; }
.serif { font-family: 'Bitstream Charter', Georgia, serif; }
.folio { position: absolute; bottom: 12mm; font-size: 9pt; color: #8a857b; letter-spacing: .08em; }
.page:nth-child(odd) .folio { right: 16mm; } .page:nth-child(even) .folio { left: 16mm; }
.brand { font-size: 9pt; letter-spacing: .3em; text-transform: uppercase; color: #8a857b; }
.panel { position: absolute; left: 0; right: 0; top: 0; height: 158mm; display: flex; align-items: center; justify-content: center; }
.panel svg { width: 120mm; height: 120mm; }
.body { position: absolute; left: 18mm; right: 18mm; top: 172mm; }
h2 { font-family: 'Bitstream Charter', Georgia, serif; font-weight: 700; font-size: 30pt; margin: 4mm 0 3mm; }
.copy { font-size: 11pt; line-height: 1.5; max-width: 120mm; margin: 0 0 4mm; }
ul { margin: 0; padding-left: 5mm; font-size: 9.5pt; color: #55524b; line-height: 1.6; }
.price { position: absolute; right: 18mm; top: 176mm; font-family: 'Bitstream Charter', Georgia, serif; font-size: 22pt; }
.swatches { position: absolute; left: 18mm; right: 18mm; bottom: 24mm; display: flex; gap: 9mm; }
.sw { width: 15mm; text-align: center; font-size: 7.5pt; color: #55524b; line-height: 1.25; }
.dot { width: 9mm; height: 9mm; border-radius: 50%; margin: 0 auto 1.6mm; border: .3mm solid rgba(0,0,0,.15); }
.sw b { display: block; font-weight: 600; color: #2b2a27; }
.label { position: absolute; left: 18mm; bottom: 42mm; font-size: 8pt; letter-spacing: .15em; text-transform: uppercase; color: #8a857b; }
`;

function productPage(p, folio) {
  const tint = C[p.colours[0]];
  return `<section class="page" id="p${folio}">
  <div class="panel" style="background:${tint}22"><svg viewBox="0 0 320 320">${art[p.art](tint)}</svg></div>
  <div class="body"><div class="brand">Hollowbrook Goods</div><h2>${p.name}</h2><p class="copy">${p.copy}</p>
  <ul>${p.details.map(d => `<li>${d}</li>`).join('')}</ul></div>
  <div class="price">${p.price}</div>
  <div class="label">Colours</div>
  <div class="swatches">${p.colours.map((c, i) => `<div class="sw"><div class="dot" style="background:${C[c]}"></div><b>${code(p, i)}</b>${c}</div>`).join('')}</div>
  <div class="folio">${folio}</div></section>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<section class="page" style="background:#2c3e5c;color:#fbf8f2">
  <div style="position:absolute;left:18mm;top:22mm" class="brand"><span style="color:#d6cfc0">Hollowbrook Goods · Est. 2019</span></div>
  <div style="position:absolute;left:18mm;right:18mm;top:60mm"><div class="serif" style="font-size:54pt;line-height:1.02;font-weight:700">Autumn<br>Collection</div>
  <div style="margin-top:8mm;font-size:13pt;color:#d6cfc0;max-width:120mm;line-height:1.5">Everyday things for walks, work and the kitchen table. Made to be used, then used again.</div></div>
  <svg viewBox="0 0 320 320" style="position:absolute;right:-10mm;bottom:20mm;width:130mm;height:130mm">${art.mug(C.Rust)}</svg>
  <svg viewBox="0 0 320 320" style="position:absolute;left:12mm;bottom:16mm;width:80mm;height:80mm">${art.beanie(C.Mustard)}</svg>
  <div style="position:absolute;left:18mm;bottom:12mm;font-size:9pt;color:#d6cfc0;letter-spacing:.1em">2026 / 2027 · SAMPLE CATALOGUE FOR FLIPPY</div>
</section>
<section class="page">
  <div style="position:absolute;left:18mm;right:18mm;top:24mm"><div class="brand">Inside</div><h2 style="font-size:36pt">Contents</h2>
  <div style="margin-top:10mm;font-size:13pt;line-height:2.1">
  ${products.map((p, i) => `<div><a href="#p${i + 3}" style="color:inherit;text-decoration:none"><span style="display:inline-block;width:14mm;color:#b5583a;font-weight:600">${i + 3}</span>${p.name}</a></div>`).join('')}
  <div><a href="#p11" style="color:inherit;text-decoration:none"><span style="display:inline-block;width:14mm;color:#b5583a;font-weight:600">11</span>Small things</a></div></div>
  <p class="copy" style="margin-top:14mm;color:#55524b">Tap a colour on any page to open that product in the shop. The six-digit number under each colour is its product code.</p></div>
  <div class="folio">2</div></section>
${products.map((p, i) => productPage(p, i + 3)).join('\n')}
<section class="page" id="p11">
  <div style="position:absolute;left:18mm;right:18mm;top:24mm"><div class="brand">Hollowbrook Goods</div><h2>Small things</h2>
  <p class="copy">Pins, fobs, postcards and patches. Order by code.</p>
  <table style="margin-top:8mm;border-collapse:collapse;font-size:11pt;width:120mm">
  <tr style="color:#8a857b;font-size:8pt;letter-spacing:.12em;text-transform:uppercase"><td style="padding:2mm 0">Code</td><td>Item</td><td>Colour</td></tr>
  ${extras.map(e => `<tr><td style="padding:1.6mm 6mm 1.6mm 0;font-weight:600">${e.code}</td><td style="padding-right:6mm">${e.name}</td><td><span style="display:inline-block;width:3mm;height:3mm;background:${C[e.colour]};margin-right:2mm"></span>${e.colour}</td></tr>`).join('')}
  </table></div>
  <div class="folio">11</div></section>
<section class="page" style="background:#3f5b45;color:#fbf8f2">
  <div style="position:absolute;left:18mm;right:18mm;bottom:40mm">
  <div class="serif" style="font-size:30pt;font-weight:700">Hollowbrook Goods</div>
  <div style="margin-top:4mm;font-size:11pt;color:#d6cfc0;line-height:1.6">12 Mill Lane, Hollowbrook<br>hollowbrook.example</div>
  <div style="margin-top:10mm;font-size:8.5pt;color:#c2c9bd;max-width:130mm;line-height:1.5">Hollowbrook Goods is a made-up shop. This catalogue exists to show what flippy can do; its products, codes and prices are invented.</div></div>
</section>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: path.join(OUT, 'catalogue-source.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  const rows = ['code,url'];
  products.forEach(p => p.colours.forEach((c, i) => rows.push(`${code(p, i)},https://example.com/hollowbrook/${slug(p.name)}?colour=${slug(c)}`)));
  extras.forEach(e => rows.push(`${e.code},https://example.com/hollowbrook/${slug(e.name)}?colour=${slug(e.colour)}`));
  fs.writeFileSync(path.join(OUT, 'links.csv'), rows.join('\n') + '\n');
  console.log('wrote catalogue-source.pdf and links.csv (' + (rows.length - 1) + ' codes)');
})();
