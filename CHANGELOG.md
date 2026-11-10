# Changelog

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
