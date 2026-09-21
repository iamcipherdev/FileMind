"""FileMind ML — local, from-scratch document/filename classifier tooling.

Honesty policy (enforced by review, restated everywhere):
- No script fabricates metrics. Numbers only come from evaluate.py runs
  on real held-out data.
- No pretrained weights. The transformer is trained from scratch on the
  local dataset only.
- Exported models run fully offline via onnxruntime inside FileMind.
"""

__version__ = "0.1.0"
