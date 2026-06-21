"""Arize observability for OrgCache decisions.

Every cache decision (hit / suggest / miss) is logged with its similarity, role,
seniority, tokens saved and latency. If ``ARIZE_API_KEY`` / ``ARIZE_SPACE_KEY`` are
configured, records are sent to Arize; otherwise we fall back to structured stdout
JSON lines so the observability pipeline is fully demoable offline.

This module never raises into the request path — all failures are swallowed and, at
most, printed.
"""
from __future__ import annotations

import json
import sys
import time
import uuid
from typing import Optional

from .config import get_settings

_client = None
_init_attempted = False


def _get_client():
    """Lazily build the Arize client. Returns None if unavailable/unconfigured."""
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True
    settings = get_settings()
    if not settings.arize_api_key or not settings.arize_space_key:
        return None
    try:  # pragma: no cover - exercised only when arize + keys are present
        from arize.api import Client

        _client = Client(space_key=settings.arize_space_key,
                         api_key=settings.arize_api_key)
    except Exception as exc:  # pragma: no cover
        print(f"[orgcache] Arize client init failed ({exc}); using stdout logging.",
              file=sys.stderr)
        _client = None
    return _client


def _stdout_log(record: dict) -> None:
    print("ARIZE_LOG " + json.dumps(record, default=str), flush=True)


def log_decision(
    question: str,
    cache_hit: bool,
    similarity_score: float,
    role: str = "",
    seniority: str = "",
    tokens_saved: int = 0,
    response_time_ms: float = 0.0,
    decision: str = "",
    response_quality: Optional[float] = None,
) -> None:
    """Log one cache decision. Safe to call from the request path (never raises)."""
    try:
        record = {
            "ts": time.time(),
            "question": question,
            "decision": decision,
            "cache_hit": bool(cache_hit),
            "similarity_score": round(float(similarity_score), 4),
            "role": role or "",
            "seniority": seniority or "",
            "tokens_saved": int(tokens_saved),
            "response_time_ms": round(float(response_time_ms), 2),
        }
    except Exception:
        # Malformed inputs should never break the caller.
        return
    if response_quality is not None:
        record["response_quality"] = response_quality

    try:
        client = _get_client()
        if client is None:
            _stdout_log(record)
            return
        # pragma: no cover - only runs with real Arize credentials
        from arize.utils.types import Environments, ModelTypes

        settings = get_settings()
        client.log(
            model_id=settings.arize_model_id,
            model_version="v1",
            model_type=ModelTypes.SCORE_CATEGORICAL,
            environment=Environments.PRODUCTION,
            prediction_id=str(uuid.uuid4()),
            prediction_label=(decision or ("hit" if cache_hit else "miss")),
            features={
                "role": record["role"],
                "seniority": record["seniority"],
                "similarity_score": record["similarity_score"],
                "tokens_saved": record["tokens_saved"],
                "response_time_ms": record["response_time_ms"],
            },
        )
    except Exception as exc:  # never break the request path
        try:
            _stdout_log({**record, "_arize_error": str(exc)})
        except Exception:
            pass
