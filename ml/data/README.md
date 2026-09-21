# FileMind dataset

A dataset is a list of records with exactly three fields:

```json
{"name": "invoice_2026_03_acme.pdf", "content": "invoice total due", "label": "documents"}
```

| field     | type   | notes                                                        |
|-----------|--------|--------------------------------------------------------------|
| `name`    | string | the file name including extension (primary signal)           |
| `content` | string | extracted text snippet, `""` if none (PDF/DOCX/TXT/MD/CSV)   |
| `label`   | string | one of the 13 category ids below                             |

Labels (fixed order, shared with the app and `models/labels.json`):

`documents, spreadsheets, presentations, images, videos, audio, archives, code, design, fonts, data, books, other`

## Two ways to get a dataset

### 1. Synthetic (for a first run only)

```bash
python ml/training/prepare_dataset.py --synthetic --per-class 800 --out ml/data/dataset.jsonl
```

Deterministic (seed 13), template-generated. **Metrics on synthetic data are
inflated** — templates make classes easy to separate. Never quote synthetic
numbers as production accuracy.

### 2. Your real files (recommended)

Build a manifest JSONL from your own machine (or from files you are allowed
to use). Each line needs `name`, `content`, `label`. You can produce it with
a tiny script — no FileMind internals required:

```python
# make_manifest.py — run wherever your files live
import json, sys
from pathlib import Path

LABELS = {"pdf": "documents", "docx": "documents", "txt": "documents", "md": "documents",
          "xlsx": "spreadsheets", "pptx": "presentations", "jpg": "images", "jpeg": "images",
          "png": "images", "mp4": "videos", "mp3": "audio", "zip": "archives",
          "py": "code", "ts": "code", "csv": "data", "json": "data"}

rows = []
for p in Path(sys.argv[1]).rglob("*"):
    if p.is_file() and p.suffix.lower().lstrip(".") in LABELS:
        snippet = ""
        if p.suffix.lower() in {".txt", ".md", ".csv"} and p.stat().st_size < 1_000_000:
            snippet = p.read_text(errors="ignore")[:400]
        rows.append({"name": p.name, "content": snippet, "label": LABELS[p.suffix.lower().lstrip(".")]})

with open("manifest.jsonl", "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"{len(rows)} rows")
```

Then:

```bash
python ml/training/prepare_dataset.py --from-scan manifest.jsonl --out ml/data/dataset.jsonl
```

## Privacy rules for datasets

- Content snippets are processed locally; nothing is uploaded by FileMind itself.
- If you train on other people's files, you are responsible for having the right to use them.
- Do not commit private manifests to the repo. `ml/data/dataset.jsonl` is git-ignored if it contains real data — keep it that way.

## Splits

`stratified_split()` in `ml/filemind_ml/dataset.py` — 80/10/10 per class, seed 13.
All three training scripts and evaluate.py use the same split function so
numbers are comparable.
