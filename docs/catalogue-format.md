# Catalogue format

A catalogue is a folder the viewer loads with `data-src`. `tools/build.py` writes it
from a PDF:

```
catalogue.json      pages and links (the viewer reads this)
catalogue.js        the same data as a script, used when the page is opened from disk
catalogue.pdf       the PDF, for the download button
pages/001.webp ...  one image per page, 1600 px tall
thumbs/001.webp ... one image per page, 300 px tall, for the page grid
```

## catalogue.json

```json
{
  "title": "Hollowbrook Goods · Autumn Collection",
  "pdf": "catalogue.pdf",
  "aspect": 0.7071,
  "pageCount": 12,
  "pages": [
    {
      "n": 3,
      "links": [
        { "x": 0.0847, "y": 0.8574, "w": 0.0538, "h": 0.0632, "kind": "swatch",
          "url": "https://example.com/hollowbrook/field-mug?colour=sage" },
        { "x": 0.0857, "y": 0.1311, "w": 0.3, "h": 0.03, "kind": "link", "page": 7 }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `title` | shown in the toolbar and, unless switched off, the page title |
| `pdf` | file name of the PDF in the folder, for the download button |
| `aspect` | page width ÷ height (all pages are shown at this ratio) |
| `pageCount` | number of pages; `pages` has one entry per page, in order |
| `pages[].n` | page number, starting at 1 |
| `pages[].links` | clickable areas on that page |

Each link is a rectangle in **fractions of the page** (0–1), measured from the top-left
corner, so it doesn't depend on image size:

| Field | Meaning |
|---|---|
| `x`, `y` | top-left corner |
| `w`, `h` | width and height |
| `url` | open this address (a product page), **or** |
| `page` | turn to this page number |
| `kind` | where the link came from: `swatch` (added by `add_links.py`) or `link` (already in the PDF). Informational only. |

The links are copied from the PDF's link annotations, so the PDF is the source of
truth: to change links, change the PDF (or `links.csv`) and run `build.py` again,
with `--skip-render` to keep the page images.
