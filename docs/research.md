# Product research — how FileMind positions itself

Researched: 2026-09 (web sources + product documentation of the tools below).
Method: feature inventory → workflow analysis → safety-model comparison →
differentiation. No UI was copied from any product; findings informed behavior
and safety design only.

## 1. Competitive landscape

### File Juggler (Windows, paid)
- **What it does well:** real-time folder monitoring, condition→action rules
  (name, extension, date, content via OCR-ish parsing), broad actions
  (move/rename/extract attachments), set-and-forget automation.
- **Where it falls short (our take):** automation-first means files move
  *without you watching*; there is no confidence story — a rule matches or it
  doesn't, and content heuristics either fire or silently don't; undo exists
  but is not the center of the product; no ML layer, so "loose files with no
  rule" stay unorganized.
- **What we borrowed:** the value of *content* conditions (we support
  `contentContains` with local text extraction) and the idea that rules should
  outrank everything else.
- **What we rejected:** silent automatic moves. In FileMind nothing moves
  without an explicit apply click.

### Hazel (macOS, paid)
- **What it does well:** beautifully deep rule conditions, watches + scheduled
  runs, "keep folder clean" semantics, mature AppleScript integration.
- **Where it falls short:** same automation-first trust model (rules run in the
  background); no preview-the-batch-first workflow; macOS-only; no confidence
  surface — the user writes conditions that anticipate every case.
- **What we borrowed:** respect for rule *priorities* (lower number wins) and
  per-rule enable toggles.
- **What we rejected:** background-by-default organizing; and we consciously
  stayed cross-platform-friendly (Electron) instead of OS-bound.

### Microsoft Power Automate Desktop (Windows, free-ish)
- **What it does well:** general-purpose RPA; file flows are a subset; deep
  Windows integration; enterprise connectors.
- **Where it falls short:** massive overkill and cognitive load for "tidy my
  Downloads"; flows are imperative and brittle; nothing about file
  classification intelligence; cloud dependencies and account requirements in
  several paths.
- **What we borrowed:** nothing structural — the contrast itself is the lesson:
  FileMind is a *focused tool*, not a platform.
- **What we rejected:** connectors/cloud entirely. FileMind's offline posture
  is a feature, not a gap.

### Matrix Organizer / FileOptimizer-style utilities (assorted)
- Various one-click sorters exist. Common problems: taxonomy is baked in,
  no transparency on *why* a file went where, no undo, and several re-classify
  on every run which moves files back and forth. FileMind's planner is
  idempotent per batch and always previewed.

## 2. The gap FileMind fills

| dimension | File Juggler | Hazel | Power Automate | **FileMind** |
|---|---|---|---|---|
| organizing model | background rules | background rules | flows | **preview → approve → apply** |
| confidence surfaced | none | none | none | **three tiers, per file** |
| ML classification | none | none | none | **local ONNX, optional, honest fallback** |
| explainability | rule id | rule id | flow step | **per-suggestion reason string** |
| undo | basic | partial | flow-level | **batch journal, one click, conflict-safe** |
| duplicates | none | none | scriptable | **SHA-256, quarantine-not-delete** |
| runs offline | yes | yes | partially | **yes, 100%** |
| delete protection | settings | settings | none | **structural: no delete path exists in v1** |

## 3. Non-goals (from the research)

- Chat-style "AI file assistant" — toys with trust; rules + confidence do the job.
- Cloud sync/account anything.
- Automatic anything. The watcher *notifies*; it never organizes.
- OCR. Text extraction covers the digital-PDF case; scanned-PDF content rules
  simply don't fire (and the UI says so in the preview drawer).

## 4. Design decisions traceable to this research

1. **Confidence tiers (0.90/0.70)** — direct answer to "black box moves".
2. **Write-ahead undo journal** — direct answer to trust: apply is a
   transaction, undo is first-class in History.
3. **Sentence rule parser is deterministic** — after watching rule tools
   misfire on misparsed intent, we made ambiguity a *hard error with hints*,
   never a guessed rule.
4. **Cautious extensions** (`.exe`, `.ps1`, `.js`, …) are classified but never
   auto-suggested — automation tools treating installers like documents is a
   real failure mode we chose to close structurally.
5. **Duplicates go to a review folder** — every "cleanup" tool that deletes
   creates a horror story; ours cannot.
