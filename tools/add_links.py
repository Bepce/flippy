"""Add product links to a catalogue PDF.

Finds product codes printed in the PDF (SKUs, article numbers, colour codes) and
writes real PDF link annotations over them. The result is an ordinary PDF: the
links work in any PDF reader, in other flipbook services, and in the flippy viewer.

Where a link goes comes from a CSV file, a URL pattern, or both:

  --links links.csv              code,url  (one row per code; extra columns ignored)
  --url-template "https://shop.example/search?q={code}"
                                 used for codes that aren't in the CSV

The link box follows the layout around each code:
  * colour swatch row  (a drawn circle/square above the code): swatch + code + name,
    kept narrower than the gap to its neighbours so boxes never overlap
  * list / table       (codes stacked in a column): the whole row
  * inside a sentence  : skipped when the same code also has a swatch on the page,
                         otherwise just the code itself

Links already in the PDF (for example a table of contents made in InDesign) are kept.

Usage:
  python tools/add_links.py SOURCE.pdf OUT.pdf --links links.csv [--code-pattern REGEX]
         [--url-template URL] [--utm-campaign NAME] [--report report.json]
"""
import argparse
import csv
import json
import re
import sys
from collections import defaultdict

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import NameObject, TextStringObject


def load_links(path):
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if len(row) < 2 or not row[0].strip() or row[0].strip().lower() == "code":
                continue
            out[row[0].strip()] = row[1].strip()
    return out


