# Changelog

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
