"""Export a trained FileTransformer (or TextCNN) checkpoint to ONNX for the
FileMind desktop app.

Outputs (into --model-dir, default `models/` at the repo root):
  filemind-transformer.onnx   the traced model
  vocab.json                  tokenizer vocabulary (app mirrors encode logic)
  labels.json                 label index -> category id
  manifest.json               provenance: which script, which dataset, when

The app loads these at runtime with onnxruntime-node and degrades to the
rule-based path if anything is missing — this export never pretends to be
something it is not.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from filemind_ml.dataset import LABELS  # noqa: E402
from filemind_ml.models.textcnn import TextCNN  # noqa: E402
from filemind_ml.models.transformer import FileTransformer  # noqa: E402
from filemind_ml.tokenizer import WordVocab, tokenize  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, help="path to .pt produced by training")
    ap.add_argument("--arch", choices=["transformer", "textcnn"], default="transformer")
    ap.add_argument("--model-dir", default="models")
    ap.add_argument("--max-len", type=int, default=64)
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    vocab_path = Path(args.checkpoint).with_name("vocab.json")
    vocab = WordVocab.load(vocab_path)

    if args.arch == "transformer":
        model = FileTransformer(vocab_size=ckpt["vocab_size"], **ckpt["config"])
        fname = "filemind-transformer.onnx"
    else:
        model = TextCNN(vocab_size=ckpt["vocab_size"], num_classes=len(LABELS))
        fname = "filemind-textcnn.onnx"
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    input_ids = torch.zeros((1, args.max_len), dtype=torch.long)
    attn = torch.ones((1, args.max_len), dtype=torch.float32)
    dummy = {"input_ids": input_ids, "attention_mask": attn}

    out_dir = Path(args.model_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = out_dir / fname

    # nn.TransformerEncoder's nested-tensor fast path does not trace to ONNX.
    # Disable it so the legacy exporter produces a plain, dynamic-batch graph.
    try:
        torch.backends.mha.set_fastpath_enabled(False)
    except AttributeError:
        pass  # older torch: fast path not present

    with torch.no_grad():
        try:
            # Legacy TorchScript exporter: stable for tuple inputs + dynamic batch
            torch.onnx.export(
                model,
                (dummy["input_ids"], dummy["attention_mask"]),
                str(onnx_path),
                input_names=["input_ids", "attention_mask"],
                output_names=["logits"],
                dynamic_axes={
                    "input_ids": {0: "batch"},
                    "attention_mask": {0: "batch"},
                    "logits": {0: "batch"},
                },
                opset_version=14,
                dynamo=False,
            )
        except TypeError:
            # torch < 2.9 has no `dynamo` kwarg — legacy exporter is the default there
            torch.onnx.export(
                model,
                (dummy["input_ids"], dummy["attention_mask"]),
                str(onnx_path),
                input_names=["input_ids", "attention_mask"],
                output_names=["logits"],
                dynamic_axes={
                    "input_ids": {0: "batch"},
                    "attention_mask": {0: "batch"},
                    "logits": {0: "batch"},
                },
                opset_version=14,
            )
    print(f"exported -> {onnx_path}")

    vocab.save(out_dir / "vocab.json")
    (out_dir / "labels.json").write_text(json.dumps(LABELS, indent=2), encoding="utf-8")
    (out_dir / "manifest.json").write_text(
        json.dumps(
            {
                "arch": args.arch,
                "checkpoint": str(args.checkpoint),
                "max_len": args.max_len,
                "num_labels": len(LABELS),
                "special_tokens": {"pad": 0, "unk": 1, "cls": 2, "sep": 3},
                "tokenizer": "whitespace/alnum word vocab; JS side mirrors ml/filemind_ml/tokenizer.py",
                "exported_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"vocab/labels/manifest -> {out_dir}")

    # sanity: tokenize demo text with the same path the app uses
    demo = "invoice_2026_03_acme.pdf invoice total due"
    ids = vocab.encode(demo, args.max_len)
    print(f"encode sanity: {tokenize(demo)[:5]}… -> first ids {ids[:8]}")


if __name__ == "__main__":
    main()
