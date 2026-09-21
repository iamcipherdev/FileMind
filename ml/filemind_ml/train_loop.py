"""Shared PyTorch training loop for TextCNN and FileTransformer."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import List

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from filemind_ml.dataset import LABELS, Sample, features  # noqa: E402
from filemind_ml.tokenizer import WordVocab  # noqa: E402


def encode_split(samples: List[Sample], vocab: WordVocab, max_len: int = 64):
    ids = torch.tensor([vocab.encode(features(s), max_len) for s in samples], dtype=torch.long)
    labels = torch.tensor([LABELS.index(s.label) for s in samples], dtype=torch.long)
    return ids, labels


def make_loaders(train, val, test, vocab: WordVocab, batch_size: int = 64, max_len: int = 64):
    out = []
    for split in (train, val, test):
        ids, labels = encode_split(split, vocab, max_len)
        out.append(DataLoader(TensorDataset(ids, labels), batch_size=batch_size, shuffle=split is train))
    return out


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: str) -> dict:
    model.eval()
    correct = total = 0
    all_preds, all_golds = [], []
    for ids, labels in loader:
        ids, labels = ids.to(device), labels.to(device)
        logits = model(ids)
        preds = logits.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.numel()
        all_preds += preds.tolist()
        all_golds += labels.tolist()
    return {"accuracy": correct / max(1, total), "preds": all_preds, "golds": all_golds}


def train_model(model, train_loader, val_loader, epochs: int = 8, lr: float = 3e-4, device: str = "cpu") -> dict:
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loss_fn = nn.CrossEntropyLoss()

    best_acc, best_state = 0.0, None
    for epoch in range(1, epochs + 1):
        model.train()
        t0, running = time.time(), 0.0
        for ids, labels in train_loader:
            ids, labels = ids.to(device), labels.to(device)
            opt.zero_grad()
            loss = loss_fn(model(ids), labels)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            running += loss.item()
        sched.step()
        val = evaluate(model, val_loader, device)
        if val["accuracy"] > best_acc:
            best_acc = val["accuracy"]
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        print(f"epoch {epoch:02d}  loss={running/len(train_loader):.4f}  val_acc={val['accuracy']:.4f}  ({time.time()-t0:.1f}s)")

    if best_state:
        model.load_state_dict(best_state)
    return {"best_val_accuracy": best_acc}
