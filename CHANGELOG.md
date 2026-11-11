# Changelog

## 0.3.1 (2026-11-11)

- Builder: photos stored as JPEG 2000 (common in PDFs from InDesign and print workflows) were
  missing from the pages. The builder now loads pdf.js's image decoders, colour profiles and
  font data.
- Builder: swatch boxes start just above the colour dot (found in the PDF's drawing), end under
  the colour name, share one width along a row and keep an even gap; a code under a product
  photo gets the whole photo in its box. Name and photo linking is off by default
- Viewer: a lifted corner shows the real pages: the flap is the back of the sheet (the page that
  lands on the other side), and underneath is the page that will be on that side. On the first
  and last spread, where there is no page underneath, the corner is cut out of the page
  so the real background shows through
- Viewer: the search button opens a search view (focused box, results); buttons meant to be
  hidden (search without page text, PDF without a PDF) really are
- Builder: a short name printed right above a code (one product per label, like a range of
  shoes) is linked together with its code as one box
- Builder: links each **product's name and photo** too, found next to its colour codes (the bold
  line above them and the nearest picture), to the first colour's address or without the
  part after "?"
- Viewer: **search** in the pages panel (and a search button on desktop), with the matching pages
  and a snippet; codes are searchable too. The builder and `build.py` write each page's text to
  `search.json`, and the server keeps it
- Viewer: the first link hint fits what is on show: page links on a contents page, products
  later. The links' flash and hint hadn't been showing at all (a class name was wrong)
- Builder: the logo goes back to the library on a server; the page list and side panel can be
  hidden, and each side panel section folds (remembered)
- Server: **Appearance** per catalogue (theme, background, accent, link highlight, toolbar
  language) with a live preview; applies to the catalogue page, iframes and embeds. Iframe
  embed code. Views by signed-in users aren't counted.
- Viewer: `bg` and `accent` options, and `?theme=`, `?bg=`, `?accent=` in the address
- Viewer: the default colours now have zero specificity, so `flip-book { --fb-bg: … }` in a
  site's CSS really overrides them (it didn't before)
- Viewer: new toolbar. A page pill ("6–7 / 108", type a page and press Enter) without number
  spinners; first-page and last-page buttons; the link colour picker is gone (set it with
  `link-color` or in the server's Appearance)
- Viewer: zoom in place. Hovering the zoom button shows a slider (100–300%); drag, scroll or use
  the arrow keys to move around; Ctrl + scroll zooms; Escape or turning a page zooms back out
- Viewer: all pages open in a side panel of thumbnails instead of a full-screen grid. On wide
  screens the book moves over and the panel stays open while you read; on phones it slides over
  the page and closes when you pick one
- Viewer on phones: a zoom bar (−, slider, +) at the top of the catalogue, and pinching zooms the
  catalogue page instead of the whole web page
- Viewer on phones: the toolbar is back, page, next, pages and a "more" menu (show links, sound,
  download PDF)
- Admin: the Appearance preview changes colours instantly instead of reloading
- Builder: zoom slider and buttons, Ctrl + scroll (or pinch on a trackpad) zooms around the
  pointer, Ctrl +/−/0; Fit works again after zooming in
- Server: works without PHP's mbstring extension, which is off by default on Windows (creating
  the first account failed)

## 0.3.0 (2026-11-11)

The optional server: a catalogue library on your own site.

- **Server** (`server/`, PHP 8.1+ with SQLite): catalogue library with a public page and embed
  code per catalogue, publish/hide, rename, replace, delete, download
- Sign-in with named users (admins and editors), sign-in throttling, CSRF protection
- **Statistics**: views, pages seen and product clicks per day, page and link; anonymous daily
  totals, no cookies; CSV download
- **Builder**: *Publish* to the server, and *Edit in builder* opens a published catalogue again
- Uploaded catalogues are checked: only expected files are stored, page images and PDF are
  verified by content, catalogue.json is rebuilt so only http(s) links reach visitors
- Docker image (`ghcr.io/bepce/flippy-server`), docker-compose.yml, and a zip for PHP hosting,
  both built for each release by GitHub Actions; tests run on every push
- Viewer: sends statistics when catalogue.json has a `track` address (`track="false"` to turn
  off)

## 0.2.0 (2026-11-10)

The builder: make a catalogue in the browser, no Python needed.

- **[Builder](https://bepce.github.io/flippy/builder/)**: open a PDF, link product codes from a CSV,
  a shop product feed (Google Merchant XML) or an address pattern, adjust boxes by hand (draw, move,
  resize, delete, undo), preview the flipbook, export the catalogue folder as a zip
- Exports carry the links in the PDF too, an `index.html` that opens the catalogue on its own, and
  a project file so the zip can be opened in the builder again
- Projects are saved in the browser as you work; nothing is uploaded
- Viewer: `Flippy.mount(el, { data, resolve })` shows a catalogue held in memory
- Viewer: `images` in catalogue.json for JPEG page images (`"images": "jpg"`); WebP stays the default
- Viewer: re-measures when its box changes size, not only when the window does (fixes a blank book
  when the stylesheet loads late or the viewer starts hidden)

## 0.1.0 (2026-11-10)

First release.

- `<flip-book>` element and `Flippy.mount()`; `<div class="flippy">` for full-page catalogues
- Paper page curl with spine shadow, riffle for multi-page jumps, folded corners, swipe
- Recorded page-flip sounds (CC0), mute button remembered per visitor
- Light and dark themes; colours, font and sizes as CSS variables; styles scoped to the viewer
- Interface in English, Bulgarian, German, Spanish, French, Italian, Dutch and Polish;
  `Flippy.addLanguage()` for more
- Events: `flippy:ready`, `flippy:page`, `flippy:link`, `flippy:error`; Google Analytics hook
- Product links open in a same-site popup (cart keeps working) or a new tab
- Options: `hash`, `page`, `pdf`, `sound`, `popup`, `link-color`, `set-title`, ...
- Tools: `add_links.py` (codes → PDF links from CSV or URL template), `build.py` (pages + catalogue.json)
