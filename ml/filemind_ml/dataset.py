"""Dataset utilities shared by training scripts."""

from __future__ import annotations

import csv
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import List

LABELS = [
    "documents", "spreadsheets", "presentations", "images", "videos",
    "audio", "archives", "code", "design", "fonts", "data", "books", "other",
]


@dataclass
class Sample:
    name: str          # file name, e.g. "invoice_march.pdf"
    content: str       # text snippet ("" when unavailable)
    label: str         # one of LABELS


def load_dataset_jsonl(path: str | Path) -> List[Sample]:
    samples: List[Sample] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            samples.append(Sample(row["name"], row.get("content", ""), row["label"]))
    return samples


def load_dataset_csv(path: str | Path) -> List[Sample]:
    samples: List[Sample] = []
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            samples.append(Sample(row["name"], row.get("content", ""), row["label"]))
    return samples


def features(sample: Sample) -> str:
    """Text fed to models: name tokens are the primary signal, content a booster."""
    return f"{sample.name} {sample.content[:400]}"


def stratified_split(
    samples: List[Sample], train_frac: float = 0.8, val_frac: float = 0.1, seed: int = 13
):
    rng = random.Random(seed)
    by_label: dict = {}
    for s in samples:
        by_label.setdefault(s.label, []).append(s)

    train, val, test = [], [], []
    for _label, group in by_label.items():
        rng.shuffle(group)
        n = len(group)
        n_train = max(1, int(n * train_frac))
        n_val = max(1, int(n * val_frac)) if n >= 3 else 0
        train += group[:n_train]
        val += group[n_train:n_train + n_val]
        test += group[n_train + n_val:] if n > n_train + n_val else group[n_train:n_train + max(0, n - n_train)]

    for part in (train, val, test):
        rng.shuffle(part)
    return train, val, test
