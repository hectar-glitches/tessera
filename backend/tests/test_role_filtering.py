"""Tests for the OrgCache role/seniority/tenure layer.

These run against the in-memory store + fallback embedder, so no Redis or ML deps are
required. They cover the hierarchy rule, trending segmentation, and the API surface.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import embeddings
from app.engine import Engine
from app.main import app
from app.store import MemoryStore


def _write(store, org, hash_, question, answer, role, seniority, level, tenure):
    store.write_cache_entry(
        org=org,
        hash_=hash_,
        question=question,
        answer=answer,
        vector=embeddings.embed(question),
        entities=[],
        chunk_ids=[],
        tokens_in=200,
        tokens_out=50,
        role=role,
        seniority=seniority,
        tenure=tenure,
        min_seniority_level=level,
    )


@pytest.fixture
def store():
    s = MemoryStore()
    _write(s, "acme", "h1", "how do I run the dev server", "npm run dev",
           "engineer", "junior", 1, "onboarding")
    _write(s, "acme", "h4", "what is our multi-region failover strategy",
           "active-passive RDS promotion", "engineer", "staff", 4, "experienced")
    return s


def test_junior_cannot_see_staff_entry(store):
    qvec = embeddings.embed("what is our multi-region failover strategy")
    results = store.search_cache("acme", qvec, k=5, user_level=1)
    hashes = {c.hash for c in results}
    assert "h4" not in hashes, "junior (level 1) must not see a staff (level 4) entry"
    assert "h1" in hashes


def test_principal_can_see_staff_entry(store):
    qvec = embeddings.embed("what is our multi-region failover strategy")
    results = store.search_cache("acme", qvec, k=5, user_level=5)
    assert "h4" in {c.hash for c in results}, "principal (level 5) should see staff entry"


def test_trending_respects_segment_and_hierarchy(store):
    # h1 gets more hits than h4; a junior trending view must exclude h4 entirely.
    for _ in range(3):
        store.bump_hit("acme", "h1")
    store.bump_hit("acme", "h4")

    junior = store.get_trending("acme", role="engineer", seniority="junior", limit=10)
    junior_hashes = [c.hash for c in junior]
    assert junior_hashes and junior_hashes[0] == "h1"
    assert "h4" not in junior_hashes

    principal = store.get_trending("acme", role="engineer", seniority="principal")
    assert "h4" in {c.hash for c in principal}


def test_api_query_role_filtering_and_validation():
    client = TestClient(app)
    client.post("/api/orgs/acmecorp/reset")
    client.post("/api/orgs/acmecorp/ingest/seed")

    # Junior engineer onboarding -> instant hit on the level-1 answer.
    r = client.post("/api/orgs/acmecorp/query", json={
        "question": "how do I run the dev server",
        "role": "engineer", "seniority": "junior", "tenure": "onboarding", "user_level": 1,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["decision"] == "hit"
    assert "npm run dev" in body["answer"]

    # Same junior must NOT get the staff-only failover answer as a hit.
    r2 = client.post("/api/orgs/acmecorp/query", json={
        "question": "what is our multi-region failover strategy",
        "role": "engineer", "seniority": "junior", "tenure": "onboarding", "user_level": 1,
    })
    assert r2.json()["decision"] != "hit"

    # Invalid seniority -> 400 with a JSON error.
    bad = client.post("/api/orgs/acmecorp/query", json={
        "question": "anything", "seniority": "wizard",
    })
    assert bad.status_code == 400


def test_trending_endpoint_returns_segment():
    client = TestClient(app)
    client.post("/api/orgs/acmecorp/reset")
    client.post("/api/orgs/acmecorp/ingest/seed")
    # Generate some hits.
    for _ in range(2):
        client.post("/api/orgs/acmecorp/query", json={
            "question": "how do I run the dev server",
            "role": "engineer", "seniority": "junior", "tenure": "onboarding", "user_level": 1,
        })
    r = client.get("/api/orgs/acmecorp/trending",
                   params={"role": "engineer", "seniority": "junior", "tenure": "onboarding"})
    assert r.status_code == 200
    data = r.json()
    assert data["segment"]["role"] == "engineer"
    # No staff-level item should appear in a junior trending view.
    assert all(it["seniority"] in ("junior", "") for it in data["items"])
