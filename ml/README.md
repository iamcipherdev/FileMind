# ml/ — local ML pipeline

Train the FileMind classifier **from scratch**, evaluate it honestly, export to
ONNX for the desktop app. Everything runs offline; nothing here calls a cloud
service or downloads weights.

```
ml/
├── data/            dataset schema + README (synthetic + your-real-files paths)
├── filemind_ml/     python package: tokenizer, dataset utils, models, train loop
│   └── models/      baseline (TF-IDF+LR) · textcnn · transformer (from scratch)
├── training/        prepare_dataset.py · train_baseline.py · train_textcnn.py · train_transformer.py
├── evaluation/      evaluate.py  (accuracy, macro-F1, per-class, confusion matrix)
├── export/          export_onnx.py  (→ models/filemind-transformer.onnx + vocab + labels + manifest)
├── artifacts/       training outputs: .pt checkpoints, .metrics.json (real numbers)
└── colab/           FileMind_Training.ipynb — zero-setup GPU run
```

## Quickstart (CPU is enough)

```bash
pip install scikit-learn joblib torch onnx onnxruntime onnxscript

python ml/training/prepare_dataset.py --synthetic --per-class 600
python ml/training/train_baseline.py
python ml/training/train_textcnn.py --epochs 8
python ml/training/train_transformer.py --epochs 5
python ml/evaluation/evaluate.py --torch ml/artifacts/filemind-transformer.pt --arch transformer
python ml/export/export_onnx.py --checkpoint ml/artifacts/filemind-transformer.pt --arch transformer
```

Then restart FileMind — it picks up `models/filemind-transformer.onnx`
automatically, and Settings → Local ML model will report:

> Local ML model ready (runs fully offline).

## Results so far (real, from the committed `ml/artifacts/*.metrics.json`)

| model | params | test accuracy (synthetic-v1, n=780) |
|---|---|---|
| baseline (TF-IDF + LR) | — | 1.0000 |
| TextCNN | 636,173 | 1.0000 |
| FileTransformer | 2,980,621 | 1.0000 |

⚠️ Synthetic data inflates these numbers — full context and caveats in
[`MODEL_CARD.md`](../MODEL_CARD.md). Retrain on a real manifest
(`ml/data/README.md`) for numbers worth quoting.

## Honesty policy (non-negotiable)

- Metrics only from `evaluation/evaluate.py` on held-out data. Never estimated.
- No pretrained weights anywhere; the transformer is built in
  `filemind_ml/models/transformer.py` with plain PyTorch.
- If a model is missing, the app says so and runs rule-based. It never fakes it.
