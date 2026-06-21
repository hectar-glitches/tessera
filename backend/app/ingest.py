"""Ingestion: chunk -> embed -> extract entities -> store, with source-aware
cache invalidation on re-ingest (stretch goal 1).

Chunks are keyed by a stable slug derived from their markdown heading, so editing
one section only changes that chunk's hash. On re-ingest we diff hashes and invalidate
only the cache entries derived from changed/removed chunks.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Dict, List

from . import embeddings, entities
from .store import BaseStore, Chunk


@dataclass
class IngestResult:
    org: str
    total_chunks: int
    changed_chunks: List[str]
    removed_chunks: List[str]
    invalidated_cache_hashes: List[str]
    backend: str


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:60] or "section"


def chunk_markdown(doc: str) -> List[Dict[str, str]]:
    """Split on level-2/3 headings into (chunk_id, text) sections."""
    lines = doc.splitlines()
    chunks: List[Dict[str, str]] = []
    cur_title = "intro"
    cur_lines: List[str] = []
    seen: Dict[str, int] = {}

    def flush():
        nonlocal cur_lines, cur_title
        body = "\n".join(cur_lines).strip()
        if body:
            base = _slug(cur_title)
            seen[base] = seen.get(base, 0) + 1
            cid = base if seen[base] == 1 else f"{base}-{seen[base]}"
            chunks.append({"chunk_id": cid, "text": f"{cur_title}\n{body}".strip()})
        cur_lines = []

    for line in lines:
        if re.match(r"^#{2,3}\s+", line):
            flush()
            cur_title = re.sub(r"^#{2,3}\s+", "", line).strip()
        else:
            cur_lines.append(line)
    flush()
    return chunks


def ingest_document(store: BaseStore, org: str, doc: str) -> IngestResult:
    raw_chunks = chunk_markdown(doc)
    prev_hashes = store.get_chunk_hashes(org)

    chunk_objs: List[Chunk] = []
    new_hashes: Dict[str, str] = {}
    texts = [c["text"] for c in raw_chunks]
    vectors = embeddings.embed_many(texts) if texts else []

    for c, vec in zip(raw_chunks, vectors):
        h = hashlib.sha256(c["text"].encode()).hexdigest()[:16]
        ents = entities.extract(c["text"])
        new_hashes[c["chunk_id"]] = h
        chunk_objs.append(
            Chunk(chunk_id=c["chunk_id"], text=c["text"], hash=h, entities=ents, vector=vec)
        )

    changed = [cid for cid, h in new_hashes.items() if prev_hashes.get(cid) != h]
    removed = [cid for cid in prev_hashes if cid not in new_hashes]

    store.replace_chunks(org, chunk_objs)

    invalidated: List[str] = []
    if prev_hashes:  # only invalidate on re-ingest, not first load
        affected = changed + removed
        if affected:
            invalidated = store.invalidate_chunks(org, affected)

    return IngestResult(
        org=org,
        total_chunks=len(chunk_objs),
        changed_chunks=changed,
        removed_chunks=removed,
        invalidated_cache_hashes=invalidated,
        backend=store.backend,
    )
