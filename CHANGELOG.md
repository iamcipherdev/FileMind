# Changelog

All notable changes documented per Keep a Changelog; versioning per SemVer.

## [0.1.1] — 2026-09-21

### Added
- Optional code signing in the release workflow: Azure Trusted Signing
  (`AZURE_*` secrets) or traditional PFX (`CSC_LINK`/`CSC_KEY_PASSWORD`).
  Skips automatically when secrets are absent. See docs/SIGNING.md.

### Fixed
- Packaged Windows app hung on "Loading FileMind…": the installer shipped a
  better-sqlite3 binary built for Node instead of the Electron ABI
  (electron-builder skips existing binaries without verifying the ABI).
  Release now force-rebuilds for Electron before packaging and verifies the
  packaged native module loads under Electron, failing the build otherwise.
- Startup errors are now surfaced on screen with a Retry button instead of an
  indefinite loading state.

## [0.1.0] — 2026-09-21

### Added
- Core organize pipeline: scan (cancellable) → analyze → suggest → preview →
  approve → apply → log → undo.
- Hybrid classification: user rules → deterministic signals → local ONNX
  transformer (optional, graceful fallback), with confidence tiers
  (high ≥ 0.90 / review ≥ 0.70 / low never proposed).
- Rule engine with visual builder + deterministic sentence parser
  ("move invoices to Documents/Finance when name contains invoice").
- Transaction engine: write-ahead undo journal, conflict-safe destinations,
  `(restored)` conflict handling, batch undo from History.
- Duplicates: size grouping + streaming SHA-256; extras quarantined by move,
  never deleted.
- Text extraction for PDF/DOCX/TXT/MD/CSV with hard size budget.
- Folder watcher with debounce (notify-only, never auto-organizes).
- Local SQLite persistence (better-sqlite3, migrations: settings, files,
  rules, suggestions, history, undo_log).
- Onboarding, Settings (thresholds, extraction budget, organize roots).
- `npm run demo:files` safe demo corpus generator.
- ML pipeline: dataset tools, three from-scratch models (TF-IDF+LR,
  TextCNN, FileTransformer ~3M params), real evaluation, ONNX export,
  Colab notebook. MODEL_CARD/DATASET_CARD with measured numbers and caveats.
- Tests: 87 vitest tests incl. real-filesystem transaction integration.
- CI: typecheck + tests + renderer build; release workflow builds Windows
  installer on tags.
