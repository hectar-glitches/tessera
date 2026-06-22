"""The trust boundary: server-issued, signed identity claims.

The governance story only holds if a client cannot *assert its own clearance*. So
identity claims (clearance ``level`` + ``team``) are never trusted from the request
body in the secure path — they are minted server-side by the simulated IdP
(:func:`issue_token`, exposed at ``POST /api/auth/login``) and verified on every
``/query`` (:func:`verify_token`).

Tokens are HMAC-SHA256 signed (``payload.signature``, both base64url). The signature
is a *real* one: without ``settings.auth_secret`` a client cannot forge or tamper with
a claim. This is a deliberately tiny, dependency-free JWT-shaped shim — in production
this is exactly where an SSO/OIDC provider plugs in; the verification contract is the
same.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from .config import get_settings


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload_b64: str, secret: str) -> str:
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
    return _b64e(sig)


def issue_token(user: str, team: str, level: str,
                ttl_seconds: Optional[int] = None) -> str:
    """Mint a signed token carrying server-authoritative identity claims."""
    settings = get_settings()
    ttl = settings.auth_token_ttl_seconds if ttl_seconds is None else ttl_seconds
    now = int(time.time())
    payload = {
        "user": user,
        "team": team,
        "level": level,
        "iat": now,
        "exp": now + int(ttl),
    }
    payload_b64 = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    return f"{payload_b64}.{_sign(payload_b64, settings.auth_secret)}"


def verify_token(token: str) -> Optional[dict]:
    """Return the claims dict if the signature is valid and unexpired, else None."""
    if not token or "." not in token:
        return None
    payload_b64, _, sig = token.partition(".")
    expected = _sign(payload_b64, get_settings().auth_secret)
    # Constant-time comparison defeats signature-timing attacks.
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        claims = json.loads(_b64d(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(claims.get("exp", 0)) < int(time.time()):
        return None
    return claims
