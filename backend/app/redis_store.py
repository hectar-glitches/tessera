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
from redis.commands.search.index_definition import IndexDefinition, IndexType
from redis.commands.search.query import Query

from . import acl, embeddings
from .acl import Identity
from .store import BaseStore, CacheCandidate, Chunk, ChunkHit, LogEntry

INDEX_NAME = "tessera:idx:v2"  # bumped: schema now carries acl_level/acl_team
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
        self.r = redis.Redis.from_url(url)
        self.default_budget = default_budget
        self.dim = embeddings.get_dim()
        self._write_sha: Optional[str] = None

    # ----- lifecycle -----
    def ensure_ready(self) -> None:
        self.r.ping()
        try:
            self.r.ft(INDEX_NAME).info()
        except redis.ResponseError:
            schema = (
                TagField("org"),
                TagField("doctype"),
                TagField("chunk_id"),
                TagField("hash"),
                TagField("entities", separator=ENT_SEP),
                NumericField("acl_level"),
                TagField("acl_team", separator=ENT_SEP),
                TextField("text"),
                VectorField(
                    "vector",
                    "HNSW",
                    {"TYPE": "FLOAT32", "DIM": self.dim, "DISTANCE_METRIC": "COSINE"},
                ),
            )
            self.r.ft(INDEX_NAME).create_index(
                schema,
                definition=IndexDefinition(prefix=[KEY_PREFIX], index_type=IndexType.HASH),
            )
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
                          chunk_ids, tokens_in, tokens_out, acl_level="public",
                          acl_teams=None) -> None:
        cache_key = self._cache_key(org, hash_)
        cacheidx = self._cacheidx_key(org)
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
            "acl_level": acl.level_rank(acl_level),
            "acl_team": _enc_team(acl_teams),
            "vector": _to_bytes(vector),
        }
        flat: List = []
        for fk, fv in fields.items():
            flat.append(fk)
            flat.append(fv)
        keys = [cache_key, cacheidx] + [self._chunkmap_key(org, c) for c in chunk_ids]
        argv = [str(len(fields))] + flat
        self.r.evalsha(self._write_sha, len(keys), *keys, *argv)

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
            acl_level=acl.rank_to_name(int(getattr(doc, "acl_level", 0) or 0)),
            acl_teams=_dec_team(getattr(doc, "acl_team", "")),
        )

    def search_cache(self, org, qvec, k, identity=None) -> List[CacheCandidate]:
        flt = _acl_filter(identity)
        q = (
            Query(f"(@org:{{{org}}} @doctype:{{cache}}{flt})=>[KNN {k} @vector $vec AS score]")
            .sort_by("score")
            .return_fields("hash", "question", "answer", "entities", "chunk_ids",
                           "tokens_in", "tokens_out", "acl_level", "acl_team", "score")
            .dialect(2)
        )
        res = self.r.ft(INDEX_NAME).search(q, query_params={"vec": _to_bytes(qvec)})
        return [self._doc_to_candidate(d) for d in res.docs]

    def get_cache_entry(self, org, hash_) -> Optional[CacheCandidate]:
        data = self.r.hgetall(self._cache_key(org, hash_))
        if not data:
            return None
        d = {k.decode(): (v.decode() if isinstance(v, bytes) else v)
             for k, v in data.items() if k != b"vector"}
        ents = d.get("entities", "").split(ENT_SEP) if d.get("entities") else []
        return CacheCandidate(
            hash=d["hash"],
            question=d["question"],
            answer=d["answer"],
            score=1.0,
            entities=ents,
            chunk_ids=json.loads(d.get("chunk_ids", "[]")),
            tokens_in=int(d.get("tokens_in", 0) or 0),
            tokens_out=int(d.get("tokens_out", 0) or 0),
            acl_level=acl.rank_to_name(int(d.get("acl_level", 0) or 0)),
            acl_teams=_dec_team(d.get("acl_team", "")),
        )

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
