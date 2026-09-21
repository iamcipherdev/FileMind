# Security Policy

FileMind organizes files on real machines. The security posture is the product.

## Supported versions
| version | supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability
Open a private security advisory via GitHub ("Report a vulnerability") or email
the maintainer. Please include: affected component (scanner / transaction /
rule engine / classifier), a minimal reproduction, and the impact you see.
We aim to acknowledge within 72 hours.

## Guarantees in v0.1.0 (design-level)

1. **No deletion path.** The codebase contains no unlink/remove of user files.
   Duplicate handling moves extras to a review folder.
2. **No automatic moves.** Every filesystem change is triggered by an explicit
   user apply action.
3. **Confinement.** Destinations must resolve strictly inside a user-declared
   organize root. Symlinks/junctions are never followed; traversal, sibling-
   prefix escapes, reserved device names, illegal characters and >260-char
   paths are rejected with actionable errors (`src/main/services/safety.ts`).
4. **Write-ahead undo journal.** Changes are reversible; journals live in the
   local SQLite DB only.
5. **No network.** No telemetry, no accounts, no model downloads at runtime.
   ML inference is local ONNX.
6. **Renderer isolation.** `contextIsolation: true`, `nodeIntegration: false`,
   CSP set in index.html; the preload exposes a typed, minimal API.

## Known limitations (not vulnerabilities, but be aware)
- The rule sentence parser is a grammar; ambiguous phrases fail loudly with
  hints instead of guessing (by design).
- Path length guard assumes default Windows limits unless long-path opt-in is
  configured system-wide.
- Content extraction parses only PDF/DOCX/TXT/MD/CSV up to a 2 MB budget;
  parser bugs there cannot execute code, but may miss text.
