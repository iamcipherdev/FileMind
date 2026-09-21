# FileMind — Promotion copy (CV / GitHub / LinkedIn)

## CV bullet (pick one line, or the two-line variant)

**One-liner (senior/lead flavor):**
> Built FileMind, an offline-first Electron/TypeScript file organizer with a preview-approve-apply pipeline, a write-ahead undo journal, and a from-scratch 3M-param ONNX transformer classifier — 87 tests covering path-escape, overwrite and undo-safety invariants.

**Two-line variant (full-stack + ML flavor):**
> Designed and shipped FileMind (Electron + React + TypeScript + SQLite): hybrid file classification (user rules → deterministic signals → local ONNX transformer), conflict-safe reversible transactions, and SHA-256 duplicate quarantine — no cloud, no deletions, fully undoable.
> Trained all ML from scratch (TF-IDF baseline, TextCNN, custom 4-layer Transformer; PyTorch→ONNX parity ≤ 2.4e-6) and documented metrics honestly in a MODEL_CARD.

## GitHub repo "About" (short, ≤ 350 chars)

> Your files, organized locally. Offline-first file organizer: rule engine + deterministic signals + an optional from-scratch local transformer (ONNX). Preview → approve → apply → undo. Nothing leaves your PC, nothing is deleted, every batch is reversible. Electron · React · TypeScript · SQLite · PyTorch.

**Topics:** `electron` `typescript` `react` `sqlite` `onnx` `machine-learning` `file-organizer` `privacy` `local-first` `pytorch`

## LinkedIn launch post

---

I kept losing files in Downloads, and every "AI organizer" I tried wanted either my cloud account or my blind trust — files moving in the background with no way to see why.

So over the past weeks I built FileMind. It's an offline-first file organizer with a different contract:

▸ Preview → approve → apply. Nothing ever moves without your click.
▸ Every suggestion shows its confidence AND its reason (your rule? extension evidence? local model?).
▸ Every apply batch is journaled and undoable in one click — restores are conflict-safe instead of overwriting.
▸ Duplicates are matched by SHA-256 and moved to a review folder. The app literally has no delete path.
▸ The ML part is honest: a small transformer I trained from scratch (no pretrained weights), exported to ONNX, running on your CPU. No model installed? The app tells you and runs on rules + deterministic signals. No fake numbers anywhere — the MODEL_CARD shows what was measured and on what.

Tech: Electron · React · TypeScript (strict) · SQLite (better-sqlite3 + write-ahead undo journal) · PyTorch → ONNX · 87 tests covering the safety invariants.

Repo with docs, architecture deep-dive and the training pipeline:
🔗 [repo link]

If "offline-first + reversible by design" sounds like your kind of software, I'd love your feedback — especially on the confidence thresholds (0.90 / 0.70 defaults).

#localfirst #typescript #electron #machinelearning #privacy

---

## Screenshot/asset checklist for the GitHub README & launch post
1. Organize page with a mix of High / Needs-review / Not-sure badges visible.
2. History page showing an applied batch + the Undo button.
3. Settings → "Local ML model not installed. Rule-based organization is active."
4. Rules page: the sentence parser accepting a phrase and showing what it understood.
