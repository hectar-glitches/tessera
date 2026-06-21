"""Sentry telemetry — observability for the cognition pipeline + AI governance.

Thesis: an LLM's worst failures never throw. A confident wrong answer, a cache hit
that crosses a permission boundary, an ungrounded hallucination, a runaway bill — all
return HTTP 200. This module turns those *silent, semantic* failures into first-class
Sentry signals:

- **Traces**: every /query is a transaction; embed -> cache.search -> rag.retrieve ->
  llm.generate become child spans carrying similarity, tokens, and $ cost.
- **Issues**: governance events (ACL_DENIAL, BOUNDARY_PROBE, NEAR_MISS,
  UNGROUNDED_ANSWER) are captured as grouped, fingerprinted Sentry issues.
- **Attribution**: every event is tagged by identity (team / clearance).

EVERYTHING here is a no-op unless ``SENTRY_DSN`` is set, and every SDK call is wrapped
defensively so a missing package or API drift can never break a request.
"""
from __future__ import annotations

import contextlib
import time
from typing import Dict, List, Optional, Tuple

from .config import get_settings

_enabled = False
_sentry = None  # the sentry_sdk module, once initialised

# Sliding window for boundary-probe detection: {(org, user): [timestamps]}.
_probe_window: Dict[Tuple[str, str], List[float]] = {}

# Governance event taxonomy (kind -> Sentry level).
_EVENT_LEVEL = {
    "ACL_DENIAL": "warning",
    "NEAR_MISS": "info",
    "UNGROUNDED_ANSWER": "warning",
    "BOUNDARY_PROBE": "error",
}


def init() -> bool:
    """Initialise Sentry if a DSN is configured. Safe to call once at startup."""
    global _enabled, _sentry
    s = get_settings()
    if not s.sentry_dsn:
        print("[tessera] Sentry disabled (no SENTRY_DSN); telemetry is a no-op.")
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=s.sentry_dsn,
            environment=s.sentry_environment,
            traces_sample_rate=s.sentry_traces_sample_rate,
            profiles_sample_rate=s.sentry_profiles_sample_rate,
            send_default_pii=False,
        )
        _sentry = sentry_sdk
        _enabled = True
        print(f"[tessera] Sentry enabled (env={s.sentry_environment}).")
    except Exception as e:  # pragma: no cover - defensive
        print(f"[tessera] Sentry init failed ({e}); continuing without telemetry.")
        _enabled = False
    return _enabled


def enabled() -> bool:
    return _enabled


# --------------------------------------------------------------------- tracing
@contextlib.contextmanager
def span(op: str, description: str = "", **data):
    """Open a child span on the active request transaction. Yields None if disabled."""
    if not _enabled:
        yield None
        return
    try:
        with _sentry.start_span(op=op, description=description) as sp:
            _set_data(sp, data)
            yield sp
    except Exception:  # pragma: no cover - defensive
        yield None


def set_span_data(sp, **data):
    if sp is not None:
        _set_data(sp, data)


def _set_data(sp, data: dict):
    for k, v in data.items():
        try:
            sp.set_data(k, v)
        except Exception:
            pass


def record_cost(tokens_in: int, tokens_out: int, usd: float):
    """Attach LLM spend to the current transaction as measurements."""
    if not _enabled:
        return
    try:
        _sentry.set_measurement("llm.tokens_in", tokens_in)
        _sentry.set_measurement("llm.tokens_out", tokens_out)
        _sentry.set_measurement("llm.cost_usd", usd, "none")
    except Exception:
        pass


# ----------------------------------------------------------------- attribution
def set_identity(identity):
    if not _enabled:
        return
    try:
        _sentry.set_user({"id": identity.user, "username": identity.user})
        _sentry.set_tag("team", identity.team)
        _sentry.set_tag("clearance", identity.level)
    except Exception:
        pass


def tag_decision(decision: str, access_level: str):
    if not _enabled:
        return
    try:
        _sentry.set_tag("cache.decision", decision)
        _sentry.set_tag("access.level", access_level)
    except Exception:
        pass


def breadcrumb(category: str, message: str, **data):
    if not _enabled:
        return
    try:
        _sentry.add_breadcrumb(category=category, message=message, level="info", data=data)
    except Exception:
        pass


# ------------------------------------------------------------------ governance
def capture_governance_event(kind: str, identity, question: str, **ctx):
    """Raise a grouped Sentry issue for a silent/semantic failure."""
    if not _enabled:
        return
    team = getattr(identity, "team", "?")
    level = getattr(identity, "level", "?")
    try:
        with _sentry.push_scope() as scope:
            scope.set_tag("governance.event", kind)
            scope.set_tag("team", team)
            scope.set_tag("clearance", level)
            scope.set_context("governance", {"question": question, **ctx})
            scope.fingerprint = ["governance", kind, team, level]
            _sentry.capture_message(
                f"[{kind}] {question[:80]}",
                level=_EVENT_LEVEL.get(kind, "warning"),
            )
    except Exception:
        pass


def note_boundary_attempt(org: str, identity, question: str, blocked_hit) -> bool:
    """Record that an identity reached for content above its clearance.

    Leaves a breadcrumb every time; once attempts cross the threshold inside the
    window, raises a BOUNDARY_PROBE issue carrying the full attempt trail. Returns
    True if an issue was raised.
    """
    if not _enabled:
        return False
    s = get_settings()
    key = (org, getattr(identity, "user", "anon"))
    now = time.time()
    window = [t for t in _probe_window.get(key, []) if now - t < s.probe_window_seconds]
    window.append(now)
    _probe_window[key] = window

    breadcrumb(
        "governance.probe",
        f"{getattr(identity, 'user', 'anon')} reached for gated content",
        topic=getattr(blocked_hit, "chunk_id", "?"),
        required_level=getattr(blocked_hit, "acl_level", "?"),
        similarity=round(getattr(blocked_hit, "score", 0.0), 3),
    )

    if len(window) >= s.probe_threshold:
        capture_governance_event(
            "BOUNDARY_PROBE", identity, question,
            attempts=len(window),
            window_seconds=s.probe_window_seconds,
            gated_topic=getattr(blocked_hit, "chunk_id", "?"),
            required_level=getattr(blocked_hit, "acl_level", "?"),
        )
        _probe_window[key] = []  # reset after alerting
        return True
    return False
