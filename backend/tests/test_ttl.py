"""Tests for label-aware cache TTL (sensitivity-tiered expiry).

Correctness on source edits is handled by the reverse-index invalidation; these TTLs
are the *risk ceiling* — more sensitive answers expire sooner. All tests run against the
in-memory store + fallback embedder, so no Redis or ML deps are required.
"""
from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app import embeddings
from app.config import get_settings
from app.main import app
from app.store import MemoryStore

LEVELS = ["public", "employee", "manager", "exec"]


def _write(store, org, hash_, question, acl_level, acl_teams=None):
    store.write_cache_entry(
        org=org, hash_=hash_, question=question, answer="ans",
        vector=embeddings.embed(question), entities=[], chunk_ids=[f"{hash_}_c"],
        tokens_in=100, tokens_out=20, acl_level=acl_level, acl_teams=acl_teams or [],
    )


def test_ttl_tiers_are_sensitivity_ordered():
    s = get_settings()
    ttls = [s.cache_ttl_for(lvl) for lvl in LEVELS]
    # More sensitive => shorter (never longer) TTL.
    assert ttls == sorted(ttls, reverse=True)
    assert all(t > 0 for t in ttls)
    # Unknown level falls back to the most permissive (public) tier, never to 0.
    assert s.cache_ttl_for("bogus") == s.cache_ttl_for("public")


def test_write_sets_expires_at_per_level():
    store = MemoryStore()
    for i, level in enumerate(LEVELS):
        _write(store, "acme", f"h{i}", f"question number {i}", level)
        entry = store.get_cache_entry("acme", f"h{i}")
        assert entry is not None
        ttl = get_settings().cache_ttl_for(level)
        # The invariant: expiry is exactly the creation time plus the tier TTL.
        assert abs(entry.expires_at - entry.created_at - ttl) < 1


def test_expired_entry_is_swept_from_all_read_paths():
    store = MemoryStore()
    _write(store, "acme", "h1", "hello world", "public")
    # Force the entry's expiry into the past.
    store._cache["acme"]["h1"].expires_at = time.time() - 1

    assert store.get_cache_entry("acme", "h1") is None
    assert store.cache_size("acme") == 0
    assert store.search_cache("acme", embeddings.embed("hello world"), k=5) == []
    assert store.list_entries("acme") == []
    # Reverse index membership is cleaned too (no dangling pointer to the dead entry).
    assert store._reverse["acme"].get("h1_c", set()) == set()


def test_sliding_refresh_extends_expiry_on_hit():
    store = MemoryStore()
    _write(store, "acme", "h1", "hello", "employee")
    entry = store._cache["acme"]["h1"]
    entry.expires_at = time.time() + 5  # about to expire
    store.bump_hit("acme", "h1")
    ttl = get_settings().cache_ttl_for("employee")
    # Pushed back out to ~now + ttl, well beyond the imminent expiry.
    assert entry.expires_at > time.time() + ttl - 5


def test_zero_expiry_sentinel_never_swept():
    store = MemoryStore()
    _write(store, "acme", "h1", "hello", "public")
    entry = store._cache["acme"]["h1"]
    entry.expires_at = 0.0                         # 0 == never expires
    entry.created_at = time.time() - 10_000_000    # ancient
    store._sweep_expired("acme")
    assert store.get_cache_entry("acme", "h1") is not None


def test_search_cache_propagates_expires_at():
    store = MemoryStore()
    _write(store, "acme", "h1", "hello world", "manager")
    cands = store.search_cache("acme", embeddings.embed("hello world"), k=5)
    assert cands and cands[0].expires_at > time.time()


def test_api_query_response_includes_expires_at():
    client = TestClient(app)
    client.post("/api/orgs/acmecorp/reset")
    client.post("/api/orgs/acmecorp/ingest/seed")
    r = client.post("/api/orgs/acmecorp/query", json={
        "question": "how do I run the dev server",
        "role": "engineer", "seniority": "junior", "tenure": "onboarding", "user_level": 1,
    })
    assert r.status_code == 200
    body = r.json()
    assert "expires_at" in body
    if body["decision"] == "hit":
        assert body["expires_at"] > time.time()
