# Changelog

All notable changes documented per Keep a Changelog; versioning per SemVer.

## [0.1.4] — 2026-09-22

### Changed — architecture: ML is isolated and lazy; watching is explicit
- `ml:status` no longer initializes ONNX: it performs lightweight file/package
  checks only. Opening the app can never touch the native ML stack.
- onnxruntime-node now runs in an **isolated Electron utilityProcess**
  (`src/main/ml/worker.ts`). A native fault in the ML runtime can no longer
  terminate FileMind: the worker dies, the failure is caught, and the
  deterministic/rule classifier continues (honest fallback, no fabricated
  results). Bounded retries; explicit `ml:warmup` for tests/opt-in.
- ML initializes **lazily on first real classification** (scan pipeline),
  never on startup.
- Selecting organize folders during onboarding no longer silently enables
  filesystem watching: `watchedFolders` starts empty and watching is an
  explicit opt-in in Settings.
- `watcher.update()` is awaited, caught and logged at every call site
  (settings save, watcher start, UI-ready).

### Added — crash-isolation experiment + installed-app E2E
- Diagnostic variants A/B/C (ONNX disabled / watcher disabled / both) with
  compile-time prevention of the actual code paths and lifecycle markers
  (HOME_MOUNTED, ML_STATUS_REQUESTED, ONNX_REQUIRE_*, ONNX_SESSION_*,
  WATCHER_*, ML_WORKER_*, PROCESS_EXIT) in the synchronous bootstrap log.
- The release pipeline now runs the REAL reproduction before publishing:
  silent NSIS install → clean user data → real onboarding with a picked
  folder → Home → ml:status → isolated ML warmup (packaged ONNX session
  proven) → watcher opt-in → 30s dwell → graceful close → 5 relaunch cycles
  with process-liveness checks. The release fails unless every step passes.

### Fixed
- Windows test portability (tests no longer create usable folders inside
  `AppData`, which FileMind's own protection rules correctly refuse) and
  vitest env isolation (forked pool). Windows runners now fail the build
  when tests fail — pwsh previously masked `npm run test` exit codes, so
  Windows-only test failures had been invisible in earlier releases.

## [0.1.3] — 2026-09-22

### Added — early-startup instrumentation (provable startup, no more silent exits)
- `%TEMP%\FileMind-bootstrap.log`: written synchronously (flushed line by line)
  from the absolute first executable line of the app — BEFORE settings,
  database, folders, tray, watchers, scanning, window or native modules.
  Records `BOOTSTRAP: PROCESS STARTED`, the ordered steps 01–15 (entrypoint,
  environment, user-data path, config, database, window creation, UI load,
  tray-by-design note, folder restoration, scanner, watcher) and
  `BOOTSTRAP COMPLETE`. A process that dies early can no longer do so without
  leaving an exact record of the last step reached.
- Resource audit in the bootstrap log (`RESOURCE: expected/exists/readable`)
  for the frontend bundle, preload script, model files and the native
  better-sqlite3 / onnxruntime binaries — a packaging mistake is provable
  from the log alone.
- Global fatal handlers installed before everything else: uncaughtException,
  unhandledRejection, renderer crash (`render-process-gone`), GPU/utility
  child-process crash (`child-process-gone`) and process exit code are all
  written to the bootstrap log even when the normal logger is not up yet.
- A startup failure now shows a native error dialog pointing at the bootstrap
  log path instead of letting the process disappear silently.
- The single-instance lock result is logged (`acquired` / `DENIED — exiting by
  design`). Previously a still-running (zombie) previous instance made every
  new double-click vanish in a fraction of a second with zero trace; that
  exact scenario is now provable in the log and the running window is focused.
- CI release pipeline now smoke-tests the PACKAGED app itself: after building
  the installer, `FileMind.exe` is launched twice on the build runner and the
  release fails unless the process stays alive and reaches
  `BOOTSTRAP COMPLETE` both times (native-ABI verification remains in place).

### Fixed
- Uncaught-exception handlers were registered after the single-instance
  check and only inside `app.whenReady()`; anything failing earlier could
  kill the process invisibly. Handlers now exist from the first module load.
- `app.whenReady()` startup chain had no rejection handler — a throw during
  `wireIpc()`/window creation left a windowless process. It is now wrapped,
  logged, surfaced in a dialog and cannot strand the app invisibly.
- `process.stdout.write` in the logger could throw in packaged GUI mode
  (no console attached); writes are now guarded — the file log is unaffected.

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
