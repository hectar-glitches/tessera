"""Tests for the trust boundary — server-signed identity claims.

The governance guarantees only hold if a client cannot assert its own clearance. These
tests prove the signed-token contract and, critically, that a valid token ALWAYS wins
over identity sent in the request body (so "I'll just claim I'm the CEO" fails).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.config import get_settings
from app.main import _resolve_identity, app
from app.models import IdentityModel, QueryRequest


# ------------------------------------------------------------------ token primitives
def test_token_roundtrip_returns_claims():
    token = auth.issue_token(user="Maya", team="engineering", level="employee")
    claims = auth.verify_token(token)
    assert claims is not None
    assert claims["user"] == "Maya"
    assert claims["team"] == "engineering"
    assert claims["level"] == "employee"


def test_tampered_token_is_rejected():
    token = auth.issue_token(user="Maya", team="engineering", level="employee")
    payload_b64, _, sig = token.partition(".")
    # Forge a higher clearance into the payload, keep the (now-stale) signature.
    forged = auth.issue_token(user="Maya", team="engineering", level="exec")
    forged_payload = forged.partition(".")[0]
    assert auth.verify_token(f"{forged_payload}.{sig}") is None


def test_expired_token_is_rejected():
    token = auth.issue_token(user="Maya", team="engineering", level="employee",
                             ttl_seconds=-1)
    assert auth.verify_token(token) is None


def test_garbage_token_is_rejected():
    assert auth.verify_token("not-a-token") is None
    assert auth.verify_token("") is None


# ------------------------------------------------------------------ /auth/login (IdP)
def test_login_issues_server_authoritative_claims():
    client = TestClient(app)
    maya = client.post("/api/auth/login", json={"user": "Maya"}).json()
    dana = client.post("/api/auth/login", json={"user": "Dana"}).json()
    # The server, not the client, decides each persona's clearance.
    assert maya["identity"]["level"] == "employee"
    assert dana["identity"]["level"] == "exec"
    assert auth.verify_token(maya["token"])["level"] == "employee"


def test_login_unknown_user_is_rejected():
    client = TestClient(app)
    r = client.post("/api/auth/login", json={"user": "Mallory"})
    assert r.status_code == 401


# ------------------------------------------------------------------ the trust boundary
def test_token_claims_override_body_identity():
    """A body claiming exec is IGNORED when an employee token is present."""
    token = auth.issue_token(user="Maya", team="engineering", level="employee")
    req = QueryRequest(
        question="anything",
        identity=IdentityModel(user="Mallory", team="exec", level="exec"),
    )
    resolved = _resolve_identity(req, authorization=f"Bearer {token}")
    assert resolved.level == "employee"      # token wins, not the forged body
    assert resolved.team == "engineering"
    assert resolved.user == "Maya"


def test_invalid_token_is_rejected_even_with_body_identity():
    req = QueryRequest(question="x",
                       identity=IdentityModel(user="x", team="all", level="employee"))
    with pytest.raises(Exception):  # HTTPException(401)
        _resolve_identity(req, authorization="Bearer tampered.sig")


def test_body_identity_used_only_in_dev_fallback():
    # With no token and require_auth off (default), the body identity is honored.
    req = QueryRequest(question="x",
                       identity=IdentityModel(user="Leo", team="engineering",
                                              level="employee"))
    resolved = _resolve_identity(req, authorization=None)
    assert resolved.user == "Leo"


def test_require_auth_refuses_unauthenticated_query():
    settings = get_settings()
    settings.require_auth = True
    try:
        req = QueryRequest(question="x",
                           identity=IdentityModel(level="exec", team="exec"))
        with pytest.raises(Exception):  # HTTPException(401)
            _resolve_identity(req, authorization=None)
    finally:
        settings.require_auth = False
