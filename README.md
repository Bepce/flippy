# flippy

A page-turning catalogue viewer you host yourself. Turn a PDF catalogue into a
flipbook on your own website, with every product code linked to your shop.

- **Paper-like page turns**, a soft page-flip sound, quick riffles when jumping
  pages, a folded corner to turn the page, swipe on phones.
- **Make it in your browser.** The [builder](https://bepce.github.io/flippy/builder/)
  finds the product codes printed in your PDF and links them to your shop. Fix
  any box by hand, preview, and download a folder to upload. Nothing is uploaded
  anywhere while you work.
- **Links that live in the PDF.** The links are written into the PDF as well, so
  the downloadable catalogue works in any PDF reader too.
- **On your own domain, the cart keeps working.** Hosted flipbook services show
  your shop in a frame from *their* domain, where browsers drop your shop's
  cookies, so the cart and login break. Served from your site (or a subdomain),
  flippy can open products in a popup that keeps them.
- **Optional server.** A catalogue library on your own site with sign-in, publishing
  straight from the builder, and anonymous click statistics. PHP and SQLite, so it runs on
  ordinary web hosting, or in Docker.
- **One script, no framework.** About 16 kB gzipped. A `<flip-book>` element,
  a small JavaScript API, light and dark themes, 8 interface languages.

**[Live demo →](https://bepce.github.io/flippy/)** · [Embedded in a page](https://bepce.github.io/flippy/examples/embed.html) · **[Builder →](https://bepce.github.io/flippy/builder/)**

## Quick start

```html
<script src="https://cdn.jsdelivr.net/gh/Bepce/flippy@v0.3.1/dist/flippy.min.js"></script>

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

### In the browser

Open the **[builder](https://bepce.github.io/flippy/builder/)** (or `builder/` in your own copy):

1. **Open your PDF.** The builder reads the pages and keeps any links already in it, such as a
   clickable table of contents.
2. **Link the product codes.** Say what a code looks like (`\d{6}` for six digits) and where codes
   link to: a CSV of `code,url`, a product feed from your shop (Google Merchant XML works), or one
   address pattern such as `https://your-shop.example/search?q={code}`. Press *Find and link codes*.
   Codes without an address show as orange boxes and in the *Codes* list, where you can type one in.
   Each product's name and photo are linked as well: the builder finds them next to the colour
   codes (the bold line above them, the nearest picture).
3. **Adjust by hand.** Drag on the page to draw a link, drag a box to move it, pull its handles to
   resize, Delete to remove. A box can open an address or turn to a page. Ctrl+Z undoes.
4. **Preview**, then **Export**. You get a zip with the catalogue folder, including each page's
   text so visitors can search the catalogue. Upload it, and either link
   to its `index.html` or embed it with `<flip-book src="/catalogues/your-folder/">`.

Your work is saved in the browser as you go. To change a catalogue later, open its zip in the
builder again.

The builder needs a current browser (Chrome, Edge, Firefox or Safari). Safari can't save WebP
images, so catalogues made there use JPEG pages, which the viewer handles the same way.

### With the command line

For automation, or catalogues with drawn swatch shapes the builder can't see, the Python tools do
the same job. You need Python 3 and [poppler](https://poppler.freedesktop.org/) (`pdftoppm`):

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
| Colour swatch (circle or square above the code) | swatch + code + colour name; boxes in a row share a width, with even gaps |
| Product photo with the code under it | the whole photo + code + name |
| List or table (codes stacked in a column) | the whole row |
| Name printed right above the code | name and code together |
| Code mentioned in a sentence | skipped if the same code has a swatch on the page, otherwise the code itself |

Links that are already in your PDF, such as a clickable table of contents, are kept.
The folder format is described in [docs/catalogue-format.md](docs/catalogue-format.md).

## Catalogue library (optional server)

For several catalogues, several people, or to see what visitors click, run the flippy server:

```sh
docker run -d -p 8080:80 -v flippy-data:/data ghcr.io/bepce/flippy-server
```

or upload `flippy-server-<version>.zip` from the
[latest release](https://github.com/Bepce/flippy/releases/latest) to any PHP 8.1+ host. Then open
it and create the first account. You get:

- a library of your catalogues, each with a public page and embed code
- *Publish* in the builder, and *Edit in builder* for published catalogues
- views, pages seen and product clicks per day, page and link (anonymous: no cookies)
- named users: admins and editors

Setup, settings, nginx and the API are in [docs/server.md](docs/server.md).

## Options

As attributes on `<flip-book>` (or `data-` attributes on `<div class="flippy">`):

| Attribute | Values | Default | |
|---|---|---|---|
| `src` | folder URL | | the catalogue folder (required) |
| `lang` | `en` `bg` `de` `es` `fr` `it` `nl` `pl` | the page's `<html lang>` | interface language |
| `theme` | `dark`, `light` | `dark` | colour scheme of the viewer |
| `bg` | colour, e.g. `fdf6e3` | | background around the book (`none`: the theme's) |
| `accent` | colour | | switched-on buttons and focus rings (`none`: the theme's) |
| `link-color` | `grey`, `red`, `blue`, `white` | `grey` | colour of the link highlight |
| `popup` | `true` | `false` | open products in a popup over the catalogue (see below) |
| `hash` | `false` | `true` | keep the page number in the address (`#p=12`) for sharing |
| `page` | number | `1` | page to open on |
| `pdf` | `false` | `true` | show the PDF download button |
| `sound` | `false` | `true` | page-flip sound on by default (visitors can switch it) |
| `set-title` | `true` | `false`* | set the page title to the catalogue title |
| `title-suffix` | text | | added after the catalogue title |
| `track` | `false` | `true` | statistics for catalogues from a flippy server |

\* `true` for `<div class="flippy">`, which is meant for a page that is only the catalogue.
The page URL can also set `?lang=`, `?theme=`, `?bg=`, `?accent=`, `?links=`, `?popup=1` and
`?hint=1` (show the swipe hint again), which is handy for an iframe:
`<iframe src="https://catalogues.example/c/spring/?theme=light&bg=ffffff">`.

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
// Flippy.version is the viewer's version

// the element has the same methods
document.querySelector('flip-book').go(12);

// your own language (anything missing falls back to English)
Flippy.addLanguage('sv', { prev: 'Föregående', next: 'Nästa', pages: 'Alla sidor' /* ... */ });

// a catalogue you already have in memory (the builder's preview does this)
Flippy.mount(el, { data: catalogueJson, resolve: path => myUrls[path] });

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
are scoped to the viewer and don't affect the rest of your page, and its defaults have zero
specificity, so any rule of yours wins. Catalogues from the flippy server can carry their own
look (set under *Appearance* in the admin), which applies to iframes too; your CSS still wins.

## Updating

Pin a version in the CDN URL (`@v0.3.1`). When you update your own copy, also raise the
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
builder/                the builder (plain ES modules, no build step)
server/                 the optional server (PHP, SQLite): index.php, lib/, admin/
Dockerfile              the server image (server + builder + dist)
tools/                  add_links.py, build.py (Python), build-dist.js (release build)
docs/                   catalogue format
tests/                  browser tests: smoke.js (viewer), builder.js, server.js (end to end)
```

## Roadmap

1. ~~Package the viewer~~ (0.1): CDN and npm, `<flip-book>`, API, themes, languages.
2. ~~Builder in the browser~~ (0.2): open a PDF, auto-link, edit link boxes by hand,
   preview, export. No Python needed.
3. ~~Optional server~~ (0.3): catalogue library, sign-in, publishing from the builder,
   click statistics. PHP + SQLite, Docker.
4. **Plugins**: WordPress first.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
New languages are an easy place to start: copy the `en` block at the top of
`src/flippy.js`.

## Credits and licence

flippy is released under the [MIT licence](LICENSE).
Page-flip sounds: "10 Book Page Flips" by StarNinjas, CC0
([OpenGameArt](https://opengameart.org/content/10-book-page-flips)).