def inside(w, bbox):
    cx = (w["x0"] + w["x1"]) / 2
    return bbox[0] <= cx <= bbox[2]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("out")
    ap.add_argument("--links", help="CSV with code,url rows")
    ap.add_argument("--url-template", help="URL for codes not in the CSV, with {code} as placeholder")
    ap.add_argument("--code-pattern", default=r"\d{6}",
                    help=r"regular expression a whole word must match to count as a code (default: \d{6})")
    ap.add_argument("--utm-campaign", help="add utm_source=catalogue&utm_medium=flipbook&utm_campaign=NAME to every URL")
    ap.add_argument("--report", help="write a JSON report of linked and unmatched codes")
    a = ap.parse_args()

    if not a.links and not a.url_template:
        sys.exit("Give --links CSV and/or --url-template, so the codes have somewhere to link to.")
    table = load_links(a.links) if a.links else {}
    code_re = re.compile(a.code_pattern)

    def url_for(code):
        u = table.get(code) or (a.url_template.replace("{code}", code) if a.url_template else None)
        if u and a.utm_campaign:
            u += ("&" if "?" in u else "?") + "utm_source=catalogue&utm_medium=flipbook&utm_campaign=" + a.utm_campaign
        return u

    plumb = pdfplumber.open(a.source)
    reader = PdfReader(a.source)
    writer = PdfWriter(clone_from=reader)          # keeps existing annotations, outlines, metadata
    links = defaultdict(list)
    report = {"linked": 0, "unmatched": [], "pages": 0}

    for i, p in enumerate(plumb.pages):
        bbox = p.bbox
        H = float(reader.pages[i].mediabox.top)
        words = [w for w in p.extract_words() if inside(w, bbox)]   # spreads: keep this page's half only
        codes = [w for w in words if code_re.fullmatch(w["text"])]
        if not codes:
            continue
        report["pages"] += 1

        def is_code(u):
            return code_re.fullmatch(u["text"]) is not None

        def neighbours(w):
            line = [u for u in words if u is not w and abs(u["top"] - w["top"]) < 2.5 and not is_code(u)]
            in_text = any(0 <= w["x0"] - u["x1"] < 8 or 0 <= u["x0"] - w["x1"] < 8 for u in line)
            return in_text, line

        # drawn swatch shapes: circles are curves; some catalogues use squares or small images
        shapes = [o for o in list(p.curves) + list(p.rects) + list(p.images)
                  if 12 <= o["x1"] - o["x0"] <= 60 and 12 <= o["bottom"] - o["top"] <= 60]

        def swatch_above(w):
            cx = (w["x0"] + w["x1"]) / 2
            hits = [o for o in shapes if abs((o["x0"] + o["x1"]) / 2 - cx) < 12 and 0 <= w["top"] - o["bottom"] <= 14]
            return min(hits, key=lambda o: w["top"] - o["bottom"]) if hits else None

        laid_out = []
        for w in codes:
            line_h = w["bottom"] - w["top"]
            # another code straight above/below within ~2.5 lines: a list or table column
            column = [u for u in codes if u is not w and abs(u["x0"] - w["x0"]) < 3 and 0 < abs(u["top"] - w["top"]) < 2.5 * line_h]
            in_text, line = neighbours(w)
            if column:                                   # list / table row
                step = min(abs(u["top"] - w["top"]) for u in column)
                x1 = w["x1"]
                for u in sorted(line, key=lambda u: u["x0"]):    # the rest of the row, across table columns
                    if u["x0"] >= x1 - 1 and u["x0"] - x1 < 120:
                        x1 = u["x1"]
                mid, half_h = (w["top"] + w["bottom"]) / 2, step / 2 - 1     # 2 pt gap between rows
                laid_out.append((w, "row", (w["x0"] - 3, mid - half_h, x1 + 3, mid + half_h)))
            elif in_text:                                # mentioned in a sentence
                laid_out.append((w, "text", (w["x0"] - 2, w["top"] - 2, w["x1"] + 2, w["bottom"] + 2)))
            else:                                        # swatch row
                cx = (w["x0"] + w["x1"]) / 2
                gaps = [abs((u["x0"] + u["x1"]) / 2 - cx) for u in codes if u is not w and abs(u["top"] - w["top"]) < 4]
                half = min([19] + [g / 2 - 3.5 for g in gaps])
                above = [u["bottom"] + 20 for u in codes if u is not w and u["top"] < w["top"] - 4
                         and abs((u["x0"] + u["x1"]) / 2 - cx) < 2 * half]
                sw = swatch_above(w)
                top = (sw["top"] - 3) if sw else (w["top"] - 33)
                top = max([top] + [b + 1 for b in above if b < w["top"]])
                if sw:
                    half = min(max(half, (sw["x1"] - sw["x0"]) / 2 + 2), min([19] + [g / 2 - 3.5 for g in gaps]))
                laid_out.append((w, "swatch", (cx - half, top, cx + half, w["bottom"] + 20)))

        # rows of one list share the widest row's width, so short rows still cover every column
        cols = defaultdict(list)
        for k, (w, how, r) in enumerate(laid_out):
            if how == "row":
                cols[round(w["x0"])].append(k)
        for ks in cols.values():
            right = max(laid_out[k][2][2] for k in ks)
            for k in ks:
                w, how, (x0, top, _, bottom) = laid_out[k]
                laid_out[k] = (w, how, (x0, top, right, bottom))

        boxed = {w["text"] for w, how, _ in laid_out if how != "text"}
        for w, how, (x0, top, x1, bottom) in laid_out:
            code = w["text"]
            if how == "text" and code in boxed:
                continue
            target = url_for(code)
            if not target:
                report["unmatched"].append([i + 1, code])
                continue
            x0, x1 = max(x0, bbox[0]), min(x1, bbox[2])
            links[i].append(((x0, H - bottom, x1, H - top), target))
            report["linked"] += 1

    for i, items in sorted(links.items()):
        for rect, target in items:
            ann = Link(rect=rect, url=target, border=[0, 0, 0])
            ann[NameObject("/NM")] = TextStringObject("swatch")
            writer.add_annotation(page_number=i, annotation=ann)

    with open(a.out, "wb") as f:
        writer.write(f)

    print(f"{report['linked']} links on {report['pages']} pages; {len(report['unmatched'])} codes without a link")
    for page, code in report["unmatched"][:20]:
        print(f"  no link for {code} (page {page})")
    if a.report:
        with open(a.report, "w") as f:
            json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
