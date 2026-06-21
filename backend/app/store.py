"""Storage abstraction.

Defines the data model and the interface the engine talks to, plus an in-memory
implementation used as a fallback when Redis is unavailable. The Redis implementation
(``redis_store.RedisStore``) is the production/demo backend and is selected
automatically by :func:`get_store` when it can connect.
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

import numpy as np

from . import embeddings


@dataclass
class ChunkHit:
    chunk_id: str
    text: str
    score: float
    entities: List[str]


@dataclass
class CacheCandidate:
    hash: str
    question: str
    answer: str
    score: float
    entities: List[str]
    chunk_ids: List[str]
    tokens_in: int = 0
    tokens_out: int = 0


@dataclass
class Chunk:
    chunk_id: str
    text: str
    hash: str
    entities: List[str]
    vector: np.ndarray


@dataclass
class LogEntry:
    ts: float
    question: str
    decision: str  # hit | suggest | miss | invalidate
    similarity: float
    matched_question: Optional[str]
    tokens_saved: int
    dollars_saved: float
    note: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


class BaseStore(ABC):
    backend: str = "base"

    # ----- indexes / lifecycle -----
    @abstractmethod
    def ensure_ready(self) -> None: ...

    @abstractmethod
    def reset_org(self, org: str) -> None: ...

    # ----- chunks -----
    @abstractmethod
    def get_chunk_hashes(self, org: str) -> Dict[str, str]: ...

    @abstractmethod
    def replace_chunks(self, org: str, chunks: List[Chunk]) -> None: ...

    @abstractmethod
    def search_chunks(self, org: str, qvec: np.ndarray, k: int) -> List[ChunkHit]: ...

    # ----- cache -----
    @abstractmethod
    def write_cache_entry(
        self,
        org: str,
        hash_: str,
        question: str,
        answer: str,
        vector: np.ndarray,
        entities: List[str],
        chunk_ids: List[str],
        tokens_in: int,
        tokens_out: int,
    ) -> None:
        """Atomically write the cache entry AND its reverse-index updates."""

    @abstractmethod
    def search_cache(self, org: str, qvec: np.ndarray, k: int) -> List[CacheCandidate]: ...

    @abstractmethod
    def get_cache_entry(self, org: str, hash_: str) -> Optional[CacheCandidate]: ...

    @abstractmethod
    def invalidate_chunks(self, org: str, chunk_ids: List[str]) -> List[str]:
        """Drop cache entries derived from the given chunks. Returns dropped hashes."""

    @abstractmethod
    def cache_size(self, org: str) -> int: ...

    # ----- logging / stats -----
    @abstractmethod
    def append_log(self, org: str, entry: LogEntry) -> None: ...

    @abstractmethod
    def get_logs(self, org: str, limit: int = 50) -> List[dict]: ...

    @abstractmethod
    def bump_stats(self, org: str, **deltas: float) -> None: ...

    @abstractmethod
    def get_stats(self, org: str) -> Dict[str, float]: ...

    @abstractmethod
    def set_budget(self, org: str, budget: float) -> None: ...

    @abstractmethod
    def get_budget(self, org: str) -> float: ...

    # ----- in-flight coalescing lock (stretch goal 2) -----
    def try_lock(self, key: str, ttl: int = 15) -> bool:
        """Best-effort SETNX-style lock. Default impl always grants (single-process)."""
        return True

    def release_lock(self, key: str) -> None:
        return None


# --------------------------------------------------------------------------------------
# In-memory fallback
# --------------------------------------------------------------------------------------
class MemoryStore(BaseStore):
    backend = "memory"

    def __init__(self, default_budget: float = 50.0):
        self.default_budget = default_budget
        self._chunks: Dict[str, Dict[str, Chunk]] = {}
        self._cache: Dict[str, Dict[str, CacheCandidate]] = {}
        self._cache_vecs: Dict[str, Dict[str, np.ndarray]] = {}
        self._reverse: Dict[str, Dict[str, set]] = {}  # org -> chunk_id -> {hashes}
        self._logs: Dict[str, List[dict]] = {}
        self._stats: Dict[str, Dict[str, float]] = {}
        self._budget: Dict[str, float] = {}

    def ensure_ready(self) -> None:
        return

    def reset_org(self, org: str) -> None:
        for d in (self._chunks, self._cache, self._cache_vecs, self._reverse,
                  self._logs, self._stats):
            d.pop(org, None)
        self._budget.pop(org, None)

    # chunks
    def get_chunk_hashes(self, org: str) -> Dict[str, str]:
        return {cid: c.hash for cid, c in self._chunks.get(org, {}).items()}

    def replace_chunks(self, org: str, chunks: List[Chunk]) -> None:
        self._chunks[org] = {c.chunk_id: c for c in chunks}

    def search_chunks(self, org: str, qvec: np.ndarray, k: int) -> List[ChunkHit]:
        hits = []
        for c in self._chunks.get(org, {}).values():
            hits.append(ChunkHit(c.chunk_id, c.text, embeddings.cosine(qvec, c.vector),
                                 c.entities))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:k]

    # cache
    def write_cache_entry(self, org, hash_, question, answer, vector, entities,
                          chunk_ids, tokens_in, tokens_out) -> None:
        self._cache.setdefault(org, {})[hash_] = CacheCandidate(
            hash=hash_, question=question, answer=answer, score=1.0,
            entities=entities, chunk_ids=chunk_ids, tokens_in=tokens_in,
            tokens_out=tokens_out,
        )
        self._cache_vecs.setdefault(org, {})[hash_] = vector
        rev = self._reverse.setdefault(org, {})
        for cid in chunk_ids:
            rev.setdefault(cid, set()).add(hash_)

    def search_cache(self, org, qvec, k) -> List[CacheCandidate]:
        out = []
        vecs = self._cache_vecs.get(org, {})
        for h, entry in self._cache.get(org, {}).items():
            score = embeddings.cosine(qvec, vecs[h])
            out.append(CacheCandidate(entry.hash, entry.question, entry.answer, score,
                                      entry.entities, entry.chunk_ids,
                                      entry.tokens_in, entry.tokens_out))
        out.sort(key=lambda c: c.score, reverse=True)
        return out[:k]

    def get_cache_entry(self, org, hash_) -> Optional[CacheCandidate]:
        return self._cache.get(org, {}).get(hash_)

    def invalidate_chunks(self, org, chunk_ids) -> List[str]:
        rev = self._reverse.get(org, {})
        dropped: set = set()
        for cid in chunk_ids:
            dropped |= rev.get(cid, set())
        cache = self._cache.get(org, {})
        vecs = self._cache_vecs.get(org, {})
        for h in dropped:
            entry = cache.pop(h, None)
            vecs.pop(h, None)
            if entry:
                for cid in entry.chunk_ids:
                    rev.get(cid, set()).discard(h)
        for cid in chunk_ids:
            rev.pop(cid, None)
        return sorted(dropped)

    def cache_size(self, org) -> int:
        return len(self._cache.get(org, {}))

    # logs / stats
    def append_log(self, org, entry: LogEntry) -> None:
        self._logs.setdefault(org, []).insert(0, entry.to_dict())
        self._logs[org] = self._logs[org][:500]

    def get_logs(self, org, limit=50) -> List[dict]:
        return self._logs.get(org, [])[:limit]

    def bump_stats(self, org, **deltas) -> None:
        s = self._stats.setdefault(org, {})
        for k, v in deltas.items():
            s[k] = s.get(k, 0.0) + v

    def get_stats(self, org) -> Dict[str, float]:
        return dict(self._stats.get(org, {}))

    def set_budget(self, org, budget) -> None:
        self._budget[org] = budget

    def get_budget(self, org) -> float:
        return self._budget.get(org, self.default_budget)


_store: Optional[BaseStore] = None


def get_store() -> BaseStore:
    global _store
    if _store is not None:
        return _store
    from .config import get_settings

    settings = get_settings()
    try:
        from .redis_store import RedisStore

        rs = RedisStore(settings.redis_url, settings.default_budget_usd)
        rs.ensure_ready()
        _store = rs
    except Exception as exc:  # pragma: no cover - depends on environment
        print(f"[tessera] Redis unavailable ({exc}); using in-memory store.")
        _store = MemoryStore(settings.default_budget_usd)
        _store.ensure_ready()
    return _store
