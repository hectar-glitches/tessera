"""Redis Stack (RediSearch) implementation of the store.

Highlights for the "Redis beyond caching" story:
- A single vector index over namespaced hashes, filtered by ``org`` + ``doctype``.
- The chunk -> cache-key reverse index as Redis SETs (``org:{org}:chunkmap:{id}``).
- A Lua script that writes a cache entry AND its reverse-index updates atomically,
  so a concurrent re-ingest can't open a window where a stale write evades
  invalidation.
"""
from __future__ import annotations

import json
import time
from typing import Dict, List, Optional

import numpy as np
import redis
from redis.commands.search.field import NumericField, TagField, TextField, VectorField
try:
    from redis.commands.search.index_definition import IndexDefinition, IndexType
except ImportError:
    try:
        from redis.commands.search.indexDefinition import IndexDefinition, IndexType
    except ImportError:
        from redis.commands.search.commands import IndexDefinition
        from enum import Enum
        class IndexType(Enum):
            HASH = "HASH"
            JSON = "ON JSON"
from redis.commands.search.query import Query

from . import acl, embeddings
from .acl import Identity
from .config import get_settings
from .store import BaseStore, CacheCandidate, Chunk, ChunkHit, LogEntry, ttl_tiers

INDEX_NAME = "tessera:idx:v3"  # carries OrgCache role fields + RBAC acl_level/acl_team
KEY_PREFIX = "org:"
ENT_SEP = "|"
TEAM_ALL = "all"


def _enc_team(teams: Optional[List[str]]) -> str:
    return ENT_SEP.join(teams) if teams else TEAM_ALL


def _dec_team(raw: str) -> List[str]:
    if not raw:
        return []
    return [t for t in raw.split(ENT_SEP) if t and t != TEAM_ALL]


def _acl_filter(identity: Optional[Identity]) -> str:
    """RediSearch clause that scopes results to what an identity may see."""
    if identity is None:
        return ""
    parts = [f"@acl_level:[-inf {identity.rank}]"]
    if not identity.is_exec:  # exec sees across teams
        parts.append(f"@acl_team:{{{TEAM_ALL}|{identity.team}}}")
    return " " + " ".join(parts)

# Atomic cache write: HSET the entry, register it in the org cache set, and add it to
# each contributing chunk's reverse set — all in one shot.
LUA_WRITE = """
local cache_key = KEYS[1]
local cacheidx = KEYS[2]
local nfields = tonumber(ARGV[1])
local hargs = {}
for i = 2, 1 + nfields do
  hargs[#hargs + 1] = ARGV[i]
end
redis.call('HSET', cache_key, unpack(hargs))
redis.call('SADD', cacheidx, cache_key)
for i = 3, #KEYS do
  redis.call('SADD', KEYS[i], cache_key)
end
return 1
"""


def _to_bytes(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def _from_bytes(b: bytes, dim: int) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32, count=dim).copy()


