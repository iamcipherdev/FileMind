# FileMind architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                             Electron main (Node)                           │
│                                                                            │
│  ┌──────────┐   ┌──────────────────────────────────────────────────────┐   │
│  │ ipc.ts   │◄──┤ services/                                            │   │
│  │ (typed   │   │                                                      │   │
│  │  bridge) │   │  scanner.ts ──► textExtract.ts ──┐                   │   │
│  └────┬─────┘   │  (cancellable,                   │                   │   │
│       │         │   queue-based, no symlinks)      │                   │   │
│       │         │                                  ▼                   │   │
│       │         │  ┌────────────────────────────────────────┐          │   │
│       │         │  │ planner.ts   (authority ladder)        │          │   │
│       │         │  │  1. ruleEngine  (user rules)           │          │   │
│       │         │  │  2. deterministic (ext/name evidence)  │          │   │
│       │         │  │  3. classifier  (ONNX, optional)       │          │   │
│       │         │  └───────────────┬────────────────────────┘          │   │
│       │         │                  ▼                                   │   │
│       │         │  suggestion queue ─► transaction.ts ─► undo_log      │   │
│       │         │  (SQLite)            (write-ahead      (SQLite)      │   │
│       │         │                       journal)                        │   │
│       │         │                                                      │   │
│       │         │  duplicates.ts (SHA-256)  watcher.ts (chokidar)      │   │
│       │         │  demoFiles.ts             ruleParser.ts (grammar)    │   │
│       │         └──────────────────────────────────────────────────────┘   │
│       │                                                                    │
│  ┌────▼─────────┐                                                          │
│  │ db/database  │  better-sqlite3, WAL, versioned migrations               │
│  │ db/repository│  settings·categories·files·rules·suggestions·            │
│  └──────────────┘  history·undo_log                                       │
└───────────────▲────────────────────────────────────────────────────────────┘
                │ contextBridge: window.filemind (typed FilemindApi)
┌───────────────┴────────────────────────────────────────────────────────────┐
│                        Renderer (React 18 + Tailwind)                      │
│  Home · Organize (preview/approve/apply) · Rules (visual + sentence)       │
│  Duplicates · History (per-batch undo) · Settings · Onboarding             │
└────────────────────────────────────────────────────────────────────────────┘
```

## The authority ladder (planner.ts)

For every scanned file, in order:

1. **User rules** (`ruleEngine.matchRules`, priority ascending) — a match ends
   the ladder. Confidence 0.99, reason `rule`.
2. **Deterministic classifier** — extension table + strong name patterns
   (`deterministic.ts`). Known extension → 0.97; fuzzy name pattern → 0.72;
   nothing conclusive → `other` @ 0.30 (never proposed).
3. **Local ML** (`classifier.ts`, ONNX) — only consulted if a model is
   installed. Agreement with layer 2 *blends up* confidence
   (`blendConfidence`, capped 0.99); disagreement keeps the ML category at its
   own confidence and *explains both signals* in the detail string.
4. **Thresholds** (`confidence.ts`) — ≥ 0.90 `high` (preselected),
   ≥ 0.70 `review` (shown), else `low` (only in "Not sure", never proposed).

Policy guard: cautious extensions (`.exe .msi .bat .cmd .ps1 .js …`) are
classified but **never auto-suggested** — only an explicit user rule may move them.

## The transaction engine (transaction.ts)

Apply is a three-phase transaction:

1. **Validate all** — `assertSafeDestination` (absolute, inside an organize
   root, no reserved names, no `<>:"|?*`, no trailing dot/space segments,
   ≤ 260 chars), source≠dest.
2. **Journal first** — one `undo_log` row per op **before** any filesystem
   call (write-ahead). A crash mid-apply leaves a complete journal.
3. **Execute** — per-item try/catch; `fs.rename` within/between dirs;
   destination collision resolves as `name (2).ext`, never overwrite; folder
   destinations refuse file overwrites; source re-checked at execution time
   (race protection).

Undo reverses the journal newest-first. If the original spot was taken since,
the file comes back as `name (restored).ext` — overwriting is forbidden,
always. Double-undo is refused with an explanation.

## Safety layer (safety.ts) — every path passes through it

| threat | countermeasure |
|---|---|
| path traversal out of organize roots | `isInsideRoot` on every destination; prefix-sibling attacks rejected (`root` vs `root-evil`) |
| symlink/junction escape | scanner never follows links; `assertRealDirectory` rejects symlinked folders |
| Windows reserved names | `CON PRN AUX NUL COM1-9 LPT1-9` blocked as stem or name |
| illegal Windows characters | blocked in destinations and in rename/sanitize output |
| trailing dot/space trimming collisions | blocked on every path segment |
| long-path failures | 260-char guard with actionable message |
| file-over-file races | re-stat at execution; conflict-suffix fallback |
| accidental deletion | no delete operation exists in v1; duplicates are quarantined by move |
| system areas | `Windows`, `AppData`, `Program Files`, `$Recycle.Bin`… are protected dirs; scanner skips them |

## ML integration (classifier.ts) — degradation contract

`createMlClassifier()` dynamically requires `onnxruntime-node` and
`models/filemind-transformer.onnx`. Any missing piece → a status message:

> *Local ML model not installed. Rule-based organization is active.*

…and the pipeline continues with layers 1–2 only. The app never crashes,
never fabricates scores, never claims a model exists when it doesn't.
Tokenization on the JS side mirrors `ml/filemind_ml/tokenizer.py`
(`vocab.json` + `<pad>=0 <unk>=1 <cls>=2 <sep>=3`, max 64 tokens).

## Data flow of one Organize session

```
user picks folder → scan:start (IPC)
  → scanFolders (queue, cancellable, yields every 25 files)
  → per file: extractText (≤2MB budget) → ml.predict? → planForFile
  → suggestions persisted (SQLite) → scan-done event
user reviews (approve/reject per item; high-tier preselected)
applySuggestions → TransactionEngine.apply(journal) → ApplyResult
history row; Undo reverses the whole batch from anywhere
```

## Testing strategy

- **Pure unit** — safety, rules, parser, confidence, planner (87 tests, vitest).
- **Real FS integration** — transaction tests run against `mkdtemp` dirs and
  verify actual moves/restores/overwrites-refusals.
- **ML parity** — PyTorch vs ONNX outputs compared numerically at export time
  (max diff ~2e-6); app-level degradation covered by the classifier's contract.
- CI (GitHub Actions) runs typecheck + tests + renderer build on every push.
