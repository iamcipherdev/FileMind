# FileMind Model Card — filemind-transformer

**Version:** 0.1.0 · **Date:** 2026-09-21 · **Status:** trained (synthetic data v1) — see the honesty note

## 1. What this model is

A small **encoder-only Transformer trained from scratch** — no pretrained weights,
no downloads from any model hub — that classifies a file into one of 13 categories
from its **name and extracted text snippet**. It runs **fully offline** inside
FileMind via `onnxruntime-node`.

- Architecture: custom word tokenizer → embedding + sinusoidal positions → 4 ×
  TransformerEncoder layers (4 heads, d_model 256, FFN 512, GELU) → masked mean
  pooling → linear head.
- Inputs: `input_ids int64[B,64]`, `attention_mask float32[B,64]`.
- Output: `logits float32[B,13]` over the category list in `models/labels.json`.
- Export: `ml/export/export_onnx.py` → `models/filemind-transformer.onnx` (12 MB, opset 14, dynamic batch).

## 2. Measured results (all numbers from actual runs)

Dataset: `synthetic-v1` — 13 × 600 = 7,800 template-generated samples,
stratified split 80/10/10 (seed 13). Test n = 780.

| model | params | test accuracy | macro-F1 | source |
|---|---|---|---|---|
| A · TF-IDF + LogisticRegression | — | **1.0000** | 1.0000 | `ml/artifacts/baseline.metrics.json` |
| B · TextCNN (from scratch) | 636,173 | **1.0000** | — | `ml/artifacts/textcnn.metrics.json` |
| C · FileTransformer (from scratch) | 2,980,621 | **1.0000** | — | `ml/artifacts/filemind-transformer.metrics.json` |

PyTorch ↔ ONNX parity: max |logit difference| ≈ **2.4 × 10⁻⁶** over batch-1 and batch-3 probes (see `manifest.json` for export provenance).

### Honesty note — read before quoting these numbers

**Synthetic data inflates accuracy.** The dataset is template-generated
(`invoice_{n}_{client}.pdf` …), which makes classes nearly linearly separable.
The 1.0000 above means "the pipeline works and models fit the generated
distribution", **not** "this model is 100% accurate on your real files".
To get a number worth quoting, train on a real manifest (`ml/data/README.md`,
section "Your real files") and update this table.

Also by design: FileMind treats the model as **authority 3**. User rules and
deterministic extension/name signals outrank it, so a model mistake can only
affect files that had no stronger signal.

## 3. Training configuration

| | |
|---|---|
| Loss | CrossEntropy |
| Optimizer | AdamW, lr 3e-4, wd 0.01, cosine schedule, grad-clip 1.0 |
| Epochs | 5 (transformer) / 8 (TextCNN) — CPU-runnable; Colab notebook uses 10 |
| Sequence length | 64 tokens |
| Hardware used for these runs | CPU-only (torch 2.14) |
| Seed | 13 (data split + weight init) |

## 4. Intended use & limits

- **Intended:** suggest a category for loose files inside folders the user opted in; confidence always shown; below-threshold results are never proposed.
- **Out of scope / not supported:** anything requiring cloud inference; executables/scripts (never auto-suggested, by policy); images-by-content (no vision — image formats are classified by extension/name evidence only); non-English filenames are only as good as the vocabulary seen in training.
- **Failure mode:** out-of-vocabulary or adversarial names → low confidence → FileMind says "not sure" instead of guessing. That is the intended behavior.

## 5. Data, privacy, provenance

- Training data: locally generated, no external corpus, no web scraping. See DATASET_CARD.md.
- The model never sees file paths outside the organize folders the user opted in, and file content never leaves the machine.
- Reproduce everything with: `ml/colab/FileMind_Training.ipynb` or the commands in `ml/README.md`.

## 6. How to retrain honestly (the 4-step loop)

1. `python ml/training/prepare_dataset.py --synthetic --per-class 2000` (or `--from-scan manifest.jsonl` for real data)
2. `python ml/training/train_transformer.py …`
3. `python ml/evaluation/evaluate.py …` → `ml/artifacts/evaluation-report.json`
4. `python ml/export/export_onnx.py …` → update the results table above with the new numbers and date.

## 7. Contact

Open an issue in the repo. Security-relevant model concerns → see SECURITY.md.