class RedisStore(BaseStore):
    backend = "redis"

    def __init__(self, url: str, default_budget: float = 50.0):
        # Bounded timeouts: a slow/unreachable endpoint must fail fast so get_store()
        # can fall back to the in-memory store instead of hanging the whole app.
        self.r = redis.Redis.from_url(
            url, socket_connect_timeout=10, socket_timeout=10
        )
        self.default_budget = default_budget
        self.dim = embeddings.get_dim()
        self._write_sha: Optional[str] = None

    # ----- lifecycle -----
    def _schema(self):
        return (
            TagField("org"),
            TagField("doctype"),
            TagField("chunk_id"),
            TagField("hash"),
            TagField("entities", separator=ENT_SEP),
            # OrgCache role-aware fields (filterable).
            TagField("role"),
            TagField("seniority"),
            TagField("tenure"),
            NumericField("min_seniority_level"),
            # RBAC access-control fields (filterable).
            NumericField("acl_level"),
            TagField("acl_team", separator=ENT_SEP),
            TextField("text"),
            VectorField(
                "vector",
                "HNSW",
                {"TYPE": "FLOAT32", "DIM": self.dim, "DISTANCE_METRIC": "COSINE"},
            ),
        )

    def _create_index(self) -> None:
        self.r.ft(INDEX_NAME).create_index(
            self._schema(),
            definition=IndexDefinition(prefix=[KEY_PREFIX], index_type=IndexType.HASH),
        )

    def ensure_ready(self) -> None:
        self.r.ping()
        try:
            info = self.r.ft(INDEX_NAME).info()
            # Auto-migrate: if the index predates the OrgCache fields, drop (keeping the
            # documents) and recreate so role/seniority filtering works.
            attrs = info.get("attributes", [])
            names = set()
            for a in attrs:
                a = [x.decode() if isinstance(x, bytes) else x for x in a]
                if "identifier" in a:
                    names.add(a[a.index("identifier") + 1])
                elif a:
                    names.add(a[1] if len(a) > 1 else a[0])
            if "min_seniority_level" not in names or "acl_team" not in names:
                self.r.ft(INDEX_NAME).dropindex(delete_documents=False)
                self._create_index()
        except redis.ResponseError:
            self._create_index()
        self._write_sha = self.r.script_load(LUA_WRITE)

    def _scan_del(self, pattern: str) -> None:
        cursor = 0
        while True:
            cursor, keys = self.r.scan(cursor, match=pattern, count=500)
            if keys:
                self.r.delete(*keys)
            if cursor == 0:
                break

    def reset_org(self, org: str) -> None:
        for suffix in ("chunk:*", "cache:*", "chunkmap:*"):
            self._scan_del(f"{KEY_PREFIX}{org}:{suffix}")
        self.r.delete(
            f"{KEY_PREFIX}{org}:cacheidx",
            f"{KEY_PREFIX}{org}:log",
            f"{KEY_PREFIX}{org}:stats",
            f"{KEY_PREFIX}{org}:meta",
        )

    # ----- keys -----
    def _chunk_key(self, org, cid):
        return f"{KEY_PREFIX}{org}:chunk:{cid}"

    def _cache_key(self, org, h):
        return f"{KEY_PREFIX}{org}:cache:{h}"

    def _chunkmap_key(self, org, cid):
        return f"{KEY_PREFIX}{org}:chunkmap:{cid}"

    def _cacheidx_key(self, org):
        return f"{KEY_PREFIX}{org}:cacheidx"

    # ----- chunks -----
    def get_chunk_hashes(self, org: str) -> Dict[str, str]:
        out: Dict[str, str] = {}
        cursor = 0
        while True:
            cursor, keys = self.r.scan(cursor, match=self._chunk_key(org, "*"), count=500)
            for k in keys:
                cid = self.r.hget(k, "chunk_id")
                h = self.r.hget(k, "hash")
                if cid is not None and h is not None:
                    out[cid.decode()] = h.decode()
            if cursor == 0:
                break
        return out

    def replace_chunks(self, org: str, chunks: List[Chunk]) -> None:
        self._scan_del(self._chunk_key(org, "*"))
        pipe = self.r.pipeline(transaction=True)
        for c in chunks:
            pipe.hset(
                self._chunk_key(org, c.chunk_id),
                mapping={
                    "org": org,
                    "doctype": "chunk",
                    "chunk_id": c.chunk_id,
                    "hash": c.hash,
                    "entities": ENT_SEP.join(c.entities) if c.entities else "",
                    "acl_level": acl.level_rank(c.acl_level),
                    "acl_team": _enc_team(c.acl_teams),
                    "text": c.text,
                    "vector": _to_bytes(c.vector),
                },
            )
        pipe.execute()

    def search_chunks(self, org, qvec, k, identity=None) -> List[ChunkHit]:
        flt = _acl_filter(identity)
        q = (
            Query(f"(@org:{{{org}}} @doctype:{{chunk}}{flt})=>[KNN {k} @vector $vec AS score]")
            .sort_by("score")
            .return_fields("chunk_id", "text", "entities", "acl_level", "acl_team", "score")
            .dialect(2)
        )
        res = self.r.ft(INDEX_NAME).search(q, query_params={"vec": _to_bytes(qvec)})
        hits = []
        for doc in res.docs:
            ents = doc.entities.split(ENT_SEP) if getattr(doc, "entities", "") else []
            lvl = acl.rank_to_name(int(getattr(doc, "acl_level", 0) or 0))
            teams = _dec_team(getattr(doc, "acl_team", ""))
            hits.append(ChunkHit(doc.chunk_id, doc.text, 1.0 - float(doc.score), ents,
                                 lvl, teams))
        return hits

    # ----- cache -----
    def write_cache_entry(self, org, hash_, question, answer, vector, entities,
                          chunk_ids, tokens_in, tokens_out, role="", seniority="",
                          tenure="", min_seniority_level=1, acl_level="public",
                          acl_teams=None) -> None:
        cache_key = self._cache_key(org, hash_)
        cacheidx = self._cacheidx_key(org)
        now = time.time()
        ttl = get_settings().cache_ttl_for(acl_level)
        fields = {
            "org": org,
            "doctype": "cache",
            "hash": hash_,
            "question": question,
            "answer": answer,
            "entities": ENT_SEP.join(entities) if entities else "",
            "chunk_ids": json.dumps(chunk_ids),
            "tokens_in": str(tokens_in),
            "tokens_out": str(tokens_out),
            "role": role or "",
            "seniority": seniority or "",
            "tenure": tenure or "",
            "min_seniority_level": str(int(min_seniority_level)),
            "hit_count": "0",
            "created_at": str(now),
            "last_asked_at": str(now),
            "expires_at": str(now + ttl if ttl > 0 else 0.0),
            "acl_level": acl.level_rank(acl_level),
            "acl_team": _enc_team(acl_teams),
            "vector": _to_bytes(vector),
        }
        flat: List = []
        for fk, fv in fields.items():
            flat.append(fk)
            flat.append(fv)
        keys = [cache_key, cacheidx] + [self._chunkmap_key(org, c) for c in chunk_ids]
        argv = [str(len(flat))] + flat
        self.r.evalsha(self._write_sha, len(keys), *keys, *argv)
        # Native key expiry IS the risk ceiling: when it fires the hash vanishes from
        # search/get for free. The chunkmap reverse-index self-heals on next invalidate.
        if ttl > 0:
            self.r.expire(cache_key, ttl)

    _CACHE_FIELDS = ("hash", "question", "answer", "entities", "chunk_ids",
                     "tokens_in", "tokens_out", "role", "seniority", "tenure",
                     "min_seniority_level", "hit_count", "created_at", "last_asked_at",
                     "expires_at", "acl_level", "acl_team")

    def _doc_to_candidate(self, doc) -> CacheCandidate:
        ents = doc.entities.split(ENT_SEP) if getattr(doc, "entities", "") else []
        chunk_ids = json.loads(doc.chunk_ids) if getattr(doc, "chunk_ids", "") else []
        score = 1.0 - float(doc.score) if hasattr(doc, "score") else 1.0
        return CacheCandidate(
            hash=doc.hash,
            question=doc.question,
            answer=doc.answer,
            score=score,
            entities=ents,
            chunk_ids=chunk_ids,
            tokens_in=int(getattr(doc, "tokens_in", 0) or 0),
            tokens_out=int(getattr(doc, "tokens_out", 0) or 0),
            role=getattr(doc, "role", "") or "",
            seniority=getattr(doc, "seniority", "") or "",
            tenure=getattr(doc, "tenure", "") or "",
            min_seniority_level=int(getattr(doc, "min_seniority_level", 1) or 1),
            hit_count=int(getattr(doc, "hit_count", 0) or 0),
            created_at=float(getattr(doc, "created_at", 0) or 0),
            last_asked_at=float(getattr(doc, "last_asked_at", 0) or 0),
            expires_at=float(getattr(doc, "expires_at", 0) or 0),
            acl_level=acl.rank_to_name(int(getattr(doc, "acl_level", 0) or 0)),
            acl_teams=_dec_team(getattr(doc, "acl_team", "")),
        )

    def search_cache(self, org, qvec, k, user_level=None, role=None,
                     tenure=None, identity=None) -> List[CacheCandidate]:
        from .roles import tenure_boost

        # OrgCache seniority/role filters
        filters = [f"@org:{{{org}}}", "@doctype:{cache}"]
        if user_level is not None:
            filters.append(f"@min_seniority_level:[-inf {int(user_level)}]")
        if role:
            filters.append(f"@role:{{{role}}}")
        # RBAC access-control filter (appended as raw clause)
        flt = _acl_filter(identity)
        base = "(" + " ".join(filters) + flt + ")"
        q = (
            Query(f"{base}=>[KNN {k} @vector $vec AS score]")
            .sort_by("score")
            .return_fields(*self._CACHE_FIELDS, "score")
            .dialect(2)
        )
        res = self.r.ft(INDEX_NAME).search(q, query_params={"vec": _to_bytes(qvec)})
        cands = [self._doc_to_candidate(d) for d in res.docs]
        if tenure:
            for c in cands:
                c.score += tenure_boost(tenure, c.tenure)
            cands.sort(key=lambda c: c.score, reverse=True)
        return cands

    @staticmethod
    def _dec(v):
        return v.decode() if isinstance(v, bytes) else v

    def _hash_to_candidate(self, raw: dict) -> CacheCandidate:
        # Skip the vector field — it's binary and not needed for listing/editing.
        d = {self._dec(k): self._dec(v) for k, v in raw.items()
             if self._dec(k) != "vector"}
        ents = d.get("entities", "").split(ENT_SEP) if d.get("entities") else []
        return CacheCandidate(
            hash=d.get("hash", ""),
            question=d.get("question", ""),
            answer=d.get("answer", ""),
            score=1.0,
            entities=ents,
            chunk_ids=json.loads(d.get("chunk_ids", "[]")),
            tokens_in=int(d.get("tokens_in", 0) or 0),
            tokens_out=int(d.get("tokens_out", 0) or 0),
            role=d.get("role", ""),
            seniority=d.get("seniority", ""),
            tenure=d.get("tenure", ""),
            min_seniority_level=int(d.get("min_seniority_level", 1) or 1),
            hit_count=int(d.get("hit_count", 0) or 0),
            created_at=float(d.get("created_at", 0) or 0),
            last_asked_at=float(d.get("last_asked_at", 0) or 0),
            expires_at=float(d.get("expires_at", 0) or 0),
            acl_level=acl.rank_to_name(int(d.get("acl_level", 0) or 0)),
            acl_teams=_dec_team(d.get("acl_team", "")),
        )

    def get_cache_entry(self, org, hash_) -> Optional[CacheCandidate]:
        data = self.r.hgetall(self._cache_key(org, hash_))
        if not data:
            return None
        return self._hash_to_candidate(data)

    def bump_hit(self, org, hash_) -> None:
        key = self._cache_key(org, hash_)
        if not self.r.exists(key):
            return
        now = time.time()
        # Sliding refresh: extend the label-aware TTL on every hit so hot answers stay
        # warm and only cold ones age out.
        level = acl.rank_to_name(int(self.r.hget(key, "acl_level") or 0))
        ttl = get_settings().cache_ttl_for(level)
        pipe = self.r.pipeline()
        pipe.hincrby(key, "hit_count", 1)
        pipe.hset(key, "last_asked_at", str(now))
        if ttl > 0:
            pipe.hset(key, "expires_at", str(now + ttl))
            pipe.expire(key, ttl)
        pipe.execute()

    def _iter_cache_keys(self, org):
        cursor = 0
        while True:
            cursor, keys = self.r.scan(cursor, match=self._cache_key(org, "*"), count=500)
            for k in keys:
                yield k
            if cursor == 0:
                break

    def list_entries(self, org, role=None, seniority=None,
                     tenure=None) -> List[CacheCandidate]:
        out: List[CacheCandidate] = []
        for k in self._iter_cache_keys(org):
            data = self.r.hgetall(k)
            if not data:
                continue
            c = self._hash_to_candidate(data)
            if role and c.role != role:
                continue
            if seniority and c.seniority != seniority:
                continue
            if tenure and c.tenure != tenure:
                continue
            out.append(c)
        out.sort(key=lambda e: e.hit_count, reverse=True)
        return out

    def update_entry(self, org, hash_, answer=None,
                     min_seniority_level=None) -> Optional[CacheCandidate]:
        key = self._cache_key(org, hash_)
        if not self.r.exists(key):
            return None
        updates = {}
        if answer is not None:
            updates["answer"] = answer
        if min_seniority_level is not None:
            updates["min_seniority_level"] = str(int(min_seniority_level))
        if updates:
            self.r.hset(key, mapping=updates)
        return self.get_cache_entry(org, hash_)

    def delete_entry(self, org, hash_) -> bool:
        key = self._cache_key(org, hash_)
        entry = self.r.hgetall(key)
        if not entry:
            return False
        ids = json.loads(self._dec(entry.get(b"chunk_ids", b"[]")) or "[]")
        pipe = self.r.pipeline(transaction=True)
        pipe.delete(key)
        pipe.srem(self._cacheidx_key(org), key)
        for cid in ids:
            pipe.srem(self._chunkmap_key(org, cid), key)
        pipe.execute()
        return True

    def invalidate_chunks(self, org, chunk_ids) -> List[str]:
        dropped: set = set()
        for cid in chunk_ids:
            members = self.r.smembers(self._chunkmap_key(org, cid))
            for m in members:
                dropped.add(m.decode() if isinstance(m, bytes) else m)
        if not dropped:
            for cid in chunk_ids:
                self.r.delete(self._chunkmap_key(org, cid))
            return []
        pipe = self.r.pipeline(transaction=True)
        cacheidx = self._cacheidx_key(org)
        for cache_key in dropped:
            entry_chunks = self.r.hget(cache_key, "chunk_ids")
            ids = json.loads(entry_chunks) if entry_chunks else []
            pipe.delete(cache_key)
            pipe.srem(cacheidx, cache_key)
            for cid in ids:
                pipe.srem(self._chunkmap_key(org, cid), cache_key)
        for cid in chunk_ids:
            pipe.delete(self._chunkmap_key(org, cid))
        pipe.execute()
        # Return the hash portion of each dropped cache key.
        return sorted(k.rsplit(":cache:", 1)[-1] for k in dropped)

    def cache_size(self, org) -> int:
        return int(self.r.scard(self._cacheidx_key(org)) or 0)

    # ----- introspection (the "Redis under the hood" dashboard panel) -----
    def _count_keys(self, pattern: str) -> int:
        cursor, n = 0, 0
        while True:
            cursor, keys = self.r.scan(cursor, match=pattern, count=500)
            n += len(keys)
            if cursor == 0:
                break
        return n

    def internals(self, org) -> dict:
        """Live Redis internals: the vector index, keyspace, the chunkmap reverse
        index, and per-entry TTLs. Every probe is guarded so a restricted command
        (some managed tiers disable INFO/MODULE LIST) degrades gracefully.
        """
        out: dict = {
            "backend": "redis",
            "index": {"name": INDEX_NAME, "vector_dim": self.dim,
                      "distance_metric": "COSINE", "algorithm": "HNSW"},
            "keys": {},
            "server": {},
            "modules": [],
            "reverse_index_sample": None,
            "sample_ttls": [],
            "ttl_tiers": ttl_tiers(),
        }
        try:
            info = self.r.info()
            out["server"] = {
                "redis_version": info.get("redis_version"),
                "used_memory_human": info.get("used_memory_human"),
                "uptime_days": info.get("uptime_in_days"),
            }
        except Exception:
            pass
        try:
            mods = []
            for m in self.r.module_list():
                name = m.get(b"name") if isinstance(m, dict) else None
                name = name if name is not None else (
                    m.get("name") if isinstance(m, dict) else None)
                if isinstance(name, bytes):
                    name = name.decode()
                if name:
                    mods.append(name)
            out["modules"] = sorted(mods)
        except Exception:
            pass
        try:
            idx = self.r.ft(INDEX_NAME).info()
            num = idx.get("num_docs", idx.get(b"num_docs", 0))
            out["index"]["num_docs"] = int(num or 0)
        except Exception:
            pass
        try:
            out["keys"]["cache_entries"] = int(self.r.scard(self._cacheidx_key(org)) or 0)
            out["keys"]["chunks"] = self._count_keys(self._chunk_key(org, "*"))
            out["keys"]["reverse_index_sets"] = self._count_keys(
                self._chunkmap_key(org, "*"))
        except Exception:
            pass
        try:
            _, keys = self.r.scan(0, match=self._chunkmap_key(org, "*"), count=20)
            if keys:
                kname = keys[0].decode() if isinstance(keys[0], bytes) else keys[0]
                out["reverse_index_sample"] = {
                    "chunk_id": kname.rsplit(":chunkmap:", 1)[-1],
                    "cache_entries_pointing_here": int(self.r.scard(keys[0]) or 0),
                }
        except Exception:
            pass
        try:
            samples = []
            _, keys = self.r.scan(0, match=self._cache_key(org, "*"), count=10)
            for k in list(keys)[:5]:
                ttl = self.r.ttl(k)
                lvl_raw = self.r.hget(k, "acl_level")
                kname = k.decode() if isinstance(k, bytes) else k
                samples.append({
                    "hash": kname.rsplit(":cache:", 1)[-1],
                    "level": acl.rank_to_name(int(lvl_raw or 0)),
                    "ttl_seconds": int(ttl) if ttl and ttl > 0 else None,
                })
            out["sample_ttls"] = samples
        except Exception:
            pass
        return out

    # ----- logs / stats -----
    def append_log(self, org, entry: LogEntry) -> None:
        key = f"{KEY_PREFIX}{org}:log"
        self.r.lpush(key, json.dumps(entry.to_dict()))
        self.r.ltrim(key, 0, 499)

    def get_logs(self, org, limit=50) -> List[dict]:
        items = self.r.lrange(f"{KEY_PREFIX}{org}:log", 0, limit - 1)
        return [json.loads(i) for i in items]

    def bump_stats(self, org, **deltas) -> None:
        key = f"{KEY_PREFIX}{org}:stats"
        pipe = self.r.pipeline()
        for k, v in deltas.items():
            pipe.hincrbyfloat(key, k, v)
        pipe.execute()

    def get_stats(self, org) -> Dict[str, float]:
        data = self.r.hgetall(f"{KEY_PREFIX}{org}:stats")
        return {k.decode(): float(v) for k, v in data.items()}

    def set_budget(self, org, budget) -> None:
        self.r.hset(f"{KEY_PREFIX}{org}:meta", "budget", budget)

    def get_budget(self, org) -> float:
        v = self.r.hget(f"{KEY_PREFIX}{org}:meta", "budget")
        return float(v) if v is not None else self.default_budget

    # ----- coalescing lock -----
    def try_lock(self, key: str, ttl: int = 15) -> bool:
        return bool(self.r.set(f"lock:{key}", "1", nx=True, ex=ttl))

    def release_lock(self, key: str) -> None:
        self.r.delete(f"lock:{key}")
