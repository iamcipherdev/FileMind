# Contributing to FileMind

Thanks for helping build the most trustworthy file organizer.

## Ground rules
1. **Safety-first diffs.** Anything touching `services/safety.ts`,
   `services/transaction.ts`, or the scanner needs tests that prove the old
   guarantees still hold. If your change could move or lose a file, over-engineer.
2. **No fake intelligence.** Never add fabricated metrics, placeholder
   "training", or cloud calls. ML claims live in MODEL_CARD.md and must cite
   their measurement.
3. **No network code.** The offline posture is a feature.

## Dev setup
```bash
npm install
npm run dev          # app
npm run test         # vitest
npm run typecheck    # tsc strict, main + renderer
```

## Python ML side
```bash
python -m venv .venv && source .venv/bin/activate   # or use Colab
pip install scikit-learn joblib torch onnx onnxruntime onnxscript
python ml/training/train_baseline.py
```

## Commit / PR style
- Conventional-ish prefixes: `feat:`, `fix:`, `safety:`, `ml:`, `docs:`, `test:`.
- One logical change per PR. Include the "why" in the description.
- New features need: implementation + tests + README/MODEL_CARD updates where
  relevant.

## Issue reports that help
- FileMind version, OS, exact suggestion text you saw.
- For misfires: what the suggestion said, what you expected, and the
  confidence tier shown. That triple is the fastest path to a fix.
