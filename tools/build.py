"""Turn a (linked) catalogue PDF into what the flippy viewer loads.

Renders every page to WebP (a large image for reading, a small one for the
page grid) and copies the PDF's link annotations into catalogue.json, so the
links shown in the viewer are exactly the ones inside the PDF.

Usage:
  python tools/build.py catalogues/my-catalogue/catalogue.pdf --title "Spring Collection 2026"

Output, next to the PDF: pages/NNN.webp, thumbs/NNN.webp, catalogue.json and
catalogue.js (the same data as a script, so the viewer also works from file://).
"""
import argparse
import json
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

from PIL import Image
from pypdf import PdfReader

LARGE_H = 1600   # px, sharp on phones and on a desktop spread at 2x
THUMB_H = 300


def render(pdf, n, outdir, tmp):
    base = os.path.join(tmp, f"p{n}")
    subprocess.run(["pdftoppm", "-f", str(n), "-l", str(n), "-scale-to-y", str(LARGE_H), "-scale-to-x", "-1",
                    "-png", "-singlefile", pdf, base], check=True)
    im = Image.open(base + ".png").convert("RGB")
    im.save(os.path.join(outdir, "pages", f"{n:03d}.webp"), "WEBP", quality=80, method=5)
    th = im.resize((round(im.width * THUMB_H / im.height), THUMB_H), Image.LANCZOS)
    th.save(os.path.join(outdir, "thumbs", f"{n:03d}.webp"), "WEBP", quality=70, method=5)
    os.remove(base + ".png")
    return im.size


def dest_page(reader, d):
    """Page number (1-based) of a link destination: an explicit [page /Fit ...] array,
    a bare page index, or a named destination (as InDesign, Word and Chrome write them)."""
    d = d.get_object() if hasattr(d, "get_object") else d
    if isinstance(d, (str, bytes)):                          # named destination
        name = d.decode("latin-1") if isinstance(d, bytes) else str(d)
        named = reader.named_destinations
        hit = named.get(name) or named.get(name.lstrip("/")) or named.get("/" + name.lstrip("/"))
        if hit is None:
            return None
        return reader.get_destination_page_number(hit) + 1
    try:
        tgt = d[0]
    except (TypeError, IndexError, KeyError):
        return None
    tgt = tgt.get_object() if hasattr(tgt, "get_object") else tgt
    if isinstance(tgt, int):
        return tgt + 1
    try:
        return reader.get_page_number(tgt) + 1
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--title", required=True)
    ap.add_argument("--skip-render", action="store_true", help="only refresh links in catalogue.json")
    a = ap.parse_args()

    outdir = os.path.dirname(os.path.abspath(a.pdf))
    os.makedirs(os.path.join(outdir, "pages"), exist_ok=True)
    os.makedirs(os.path.join(outdir, "thumbs"), exist_ok=True)
    reader = PdfReader(a.pdf)

    if not a.skip_render:
        with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(os.cpu_count() or 2) as ex:
            list(ex.map(lambda n: render(a.pdf, n, outdir, tmp), range(1, len(reader.pages) + 1)))

    pages = []
    for i, p in enumerate(reader.pages):
        mb = p.mediabox
        x0, y0, W, H = float(mb.left), float(mb.bottom), float(mb.width), float(mb.height)
        links = []
        for ref in p.get("/Annots") or []:
            an = ref.get_object()
            if an.get("/Subtype") != "/Link":
                continue
            r = [float(v) for v in an["/Rect"]]
            box = {
                "x": round((min(r[0], r[2]) - x0) / W, 4),
                "y": round((H - (max(r[1], r[3]) - y0)) / H, 4),
                "w": round(abs(r[2] - r[0]) / W, 4),
                "h": round(abs(r[3] - r[1]) / H, 4),
                "kind": str(an.get("/NM", "link")),
            }
            action = an.get("/A")
            dest = an.get("/Dest")
            if action and action.get("/S") == "/URI":
                box["url"] = str(action["/URI"])
            elif dest is not None or (action and action.get("/S") == "/GoTo"):
                n = dest_page(reader, dest if dest is not None else action["/D"])
                if n is None:
                    continue
                box["page"] = n
            else:
                continue
            links.append(box)
        pages.append({"n": i + 1, "links": links})

    first = reader.pages[0].mediabox
    manifest = {
        "title": a.title,
        "pdf": os.path.basename(a.pdf),
        "aspect": round(float(first.width) / float(first.height), 4),
        "pageCount": len(pages),
        "pages": pages,
    }
    # each page's text, for the viewer's search
    texts = []
    for p in reader.pages:
        try:
            texts.append(" ".join((p.extract_text() or "").split()))
        except Exception:
            texts.append("")
    if any(texts):
        with open(os.path.join(outdir, "search.json"), "w", encoding="utf-8") as f:
            json.dump(texts, f, ensure_ascii=False, separators=(",", ":"))
        manifest["search"] = "search.json"
    blob = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(outdir, "catalogue.json"), "w", encoding="utf-8") as f:
        f.write(blob)
    # same data as a script, so index.html also works when opened straight from disk (file://)
    with open(os.path.join(outdir, "catalogue.js"), "w", encoding="utf-8") as f:
        f.write("window.FLIPPY_DATA=window.FLIPPY_DATA||{};window.FLIPPY_DATA[%s]=%s;\n"
                % (json.dumps(os.path.basename(outdir)), blob))
    print(f"{len(pages)} pages, {sum(len(p['links']) for p in pages)} links -> {outdir}/catalogue.json")


if __name__ == "__main__":
    main()
