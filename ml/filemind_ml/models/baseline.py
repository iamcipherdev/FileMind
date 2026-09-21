"""Model A — baseline: TF-IDF over name+content tokens, logistic regression.

Scikit-learn only (no PyTorch needed). Serves as the sanity-check floor:
any deeper model must beat this on the same split or it is not worth shipping.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import joblib
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer


class BaselineClassifier:
    def __init__(self, max_features: int = 20000):
        self.pipeline = Pipeline(
            [
                ("tfidf", TfidfVectorizer(max_features=max_features, ngram_range=(1, 2), sublinear_tf=True)),
                ("clf", LogisticRegression(max_iter=1000, C=4.0)),
            ]
        )

    def fit(self, texts: Iterable[str], labels: Iterable[str]) -> "BaselineClassifier":
        self.pipeline.fit(list(texts), list(labels))
        return self

    def predict(self, texts: list[str]) -> list[str]:
        return list(self.pipeline.predict(texts))

    def predict_proba(self, texts: list[str]):
        return self.pipeline.predict_proba(texts)

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.pipeline, path)

    @classmethod
    def load(cls, path: str | Path) -> "BaselineClassifier":
        obj = cls()
        obj.pipeline = joblib.load(path)
        return obj
