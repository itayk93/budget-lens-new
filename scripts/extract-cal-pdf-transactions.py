#!/usr/bin/env python3
import csv, glob, json, os, re, sys
from collections import defaultdict
import pdfplumber

PDF_PATTERNS = [pattern for pattern in os.environ.get("CAL_PDF_PATTERNS", "").split(os.pathsep) if pattern]
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/cal_pdf_transactions.csv"
DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(20\d{2})$")
AMOUNT_RE = re.compile(r"^-?[\d,]+\.\d{2}$")
HEBREW_RE = re.compile(r"[\u0590-\u05ff]")

def fix_token(s):
    return s[::-1] if HEBREW_RE.search(s) else s

def join_visual(words):
    # PDF stores Hebrew glyphs backwards. Descending x restores reading order.
    return " ".join(fix_token(w["text"]) for w in sorted(words, key=lambda z: z["x0"], reverse=True)).strip()

def canonical_key(row):
    name = re.sub(r"[^0-9a-z\u0590-\u05ff]+", "", row["business_name"].lower())
    return (row["payment_date"], f'{row["amount"]:.2f}', name)

def extract_pdf(path):
    rows = []
    with pdfplumber.open(path) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            date_words = [w for w in words if DATE_RE.match(w["text"])]
            for dw in date_words:
                d, m, y = DATE_RE.match(dw["text"]).groups()
                iso = f"{y}-{m}-{d}"
                if iso > "2022-12-31":
                    continue
                same = [w for w in words if abs(w["top"] - dw["top"]) <= 1.8]
                # Transaction date is rightmost table column, not narrative/detail date.
                if dw["x0"] < page.width * 0.78:
                    continue
                amounts = [w for w in same if AMOUNT_RE.match(w["text"]) and page.width * 0.22 < w["x0"] < page.width * 0.38]
                if not amounts:
                    continue
                amount_word = min(amounts, key=lambda w: w["x0"])
                amount = float(amount_word["text"].replace(",", ""))
                # Columns are stable proportionally across statement generations.
                merchant_words = [w for w in same if page.width * 0.75 < w["x0"] < dw["x0"] - 1]
                category_words = [w for w in same if page.width * 0.68 < w["x0"] <= page.width * 0.76]
                merchant = join_visual(merchant_words)
                source_category = join_visual(category_words)
                if not merchant or merchant in {"שם בית העסק", "בית העסק", "שם"}:
                    continue
                rows.append({
                    "payment_date": iso,
                    "business_name": merchant,
                    "amount": amount,
                    "source_category": source_category,
                    "source_file": os.path.basename(path),
                    "source_page": page_no,
                })
    return rows

if not PDF_PATTERNS:
    raise SystemExit("Set CAL_PDF_PATTERNS to one or more PDF globs separated by the OS path separator")

paths = sorted({p for pattern in PDF_PATTERNS for p in glob.glob(pattern)})
all_rows = []
per_file = {}
for path in paths:
    rows = extract_pdf(path)
    all_rows.extend(rows)
    per_file[os.path.basename(path)] = len(rows)

# Exact duplicate statements exist with suffixes such as "(1)". Keep one record.
deduped, seen = [], set()
for row in all_rows:
    key = canonical_key(row)
    if key in seen:
        continue
    seen.add(key)
    deduped.append(row)

deduped.sort(key=lambda r: (r["payment_date"], r["business_name"], r["amount"]))
with open(OUT, "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=list(deduped[0].keys()) if deduped else ["payment_date","business_name","amount","source_category","source_file","source_page"])
    writer.writeheader()
    writer.writerows(deduped)

print(json.dumps({"pdf_files": len(paths), "raw": len(all_rows), "deduped": len(deduped), "output": OUT, "per_file": per_file}, ensure_ascii=False))
