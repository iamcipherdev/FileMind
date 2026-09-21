# Changelog

All notable changes documented per Keep a Changelog; versioning per SemVer.

## [0.1.2] — 2026-09-21

### Fixed
- Folder-selection startup failure: after picking a folder, relaunching
  FileMind could briefly flash and disappear on Windows. Root causes removed:
  - the SQLite database is now closed cleanly on quit (no stale WAL files and
    no lock contention with the next launch);
  - a single-instance lock now focuses the running window instead of letting
    two processes contend for the same database;
  - database opens retry with a 5-second busy timeout (antivirus/indexer
    locks right after exit no longer break startup);
  - a corrupted database is quarantined (kept, never deleted) and recreated,
    so the app always opens — reinstalling is never needed;
  - the main window now has a forced-show fallback (ready-to-show,
    did-finish-load and a watchdog) and a crashed renderer is recreated, so
    the window can no longer end up invisible;
  - saved settings tolerate corrupted JSON: bad values fall back to safe
    defaults (or are salvaged) instead of failing startup.
- Push events (scan progress, apply results) never reached the UI: the main
  window reference was captured before the window existed. Folder dialogs are
  now properly modal, and events are delivered again.
- Local ML model could not load on Windows: onnxruntime DLLs were packaged
  inside app.asar where Windows cannot load them from. They are now unpacked
  next to the native binding; ONNX session failures also degrade gracefully
  to the rule engine instead of rejecting.

### Added
- Local diagnostics log at `%APPDATA%/FileMind/logs/FileMind.log` (rotated,
  3 × 1 MB): startup, configuration, database recovery, scanner, watcher,
  window state, uncaught exceptions. No file contents are logged.
- Saved folders that went missing, became unreadable or are protected are
  reported as a dismissible, non-blocking warning; FileMind opens normally.
- Watchers refuse FileMind's own runtime/config/log directories and are
  fully disposed before re-watching (no duplicates, no self-loops).
- The scanner skips FileMind's own runtime paths even when a parent folder
  (e.g. the user profile) is selected.

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
