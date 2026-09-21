"""Word-level tokenizer shared by all three models and the ONNX export.

The tokenizer is deliberately simple and fully deterministic so the exact
same ID sequence can be reproduced inside the desktop app (JS side keeps a
vocab.json and mirrors this logic):

    text -> lowercase -> split on non-alphanumeric (dot kept) -> vocab lookup

Special tokens:
    <pad>=0  <unk>=1  <cls>=2  <sep>=3
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Iterable, List

PAD, UNK, CLS, SEP = "<pad>", "<unk>", "<cls>", "<sep>"
SPECIALS = [PAD, UNK, CLS, SEP]

_token_re = re.compile(r"[a-z0-9.]+")
MAX_LEN = 64


def tokenize(text: str) -> List[str]:
    return _token_re.findall(text.lower())


class WordVocab:
    def __init__(self, max_size: int = 8000):
        self.max_size = max_size
        self.itos: List[str] = list(SPECIALS)
        self.stoi: dict = {t: i for i, t in enumerate(SPECIALS)}

    @classmethod
    def build(cls, texts: Iterable[str], max_size: int = 8000, min_freq: int = 1) -> "WordVocab":
        v = cls(max_size)
        counter: Counter = Counter()
        for t in texts:
            counter.update(tokenize(t))
        for tok, _freq in counter.most_common(max_size - len(SPECIALS)):
            if counter[tok] < min_freq:
                break
            v.itos.append(tok)
            v.stoi[tok] = len(v.itos) - 1
        return v

    def encode(self, text: str, max_len: int = MAX_LEN, add_specials: bool = True) -> List[int]:
        ids = [self.stoi.get(tok, self.stoi[UNK]) for tok in tokenize(text)[: max_len - (2 if add_specials else 0)]]
        if add_specials:
            ids = [self.stoi[CLS]] + ids + [self.stoi[SEP]]
        ids += [self.stoi[PAD]] * (max_len - len(ids))
        return ids[:max_len]

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({"itos": self.itos}, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "WordVocab":
        v = cls()
        v.itos = json.loads(Path(path).read_text(encoding="utf-8"))["itos"]
        v.stoi = {t: i for i, t in enumerate(v.itos)}
        return v

    def __len__(self) -> int:
        return len(self.itos)
