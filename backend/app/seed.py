"""OrgCache seed loader.

Loads a JSON list of role-tagged Q&As (e.g. ``acmecorp_seed.json``) directly into the
cache as pre-populated entries: each question is embedded and stored with its role /
seniority / tenure / min_seniority_level. We also stitch the answers into a small
markdown guide and ingest it so cache *misses* still have RAG context to work with.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List

from . import embeddings, entities
from .ingest import ingest_document
from .store import BaseStore

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@dataclass
class SeedResult:
    org: str
    entries: int
    backend: str


def _hash(q: str) -> str:
    return hashlib.sha256(q.strip().lower().encode()).hexdigest()[:16]


def _estimate_tokens(text: str) -> int:
    # Rough 4-chars-per-token heuristic; enough for savings accounting in the demo.
    return max(1, len(text) // 4)


def _build_guide(items: List[dict]) -> str:
    """Group answers into a markdown doc so RAG has chunks on a cache miss."""
    by_level = {1: "Onboarding", 2: "Workflows", 3: "Architecture", 4: "Strategy",
                5: "Org"}
    lines: List[str] = ["# AcmeCorp Engineering Guide", ""]
    for lvl in sorted(by_level):
        section = [it for it in items if int(it.get("min_seniority_level", 1)) == lvl]
        if not section:
            continue
        lines.append(f"## {by_level[lvl]}")
        for it in section:
            lines.append(f"### {it['question']}")
            lines.append(it["answer"])
            lines.append("")
    return "\n".join(lines)


def load_seed_file(path: Path) -> List[dict]:
    with open(path) as f:
        return json.load(f)


def seed_org(store: BaseStore, org: str, items: List[dict]) -> SeedResult:
    # 1. Ingest a stitched guide so misses have retrievable context.
    store.reset_org(org)
    ingest_document(store, org, _build_guide(items))

    # 2. Pre-populate cache entries, one per Q&A, tagged with the role fields.
    for it in items:
        q = it["question"]
        a = it["answer"]
        vec = embeddings.embed(q)
        ents = entities.extract(q)
        store.write_cache_entry(
            org=org,
            hash_=_hash(q),
            question=q,
            answer=a,
            vector=vec,
            entities=ents,
            chunk_ids=[],
            tokens_in=_estimate_tokens(q) + 200,  # question + retrieved context
            tokens_out=_estimate_tokens(a),
            role=it.get("role", ""),
            seniority=it.get("seniority", ""),
            tenure=it.get("tenure", ""),
            min_seniority_level=int(it.get("min_seniority_level", 1)),
        )
    return SeedResult(org=org, entries=len(items), backend=store.backend)


def seed_acmecorp(store: BaseStore, org: str = "acmecorp") -> SeedResult:
    items = load_seed_file(DATA_DIR / "acmecorp_seed.json")
    return seed_org(store, org, items)
