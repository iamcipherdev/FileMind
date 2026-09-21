"""Model B — TextCNN over name+content token IDs (PyTorch, from scratch).

Kim-style CNN: embeddings -> parallel conv widths (3/4/5) -> max-pool -> MLP.
Small, fast on CPU, and a solid mid-tier benchmark between the baseline and
the transformer.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class TextCNN(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        num_classes: int,
        embed_dim: int = 128,
        num_filters: int = 128,
        kernel_sizes=(3, 4, 5),
        dropout: float = 0.3,
        pad_idx: int = 0,
    ):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=pad_idx)
        self.convs = nn.ModuleList(
            [nn.Conv1d(embed_dim, num_filters, k) for k in kernel_sizes]
        )
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(num_filters * len(kernel_sizes), num_classes)

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        # input_ids: (B, L) int64 -> logits: (B, C)
        x = self.embedding(input_ids).transpose(1, 2)  # (B, E, L)
        feats = [F.relu(conv(x)).max(dim=2).values for conv in self.convs]
        h = torch.cat(feats, dim=1)
        return self.fc(self.dropout(h))

    def num_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
