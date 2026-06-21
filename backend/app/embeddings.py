"""Embedding provider with a graceful fallback.

Primary: sentence-transformers (real semantic quality).
Fallback: a deterministic hashed bag-of-words vector so the system runs with no
heavy ML dependencies (tests, CI, constrained machines). Both return L2-normalized
vectors of length ``settings.embed_dim`` so cosine similarity == dot product.
"""
from __future__ import annotations

import hashlib
import re
from typing import List

import numpy as np

from .config import get_settings

_WORD_RE = re.compile(r"[a-z0-9]+")
_model = None
_backend = "fallback"


def _try_load_model():
    global _model, _backend
    if _model is not None:
        return _model
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        settings = get_settings()
        _model = SentenceTransformer(settings.embed_model)
        _backend = "sentence-transformers"
    except Exception:
        _model = None
        _backend = "fallback"
    return _model


def backend_name() -> str:
    _try_load_model()
    return _backend


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        return v
    return v / n


def _hashed_embed(text: str, dim: int) -> np.ndarray:
    """Deterministic hashed bag-of-words with sign hashing."""
    vec = np.zeros(dim, dtype=np.float32)
    tokens = _WORD_RE.findall(text.lower())
    for tok in tokens:
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if (h >> 8) % 2 == 0 else -1.0
        vec[idx] += sign
    return _normalize(vec)


def embed(text: str) -> np.ndarray:
    settings = get_settings()
    model = _try_load_model()
    if model is not None:
        v = model.encode([text], normalize_embeddings=True)[0]
        return np.asarray(v, dtype=np.float32)
    return _hashed_embed(text, settings.embed_dim)


def embed_many(texts: List[str]) -> List[np.ndarray]:
    settings = get_settings()
    model = _try_load_model()
    if model is not None:
        vecs = model.encode(list(texts), normalize_embeddings=True)
        return [np.asarray(v, dtype=np.float32) for v in vecs]
    return [_hashed_embed(t, settings.embed_dim) for t in texts]


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


_dim_cache: int | None = None


def get_dim() -> int:
    """Actual embedding dimensionality of the active backend."""
    global _dim_cache
    if _dim_cache is None:
        _dim_cache = int(embed("probe").shape[0])
    return _dim_cache
