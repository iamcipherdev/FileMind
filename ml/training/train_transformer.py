"""Train Model C — FileTransformer, built from scratch (no pretrained weights).

Usage:
  python train_transformer.py --data ml/data/dataset.jsonl --out ml/artifacts/filemind-transformer.pt
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from filemind_ml.dataset import features, load_dataset_jsonl, stratified_split  # noqa: E402
from filemind_ml.models.transformer import FileTransformer  # noqa: E402
from filemind_ml.tokenizer import WordVocab  # noqa: E402
from filemind_ml.train_loop import evaluate, make_loaders, train_model  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="ml/data/dataset.jsonl")
    ap.add_argument("--out", default="ml/artifacts/filemind-transformer.pt")
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--d-model", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--heads", type=int, default=4)
    ap.add_argument("--seed", type=int, default=13)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")

    samples = load_dataset_jsonl(args.data)
    train, val, test = stratified_split(samples)
    print(f"samples: train={len(train)} val={len(val)} test={len(test)}")

    vocab = WordVocab.build((features(s) for s in train), max_size=8000)
    print(f"vocab: {len(vocab)} tokens")

    loaders = make_loaders(train, val, test, vocab, batch_size=args.batch_size)
    model = FileTransformer(
        vocab_size=len(vocab),
        num_classes=13,
        d_model=args.d_model,
        nhead=args.heads,
        num_layers=args.layers,
    ).to(device)
    print(f"parameters: {model.num_parameters():,}")

    stats = train_model(model, loaders[0], loaders[1], epochs=args.epochs, device=device)
    test_metrics = evaluate(model, loaders[2], device)
    print(f"\nTEST accuracy={test_metrics['accuracy']:.4f}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "vocab_size": len(vocab),
            "config": {
                "d_model": args.d_model, "nhead": args.heads,
                "num_layers": args.layers, "num_classes": 13,
            },
        },
        args.out,
    )
    vocab.save(Path(args.out).with_name("vocab.json"))
    Path(args.out).with_suffix(".metrics.json").write_text(
        json.dumps({**stats, "test_accuracy": float(test_metrics["accuracy"])}, indent=2)
    )
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
