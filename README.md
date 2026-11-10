# flippy

A page-turning catalogue viewer you host yourself. Turn a PDF catalogue into a
flipbook on your own website, with every product code linked to your shop.

- **Paper-like page turns**, a soft page-flip sound, quick riffles when jumping
  pages, a folded corner to turn the page, swipe on phones.
- **Links that live in the PDF.** `tools/add_links.py` finds the product codes
  printed in your catalogue and writes real PDF links over them. The linked PDF
  works in any PDF reader too.
- **On your own domain, the cart keeps working.** Hosted flipbook services show
  your shop in a frame from *their* domain, where browsers drop your shop's
  cookies, so the cart and login break. Served from your site (or a subdomain),
  flippy can open products in a popup that keeps them.
- **Plain JavaScript, no framework, no build step.** Two files, about 20 kB gzipped.

**[Live demo →](#)** *(GitHub Pages link once published)* — or run it locally, below.

## Try it

```sh
git clone https://github.com/Bepce/flippy
cd flippy
python -m http.server 8080
```

Open http://localhost:8080. The demo catalogue, *Hollowbrook Goods*, is an invented
shop made for this project.

## Make your own catalogue

You need Python 3 and [poppler](https://poppler.freedesktop.org/) (`pdftoppm`):

```sh
pip install -r tools/requirements.txt
```

1. **Say where codes link to.** A CSV with one row per code:

   ```csv
   code,url
   300101,https://your-shop.example/products/field-mug?colour=sage
   300102,https://your-shop.example/products/field-mug?colour=rust
   ```

   Most shop systems can export this (WooCommerce, Shopify and Google Merchant feeds
   all list SKU and product URL). Or skip the CSV and use a URL pattern, such as
   `--url-template "https://your-shop.example/search?q={code}"`.

2. **Add the links to the PDF:**

   ```sh
   mkdir -p catalogues/spring-2026
   python tools/add_links.py my-catalogue.pdf catalogues/spring-2026/catalogue.pdf \
       --links links.csv --code-pattern "\d{6}" --utm-campaign spring-2026
   ```

   `--code-pattern` is a regular expression for what your codes look like (six digits,
   `AB-1234`, ...). The tool prints any codes it found but couldn't link.

3. **Build the pages:**

   ```sh
   python tools/build.py catalogues/spring-2026/catalogue.pdf --title "Spring Collection 2026"
   ```

4. **Show it:** `index.html?c=spring-2026`, or on your own page (next section).

How the link boxes are placed:

| Layout around a code | Clickable area |
|---|---|
| Colour swatch (circle or square above the code) | swatch + code + colour name, never overlapping its neighbours |
| List or table (codes stacked in a column) | the whole row |
| Code mentioned in a sentence | skipped if the same code has a swatch on the page, otherwise the code itself |

Links that are already in your PDF, such as a clickable table of contents, are kept.

## Put it on your website

Upload `viewer/` and your catalogue folder, then:

```html
<link rel="stylesheet" href="/flippy/viewer/viewer.css?v=1">
<div class="flippy" data-src="/flippy/catalogues/spring-2026/" style="height: 85vh"></div>
<script src="/flippy/viewer/viewer.js?v=1"></script>
```

Options, as data attributes on the `.flippy` element:

| Attribute | Values | |
|---|---|---|
| `data-src` | folder URL | the catalogue folder (required) |
| `data-lang` | `en`, `bg` | interface language; defaults to the page's `<html lang>` |
| `data-link-color` | `grey`, `red`, `blue`, `white` | link highlight; visitors can change it in the toolbar |
| `data-popup` | `true` | open products in a popup over the catalogue (see below) |
| `data-pdf` | `false` | hide the PDF download button |
| `data-set-title` | `false` | don't change the page title |
| `data-title-suffix` | text | added after the catalogue title in the page title |

The page URL can also set `?lang=`, `?links=`, `?popup=1`, and `#p=12` opens a page.

**Popup or new tab.** Products open in a popup when the shop is on the same site as
the viewer, so the visitor's cart and login keep working. Otherwise they open in a new
tab, because browsers block a shop's cookies inside a frame from another site.

**Theme.** Override the CSS variables at the top of `viewer/viewer.css` on `.fb`,
for example `.fb { --fb-accent: #0a7; --fb-hot-line: #0a7; }`.

**Clicks.** Every link click fires a `flippy:link` event on `window` (with the URL,
page and catalogue), and a Google Analytics `catalogue_link` event if `gtag` is on the page.

**Rewriting links.** Set `window.flippyLinkFilter = function (url) { ... return url; }`
to adjust product URLs at runtime, for example to switch language paths.

**Updates.** Raise `?v=` on the viewer files when you update them. The viewer passes
the same version to the catalogue data, so returning visitors get the new files.

## Repository layout

```
index.html                    demo page
viewer/                       the viewer: viewer.js, viewer.css, sounds/
tools/add_links.py            finds product codes in a PDF and adds links
tools/build.py                renders pages and writes catalogue.json
catalogues/hollowbrook/       the built demo catalogue
examples/hollowbrook/         how the demo catalogue was made (source PDF, links.csv, make.js)
docs/catalogue-format.md      the catalogue.json format
tests/smoke.js                browser test of the demo
```

## Roadmap

1. **Package the viewer**: npm and CDN release, `<flip-book>` element, more languages.
2. **Builder in the browser**: upload a PDF, auto-link, edit link boxes by hand,
   export. No Python needed.
3. **Optional server**: catalogue library, logins, publishing, click statistics
   (Docker).
4. **Plugins**: WordPress first.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Translations are an easy place to start: copy the `en` block at the top of
`viewer/viewer.js`.

## Credits and licence

flippy is released under the [MIT licence](LICENSE).
Page-flip sounds: "10 Book Page Flips" by StarNinjas, CC0
([OpenGameArt](https://opengameart.org/content/10-book-page-flips)).
