# FileMind

> **Your files, organized locally.**
> Offline-first file organizer: rule engine + deterministic signals + an optional
> locally-trained ML model. Preview → approve → apply → undo. Nothing ever leaves
> your PC, nothing is ever deleted, nothing moves without your click.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![status](https://img.shields.io/badge/status-v0.1.0--alpha-orange)
![license](https://img.shields.io/badge/license-MIT-green)

## Why FileMind

File Juggler-style tools make you think in rigids rules and trust black boxes.
FileMind does the opposite: every suggestion shows **where it came from and how
sure it is**, and the whole pipeline is **reversible**.

| principle | what it means in practice |
|---|---|
| **Local by default** | No cloud, no accounts, no telemetry. ML inference runs on your CPU via ONNX. |
| **Confidence you can see** | ≥ 90% high (preselected) · 70–89% needs review · < 70% "not sure" — never proposed. |
| **Reversible by design** | Every apply batch is journaled and undoable from History. Duplicates are moved to a review folder, never deleted. |
| **Explainable** | Each suggestion states its reason: your rule, a deterministic signal, or the local model. |
| **Hard safety boundaries** | Moves are confined to folders you opted in; reserved Windows names, path escapes, symlink escapes and overwrites are structurally blocked. |

## Feature tour

- **Organize** — scan a folder, get a reviewable suggestion list with confidence
  badges, preview text content, approve exactly what you want, apply, undo.
- **Rules** — build rules visually *or* write a sentence:
  `move invoices to Documents/Finance when name contains invoice`.
  Parsing is a deterministic local grammar, not an AI service.
- **Duplicates** — size pre-grouping + streaming SHA-256. Exact matches only.
  Extras go to a review folder.
- **History** — every batch, every file move, one-click full undo (with
  `(restored)` conflict handling instead of overwrites).
- **Folder watching** — get notified when watched folders change; organizing
  still requires your click.
- **Local ML (optional)** — a from-scratch 3M-param Transformer (see
  [MODEL_CARD.md](MODEL_CARD.md)). Without it, rules + deterministic signals
  carry the app: `Local ML model not installed. Rule-based organization is active.`

## Quick start (development)

```bash
# 0. Prereqs: Node 20+, npm 10+
npm install

# 1. Run the app
npm run dev

# 2. Generate a safe demo corpus, then add it in Onboarding/Organize
npm run demo:files -- ./FileMindDemo

# 3. Tests + typecheck + build (CI runs the same)
npm run test        # 87 vitest tests
npm run typecheck   # strict TS, main + renderer
npm run build       # production renderer bundle
```

## Quick start (packaged app)

```bash
npm run package     # electron-builder → NSIS installer in release/
```

The installer includes `models/filemind-transformer.onnx` when present, so ML
works out of the box. Without it, FileMind runs fully on rules + deterministic
classification and says so honestly.

> **SmartScreen note:** release builds are unsigned by default, so Windows shows
> "Windows protected your PC" on first run — click *More info → Run anyway*.
> To publish signed installers (Azure Trusted Signing, Certum/SignPath certs),
> see [docs/SIGNING.md](docs/SIGNING.md) — it's secrets-only, no code changes.

### Troubleshooting

Everything FileMind does at startup is written to
`%APPDATA%\FileMind\logs\FileMind.log` (rotated, 3 × 1 MB, never any file
contents). If the app misbehaves, that log plus the in-app warnings are the
source of truth:

- **Missing/inaccessible folder** — FileMind opens normally and shows a
  dismissible warning; pick a working folder in Settings. No reinstall needed.
- **Corrupted database** — the damaged file is kept as
  `filemind.db.corrupt-<timestamp>` and a fresh one is created; the app opens.
- **App already running** — launching again focuses the existing window.

## Local ML — the honest path

FileMind never fakes intelligence. Three models, all trained **from scratch**:

| model | params | role | status |
|---|---|---|---|
| A · TF-IDF + LogisticRegression | — | sanity-check floor | ✅ trained (see MODEL_CARD) |
| B · TextCNN | 636k | fast mid-tier | ✅ trained (see MODEL_CARD) |
| C · FileTransformer | 2.98M | default local classifier | ✅ trained on synthetic v1; retrain on your data for real numbers |

```bash
python ml/training/prepare_dataset.py --synthetic          # or --from-scan manifest.jsonl
python ml/training/train_transformer.py                    # CPU-friendly
python ml/evaluation/evaluate.py                           # real metrics only
python ml/export/export_onnx.py                            # → models/filemind-transformer.onnx
```

Prefer a zero-setup GPU run: open `ml/colab/FileMind_Training.ipynb` in Colab.
Numbers, caveats and provenance: [MODEL_CARD.md](MODEL_CARD.md) ·
[DATASET_CARD.md](DATASET_CARD.md).

## Architecture in one breath

```
Electron main (Node)                      Renderer (React + Tailwind)
├─ scanner (cancellable, queue-based)     ├─ Home dashboard
├─ text extraction (PDF/DOCX/TXT/…)       ├─ Organize (preview/approve/apply)
├─ rule engine + sentence parser          ├─ Rules (visual + sentence builder)
├─ deterministic classifier               ├─ Duplicates
├─ ONNX classifier (optional, graceful)   ├─ History (per-batch undo)
├─ planner (rules → deterministic → ML)   └─ Settings / Onboarding
├─ transaction engine (journal + undo)          │ preload bridge (contextBridge)
└─ SQLite (better-sqlite3, migrations) ◄────────┘
```

Details with diagrams: [docs/architecture.md](docs/architecture.md).
Competitive research: [docs/research.md](docs/research.md).

## Database

SQLite via better-sqlite3 with a versioned migration table
(`src/main/db/database.ts`): `settings · categories · files · rules ·
suggestions · history · undo_log`. The undo journal is written **before** any
filesystem change (write-ahead), so a crash mid-apply never strands a file.

## Roadmap

- [x] v0.1.0 — organize pipeline, rules, duplicates, history/undo, watcher, local ML
- [ ] v0.2 — per-folder rule scoping, scheduled scans, content-based dedupe threshold tuning
- [ ] v0.3 — retrain loop from user-confirmed suggestions (privacy-preserving, local-only)

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
All filesystem logic changes require tests — the test suite is the safety net.

## License

[MIT](LICENSE)
