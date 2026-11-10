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
- **One script, no framework.** About 16 kB gzipped. A `<flip-book>` element,
  a small JavaScript API, light and dark themes, 8 interface languages.

**[Live demo →](https://bepce.github.io/flippy/)** · [Embedded in a page](https://bepce.github.io/flippy/examples/embed.html)

## Quick start

```html
<script src="https://cdn.jsdelivr.net/gh/Bepce/flippy@v0.1.0/dist/flippy.min.js"></script>

<flip-book src="/catalogues/spring-2026/"></flip-book>
```

The script loads its stylesheet and sounds from the same place. `src` is a catalogue
folder made with the tools below. Size it like any block element:
`flip-book { height: 700px }` (default: 80% of the window height).

Or install from npm and serve `node_modules/@bepce/flippy/dist/` yourself:

```sh
npm install @bepce/flippy
```

To try the demo locally:

```sh
git clone https://github.com/Bepce/flippy
cd flippy
python -m http.server 8080        # then open http://localhost:8080
```

The demo catalogue, *Hollowbrook Goods*, is an invented shop made for this project.

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

4. **Upload the folder** and point `src` at it.

How the link boxes are placed:

| Layout around a code | Clickable area |
|---|---|
| Colour swatch (circle or square above the code) | swatch + code + colour name, never overlapping its neighbours |
| List or table (codes stacked in a column) | the whole row |
| Code mentioned in a sentence | skipped if the same code has a swatch on the page, otherwise the code itself |

Links that are already in your PDF, such as a clickable table of contents, are kept.
The folder format is described in [docs/catalogue-format.md](docs/catalogue-format.md).

## Options

As attributes on `<flip-book>` (or `data-` attributes on `<div class="flippy">`):

| Attribute | Values | Default | |
|---|---|---|---|
| `src` | folder URL | | the catalogue folder (required) |
| `lang` | `en` `bg` `de` `es` `fr` `it` `nl` `pl` | the page's `<html lang>` | interface language |
| `theme` | `dark`, `light` | `dark` | colour scheme of the viewer |
| `link-color` | `grey`, `red`, `blue`, `white` | `grey` | link highlight; visitors can change it in the toolbar |
| `popup` | `true` | `false` | open products in a popup over the catalogue (see below) |
| `hash` | `false` | `true` | keep the page number in the address (`#p=12`) for sharing |
| `page` | number | `1` | page to open on |
| `pdf` | `false` | `true` | show the PDF download button |
| `sound` | `false` | `true` | page-flip sound on by default (visitors can switch it) |
| `set-title` | `true` | `false`* | set the page title to the catalogue title |
| `title-suffix` | text | | added after the catalogue title |

\* `true` for `<div class="flippy">`, which is meant for a page that is only the catalogue.
The page URL can also set `?lang=`, `?links=`, `?popup=1` and `?hint=1` (show the swipe
hint again).

**Popup or new tab.** Products open in a popup when the shop is on the same site as
the viewer, so the visitor's cart and login keep working. Otherwise they open in a new
tab, because browsers block a shop's cookies inside a frame from another site.

## JavaScript

```js
// any element
const viewer = Flippy.mount(document.querySelector('#catalogue'), {
  src: '/catalogues/spring-2026/', lang: 'de', theme: 'light', hash: false
});
viewer.next(); viewer.prev(); viewer.go(12); viewer.destroy();

// the element has the same methods
document.querySelector('flip-book').go(12);

// your own language (anything missing falls back to English)
Flippy.addLanguage('sv', { prev: 'Föregående', next: 'Nästa', pages: 'Alla sidor' /* ... */ });

// adjust product links on the fly, e.g. for a language path
window.flippyLinkFilter = url => url.replace('/en/', '/de/');
```

Events, dispatched on the viewer element (they bubble):

| Event | `event.detail` |
|---|---|
| `flippy:ready` | `{ pageCount, title }` |
| `flippy:page` | `{ page, pages }`: first visible page and all visible pages |
| `flippy:link` | `{ url, page, kind, catalogue, src }` when a product link is clicked (also on `window`) |
| `flippy:error` | `{ error }` if the catalogue can't be loaded |

If Google Analytics (`gtag`) is on the page, link clicks are also sent as
`catalogue_link` events.

## Themes

Every colour is a CSS variable you can set on the element:

```css
flip-book {
  --fb-accent: #0a7;            /* switched-on buttons, focus rings */
  --fb-bg: #f4f1ea;             /* around the book */
  --fb-bg-2: #e8e2d6;
  --fb-bar: #fff;               /* toolbar */
  --fb-text: #222;
  --fb-hot: rgba(0,170,119,.15);      /* link highlight */
  --fb-hot-line: #0a7;
  --fb-font: "Inter", sans-serif;
}
```

The full list is at the top of [`src/flippy.css`](src/flippy.css). The viewer's styles
are scoped to the viewer and don't affect the rest of your page.

## Updating

Pin a version in the CDN URL (`@v0.1.0`). When you update your own copy, also raise the
`?v=` on the files: the viewer passes it on to the catalogue data, so returning visitors
get the new files. See [CHANGELOG.md](CHANGELOG.md).

## Repository layout

```
src/                    viewer source: flippy.js, flippy.css, sounds/
dist/                   built files (npm run dist): readable and .min versions
index.html              full-page demo
examples/embed.html     the viewer inside an ordinary page, with the API and events
examples/hollowbrook/   how the demo catalogue was made (source PDF, links.csv, make.js)
catalogues/hollowbrook/ the built demo catalogue
tools/                  add_links.py, build.py (Python), build-dist.js (release build)
docs/                   catalogue format
tests/smoke.js          browser tests (desktop, phone, embedded, API)
```

## Roadmap

1. ~~Package the viewer~~ (0.1): CDN and npm, `<flip-book>`, API, themes, languages.
2. **Builder in the browser**: upload a PDF, auto-link, edit link boxes by hand,
   export. No Python needed.
3. **Optional server**: catalogue library, logins, publishing, click statistics
   (Docker).
4. **Plugins**: WordPress first.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
New languages are an easy place to start: copy the `en` block at the top of
`src/flippy.js`.

## Credits and licence

flippy is released under the [MIT licence](LICENSE).
Page-flip sounds: "10 Book Page Flips" by StarNinjas, CC0
([OpenGameArt](https://opengameart.org/content/10-book-page-flips)).
