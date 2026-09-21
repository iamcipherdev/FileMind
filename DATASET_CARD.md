# FileMind Dataset Card — synthetic-v1 (and the path to real data)

**Version:** v1 · **Date:** 2026-09-21 · **License:** MIT (code + generator); dataset is generated, not distributed

## Purpose

Training corpus for FileMind's local file-category models. Records pair a
**file name** (and optional text snippet) with one of **13 category labels**,
mirroring exactly what the app can observe at scan time: file name, extractable
text, nothing else. No personal data, no external corpus, no scraping.

## Schema

JSONL, one record per line:

```json
{"name": "invoice_2026_03_acme.pdf", "content": "invoice total due", "label": "documents"}
```

Full field spec and label list: `ml/data/README.md`.

## Composition (synthetic-v1)

| property | value |
|---|---|
| generator | `ml/training/prepare_dataset.py --synthetic` (seed 13) |
| classes | 13 (documents, spreadsheets, presentations, images, videos, audio, archives, code, design, fonts, data, books, other) |
| per class | 600 → 7,800 rows total |
| content snippets | present for text-ish classes (~80% of those rows), `""` for binaries |
| split | stratified 80/10/10 per class (train 6,240 / val 780 / test 780) |
| known bias | template names → class separation is easy; metrics inflate (see MODEL_CARD.md honesty note) |

## How this dataset was made

Templates per class (e.g. `budget_{year}.xlsx`, `IMG_{n}.jpg`, `utils_{n}.py`)
are filled with random dates, ids and client/topic words from fixed wordlists.
The generator is committed, deterministic and auditable — re-running it
reproduces the same rows. No file was copied from any real filesystem, no
external dataset was downloaded.

## Real-data upgrade path

The same schema accepts manifests from your own machine
(`--from-scan manifest.jsonl`). A ready-made extraction script is in
`ml/data/README.md`. When you retrain on real data, fill this table:

| | |
|---|---|
| source of files | _(fill: whose files, what folders, with what permission)_ |
| rows / per class | _(fill)_ |
| date | _(fill)_ |
| notes | _(fill: content snippets included? languages? odd cases?)_ |

## Limitations & ethical notes

- English-flavored names only; non-Latin scripts will tokenize to `<unk>` often → low confidence by design.
- Content snippets cap at 400 chars per record (matches the app's extraction budget).
- If you build a manifest from files you don't own, you are responsible for usage rights.
- The dataset records file *names and snippets*, never full file contents, never paths — so it cannot leak directory structures.
