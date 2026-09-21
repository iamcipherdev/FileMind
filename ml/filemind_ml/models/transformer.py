"""Model C — FileTransformer: a small encoder built FROM SCRATCH (no pretrained
weights, no HF hub downloads). Pure PyTorch nn.TransformerEncoder over the
custom WordVocab IDs.

Design targets (spec): 3-4 encoder layers, 4 heads, d_model 256, ~1M-10M params.
With vocab 8000 / d_model 256: embeddings ~2.0M + encoder ~2.4M -> ~4.5M params.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn


class FileTransformer(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        num_classes: int,
        d_model: int = 256,
        nhead: int = 4,
        num_layers: int = 4,
        dim_ff: int = 512,
        dropout: float = 0.1,
        max_len: int = 64,
        pad_idx: int = 0,
    ):
        super().__init__()
        self.d_model = d_model
        self.pad_idx = pad_idx
        self.embedding = nn.Embedding(vocab_size, d_model, padding_idx=pad_idx)
        self.pos_embedding = nn.Parameter(self._sinusoid(max_len, d_model), requires_grad=False)
        self.dropout = nn.Dropout(dropout)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=dim_ff,
            dropout=dropout, batch_first=True, activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.norm = nn.LayerNorm(d_model)
        self.classifier = nn.Linear(d_model, num_classes)

    @staticmethod
    def _sinusoid(max_len: int, d_model: int) -> torch.Tensor:
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div)
        pe[:, 1::2] = torch.cos(position * div)
        return pe.unsqueeze(0)

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor | None = None) -> torch.Tensor:
        # input_ids: (B, L) int64; attention_mask: (B, L) float32 with 1=real, 0=pad
        if attention_mask is None:
            attention_mask = (input_ids != self.pad_idx).float()

        x = self.embedding(input_ids) * math.sqrt(self.d_model) + self.pos_embedding[:, : input_ids.size(1)]
        x = self.dropout(x)

        # key_padding_mask: True where PAD (nn.Transformer convention)
        pad_mask = attention_mask == 0
        h = self.encoder(x, src_key_padding_mask=pad_mask)
        h = self.norm(h)

        # masked mean pooling over real tokens
        mask = attention_mask.unsqueeze(-1)
        pooled = (h * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
        return self.classifier(pooled)

    def num_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
