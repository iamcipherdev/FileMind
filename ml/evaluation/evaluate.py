"""Evaluate a trained model on held-out data and print a real report.

Usage:
  python evaluate.py --baseline ml/artifacts/baseline.joblib --data ml/data/dataset.jsonl
  python evaluate.py --torch ml/artifacts/filemind-transformer.pt --arch transformer --data ...
  python evaluate.py --torch ml/artifacts/textcnn.pt --arch textcnn --data ...

Writes ml/artifacts/evaluation-report.json with everything measured.
This script NEVER estimates, extrapolates or invents numbers.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from filemind_ml.dataset import LABELS, features, load_dataset_jsonl, stratified_split  # noqa: E402


def classification_report_dict(golds, preds):
    from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support

    acc = accuracy_score(golds, preds)
    macro_f1 = f1_score(golds, preds, average="macro")
    weighted_f1 = f1_score(golds, preds, average="weighted")
    prec, rec, f1, support = precision_recall_fscore_support(golds, preds, labels=LABELS, zero_division=0)
    per_class = {
        LABELS[i]: {
            "precision": round(float(prec[i]), 4),
            "recall": round(float(rec[i]), 4),
            "f1": round(float(f1[i]), 4),
            "support": int(support[i]),
        }
        for i in range(len(LABELS))
    }
    cm = confusion_matrix(golds, preds, labels=LABELS).tolist()
    return {
        "accuracy": round(float(acc), 4),
        "macro_f1": round(float(macro_f1), 4),
        "weighted_f1": round(float(weighted_f1), 4),
        "per_class": per_class,
        "confusion_matrix": cm,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="ml/data/dataset.jsonl")
    ap.add_argument("--baseline", default=None)
    ap.add_argument("--torch", dest="torch_path", default=None)
    ap.add_argument("--arch", choices=["transformer", "textcnn"], default="transformer")
    ap.add_argument("--out", default="ml/artifacts/evaluation-report.json")
    args = ap.parse_args()

    samples = load_dataset_jsonl(args.data)
    _train, _val, test = stratified_split(samples)
    golds = [s.label for s in test]
    texts = [features(s) for s in test]
    print(f"held-out test set: {len(test)} samples")

    report: dict = {}

    if args.baseline:
        from filemind_ml.models.baseline import BaselineClassifier

        model = BaselineClassifier.load(args.baseline)
        preds = model.predict(texts)
        report["baseline"] = classification_report_dict(golds, preds)

    if args.torch_path:
        import torch
        from filemind_ml.models.textcnn import TextCNN
        from filemind_ml.models.transformer import FileTransformer
        from filemind_ml.tokenizer import WordVocab

        ckpt = torch.load(args.torch_path, map_location="cpu")
        vocab = WordVocab.load(Path(args.torch_path).with_name("vocab.json"))
        ids = torch.tensor([vocab.encode(t) for t in texts], dtype=torch.long)
        if args.arch == "transformer":
            cfg = ckpt["config"]
            model = FileTransformer(vocab_size=ckpt["vocab_size"], **cfg)
        else:
            model = TextCNN(vocab_size=ckpt["vocab_size"], num_classes=len(LABELS))
        model.load_state_dict(ckpt["state_dict"])
        model.eval()
        with torch.no_grad():
            logits = model(ids)
        preds = [LABELS[i] for i in logits.argmax(dim=1).tolist()]
        report[args.arch] = classification_report_dict(golds, preds)

    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "confusion_matrix"} for k, v in report.items()}, indent=2))

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nreport -> {args.out}")


if __name__ == "__main__":
    main()
