"""Regression tests for Tessera's three headline safety guarantees.

Each test pins a claim we make on stage:
  1. A higher-clearance answer is never SERVED to a lower-clearance asker.
  2. A higher-clearance answer never even APPEARS in a lower-clearance asker's
     suggestions (no existence leak).
  3. A near-miss with a conflicting entity is SUGGESTED, never auto-served.
  4. A source edit invalidates ONLY the cache entries grounded on changed chunks.

All run against the in-memory store + a controlled embedder, so they are deterministic
and need no Redis or ML deps.
"""
from __future__ import annotations

import numpy as np

from app import embeddings, entities
from app.acl import Identity
from app.engine import Engine
from app.store import MemoryStore

SECRET = "75,000"
ORG = "t"


def _const_embed(monkeypatch, dim: int = 8):
    """Force every embedding to the same unit vector so cosine == 1.0 for any pair.

    This isolates the ACL / entity logic from embedder quality: similarity is pinned
    high, so whether an answer is served comes down purely to the safety filters.
    """
    const = (np.ones(dim, dtype=np.float32) / np.sqrt(dim))
    monkeypatch.setattr(embeddings, "embed", lambda text: const.copy())
    return const


def _write(store, hash_, question, answer, acl_level, acl_teams=None, entity_text=None):
    store.write_cache_entry(
        org=ORG, hash_=hash_, question=question, answer=answer,
        vector=embeddings.embed(question),
        entities=entities.extract(entity_text if entity_text is not None else question),
        chunk_ids=[f"{hash_}_chunk"], tokens_in=300, tokens_out=120,
        acl_level=acl_level, acl_teams=acl_teams or [],
    )


# ---------------------------------------------------------- 1. no leak via a hit
def test_exec_answer_not_served_as_hit_to_lower_clearance(monkeypatch):
    _const_embed(monkeypatch)
    store = MemoryStore()
    q = "what are the sponsorship contract dollar amounts"
    _write(store, "execans", q, f"The Anthropic package is a {SECRET} dollar deal.", "exec")

    res = Engine(store).query(ORG, q, identity=Identity("Maya", "engineering", "employee"))

    assert res.decision != "hit"
    assert SECRET not in (res.answer or "")


def test_exec_answer_is_served_to_exec(monkeypatch):
    # The gate is a real boundary, not a blanket block: the cleared identity gets it.
    _const_embed(monkeypatch)
    store = MemoryStore()
    q = "what are the sponsorship contract dollar amounts"
    _write(store, "execans", q, f"The Anthropic package is a {SECRET} dollar deal.", "exec")

    res = Engine(store).query(ORG, q, identity=Identity("Dana", "exec", "exec"))

    assert res.decision == "hit"
    assert SECRET in res.answer


# ------------------------------------------------ 2. no existence leak via suggestions
def test_exec_answer_never_appears_in_lower_clearance_suggestions(monkeypatch):
    _const_embed(monkeypatch)
    store = MemoryStore()
    # A visible public near-miss (day conflict) AND a gated exec entry, both high-sim.
    _write(store, "pub", "what time is saturday lunch", "Saturday lunch is at 12:30pm.",
           "public")
    _write(store, "execans", "confidential sponsor figures",
           f"The package is {SECRET} dollars.", "exec")

    res = Engine(store).query(ORG, "what time is sunday lunch",
                              identity=Identity("Maya", "engineering", "employee"))

    hashes = [s.hash for s in res.suggestions]
    assert "pub" in hashes, "the visible public near-miss should be suggested"
    assert "execans" not in hashes, "a gated exec entry must never surface to an employee"
    assert SECRET not in (res.answer or "")


# ----------------------------------------------- 3. near-miss is suggested, not served
def test_entity_conflict_is_suggested_not_auto_served(monkeypatch):
    _const_embed(monkeypatch)
    store = MemoryStore()
    _write(store, "sat", "what time is saturday lunch", "Saturday lunch is at 12:30pm.",
           "public")

    res = Engine(store).query(ORG, "what time is sunday lunch")

    assert res.decision == "suggest"
    assert res.answer is None, "must not auto-serve the Saturday answer to a Sunday query"
    assert "12:30" not in (res.answer or "")
    assert any(s.entity_conflict and "day" in s.conflict_categories
               for s in res.suggestions)


# ------------------------------------------------ 4. invalidation scoped to the source
def test_invalidation_drops_only_entries_from_changed_chunks():
    store = MemoryStore()
    for h, cid in (("A", "cA"), ("B", "cB")):
        store.write_cache_entry(
            org=ORG, hash_=h, question=f"question {h}", answer=f"answer {h}",
            vector=embeddings.embed(f"question {h}"), entities=[], chunk_ids=[cid],
            tokens_in=10, tokens_out=5, acl_level="public")

    dropped = store.invalidate_chunks(ORG, ["cA"])

    assert dropped == ["A"]
    assert store.get_cache_entry(ORG, "A") is None
    assert store.get_cache_entry(ORG, "B") is not None
    assert store.cache_size(ORG) == 1
