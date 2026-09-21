"""Train Model A — TF-IDF + Logistic Regression baseline.

Usage:
  python train_baseline.py --data ml/data/dataset.jsonl --out ml/artifacts/baseline.joblib

Prints real held-out metrics (accuracy, macro-F1). No numbers are invented;
this script only reports what it measures.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from filemind_ml.dataset import features, load_dataset_jsonl, stratified_split  # noqa: E402
from filemind_ml.models.baseline import BaselineClassifier  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="ml/data/dataset.jsonl")
    ap.add_argument("--out", default="ml/artifacts/baseline.joblib")
    args = ap.parse_args()

    samples = load_dataset_jsonl(args.data)
    train, val, test = stratified_split(samples)
    print(f"samples: train={len(train)} val={len(val)} test={len(test)}")

    model = BaselineClassifier().fit((features(s) for s in train), [s.label for s in train])

    from sklearn.metrics import classification_report, confusion_matrix, f1_score

    preds = model.predict([features(s) for s in test])
    golds = [s.label for s in test]
    acc = sum(p == g for p, g in zip(preds, golds)) / max(1, len(golds))
    macro_f1 = f1_score(golds, preds, average="macro")

    print(f"\nTEST accuracy={acc:.4f} macro_f1={macro_f1:.4f}")
    print(classification_report(golds, preds, digits=3, zero_division=0))

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    model.save(args.out)
    Path(args.out).with_suffix(".metrics.json").write_text(
        json.dumps({"accuracy": float(acc), "macro_f1": float(macro_f1), "n_test": len(golds)}, indent=2)
    )
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
