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

from . import acl, embeddings
from .acl import Identity


@dataclass
class ChunkHit:
    chunk_id: str
    text: str
    score: float
    entities: List[str]
    acl_level: str = "public"
    acl_teams: List[str] = field(default_factory=list)


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
    # OrgCache role-aware fields
    role: str = ""
    seniority: str = ""
    tenure: str = ""
    min_seniority_level: int = 1
    hit_count: int = 0
    created_at: float = 0.0
    last_asked_at: float = 0.0
    # RBAC access-control fields
    acl_level: str = "public"
    acl_teams: List[str] = field(default_factory=list)


@dataclass
class Chunk:
    chunk_id: str
    text: str
    hash: str
    entities: List[str]
    vector: np.ndarray
    acl_level: str = "public"
    acl_teams: List[str] = field(default_factory=list)


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
    actor: str = ""
    access: str = ""

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
    def search_chunks(self, org: str, qvec: np.ndarray, k: int,
                      identity: Optional[Identity] = None) -> List[ChunkHit]: ...

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
        role: str = "",
        seniority: str = "",
        tenure: str = "",
        min_seniority_level: int = 1,
        acl_level: str = "public",
        acl_teams: Optional[List[str]] = None,
    ) -> None:
        """Atomically write the cache entry AND its reverse-index updates."""

    @abstractmethod
    def search_cache(
        self,
        org: str,
        qvec: np.ndarray,
        k: int,
        user_level: Optional[int] = None,
        role: Optional[str] = None,
        tenure: Optional[str] = None,
        identity: Optional[Identity] = None,
    ) -> List[CacheCandidate]: ...

    @abstractmethod
    def get_cache_entry(self, org: str, hash_: str) -> Optional[CacheCandidate]: ...

    @abstractmethod
    def bump_hit(self, org: str, hash_: str) -> None:
        """Increment hit_count and set last_asked_at for a cache entry."""

    @abstractmethod
    def list_entries(
        self,
        org: str,
        role: Optional[str] = None,
        seniority: Optional[str] = None,
        tenure: Optional[str] = None,
    ) -> List[CacheCandidate]:
        """List all cache entries (optionally filtered) for the dashboard."""

    @abstractmethod
    def update_entry(
        self,
        org: str,
        hash_: str,
        answer: Optional[str] = None,
        min_seniority_level: Optional[int] = None,
    ) -> Optional[CacheCandidate]:
        """Inline edit an entry's answer and/or min_seniority_level."""

    @abstractmethod
    def delete_entry(self, org: str, hash_: str) -> bool:
        """Remove a cache entry and clean its reverse-index membership."""

    def get_trending(
        self,
        org: str,
        role: Optional[str] = None,
        seniority: Optional[str] = None,
        tenure: Optional[str] = None,
        limit: int = 10,
    ) -> List[CacheCandidate]:
        """Top entries by hit_count within a segment, respecting the hierarchy rule.

        Implemented on the base via list_entries so both stores share the logic.
        """
        from .roles import can_view, level_for

        user_level = level_for(seniority)
        entries = self.list_entries(org, role=role, tenure=tenure)
        visible = [e for e in entries if can_view(user_level, e.min_seniority_level)]
        visible.sort(key=lambda e: (e.hit_count, e.last_asked_at), reverse=True)
        return visible[:limit]

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

    def search_chunks(self, org, qvec, k, identity=None) -> List[ChunkHit]:
        hits = []
        for c in self._chunks.get(org, {}).values():
            if identity and not acl.can_access(identity, c.acl_level, c.acl_teams):
                continue
            hits.append(ChunkHit(c.chunk_id, c.text, embeddings.cosine(qvec, c.vector),
                                 c.entities, c.acl_level, c.acl_teams))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:k]

    # cache
    def write_cache_entry(self, org, hash_, question, answer, vector, entities,
                          chunk_ids, tokens_in, tokens_out, role="", seniority="",
                          tenure="", min_seniority_level=1, acl_level="public",
                          acl_teams=None) -> None:
        now = time.time()
        self._cache.setdefault(org, {})[hash_] = CacheCandidate(
            hash=hash_, question=question, answer=answer, score=1.0,
            entities=entities, chunk_ids=chunk_ids, tokens_in=tokens_in,
            tokens_out=tokens_out, role=role, seniority=seniority, tenure=tenure,
            min_seniority_level=int(min_seniority_level), hit_count=0,
            created_at=now, last_asked_at=now,
            acl_level=acl_level, acl_teams=acl_teams or [],
        )
        self._cache_vecs.setdefault(org, {})[hash_] = vector
        rev = self._reverse.setdefault(org, {})
        for cid in chunk_ids:
            rev.setdefault(cid, set()).add(hash_)

    def search_cache(self, org, qvec, k, user_level=None, role=None,
                     tenure=None, identity=None) -> List[CacheCandidate]:
        from .roles import can_view, tenure_boost

        out = []
        vecs = self._cache_vecs.get(org, {})
        for h, entry in self._cache.get(org, {}).items():
            # OrgCache seniority hierarchy filter
            if not can_view(user_level, entry.min_seniority_level):
                continue
            # RBAC access-control filter
            if identity and not acl.can_access(identity, entry.acl_level, entry.acl_teams):
                continue
            score = embeddings.cosine(qvec, vecs[h])
            ranked = score + tenure_boost(tenure, entry.tenure)
            out.append(CacheCandidate(
                entry.hash, entry.question, entry.answer, ranked,
                entry.entities, entry.chunk_ids, entry.tokens_in, entry.tokens_out,
                role=entry.role, seniority=entry.seniority, tenure=entry.tenure,
                min_seniority_level=entry.min_seniority_level, hit_count=entry.hit_count,
                created_at=entry.created_at, last_asked_at=entry.last_asked_at,
                acl_level=entry.acl_level, acl_teams=entry.acl_teams,
            ))
        out.sort(key=lambda c: c.score, reverse=True)
        return out[:k]

    def get_cache_entry(self, org, hash_) -> Optional[CacheCandidate]:
        return self._cache.get(org, {}).get(hash_)

    def bump_hit(self, org, hash_) -> None:
        entry = self._cache.get(org, {}).get(hash_)
        if entry:
            entry.hit_count += 1
            entry.last_asked_at = time.time()

    def list_entries(self, org, role=None, seniority=None,
                     tenure=None) -> List[CacheCandidate]:
        out = []
        for entry in self._cache.get(org, {}).values():
            if role and entry.role != role:
                continue
            if seniority and entry.seniority != seniority:
                continue
            if tenure and entry.tenure != tenure:
                continue
            out.append(entry)
        out.sort(key=lambda e: e.hit_count, reverse=True)
        return out

    def update_entry(self, org, hash_, answer=None,
                     min_seniority_level=None) -> Optional[CacheCandidate]:
        entry = self._cache.get(org, {}).get(hash_)
        if not entry:
            return None
        if answer is not None:
            entry.answer = answer
        if min_seniority_level is not None:
            entry.min_seniority_level = int(min_seniority_level)
        return entry

    def delete_entry(self, org, hash_) -> bool:
        entry = self._cache.get(org, {}).pop(hash_, None)
        self._cache_vecs.get(org, {}).pop(hash_, None)
        if entry:
            rev = self._reverse.get(org, {})
            for cid in entry.chunk_ids:
                rev.get(cid, set()).discard(hash_)
        return entry is not None

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
