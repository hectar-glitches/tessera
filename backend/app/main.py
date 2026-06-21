"""Tessera API — FastAPI.

Two interfaces consume this API:
- the hacker-facing chat UI (/query, with the suggestion popup)
- the org admin dashboard (/stats, /activity, /confidence-check, /ingest, /budget)
"""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import (
    acl,
    embeddings,
    eval as eval_mod,
    ingest as ingest_mod,
    roles,
    seed as seed_mod,
    telemetry,
)
from .config import get_settings
from .engine import Engine
from .llm import get_llm
from .models import (
    BudgetRequest,
    EntryUpdateRequest,
    IngestRequest,
    QueryRequest,
    QueryResponse,
)
from .store import get_store

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Demo personas for the IAM story (intern-vs-CEO + same-team sharing).
DEMO_IDENTITIES = [
    {"user": "Maya", "role": "Intern", "team": "engineering", "level": "employee"},
    {"user": "Leo", "role": "Engineer", "team": "engineering", "level": "employee"},
    {"user": "Raj", "role": "Eng Manager", "team": "engineering", "level": "manager"},
    {"user": "Priya", "role": "Finance Manager", "team": "finance", "level": "manager"},
    {"user": "Dana", "role": "CEO", "team": "exec", "level": "exec"},
]

telemetry.init()

app = FastAPI(title="Tessera", version="1.0.0")
# Origins come from CORS_ORIGINS (comma-separated). Defaults to "*" for local dev;
# set it to the dashboard URL(s) in production to lock the API down.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _engine() -> Engine:
    return Engine(get_store())


@app.get("/api/health")
def health():
    store = get_store()
    return {
        "status": "ok",
        "store_backend": store.backend,
        "embedding_backend": embeddings.backend_name(),
        "llm_available": get_llm().available,
        "sentry_enabled": telemetry.enabled(),
    }


@app.get("/api/orgs/{org}/info")
def org_info(org: str):
    store = get_store()
    return {
        "org": org,
        "store_backend": store.backend,
        "embedding_backend": embeddings.backend_name(),
        "llm_available": get_llm().available,
        "chunks": len(store.get_chunk_hashes(org)),
        "cache_size": store.cache_size(org),
        "budget": store.get_budget(org),
    }


@app.post("/api/orgs/{org}/ingest/seed")
def ingest_seed(org: str):
    # OrgCache demo org loads the 60 role-tagged Q&As as pre-populated cache entries;
    # the legacy ask-ddoski org keeps its original markdown-guide ingest path.
    if org == "acmecorp":
        return asdict(seed_mod.seed_acmecorp(get_store(), org))
    doc = (DATA_DIR / "ask_ddoski_guide.md").read_text()
    result = ingest_mod.ingest_document(get_store(), org, doc)
    return asdict(result)


@app.post("/api/orgs/{org}/ingest")
def ingest(org: str, req: IngestRequest):
    result = ingest_mod.ingest_document(get_store(), org, req.document)
    return asdict(result)


@app.get("/api/orgs/{org}/guide")
def get_guide(org: str):
    return {"document": (DATA_DIR / "ask_ddoski_guide.md").read_text()}


@app.get("/api/identities")
def identities():
    return {"identities": DEMO_IDENTITIES, "levels": list(acl.LEVELS.keys())}


def _validate_segment(req: QueryRequest) -> None:
    if not roles.is_valid_role(req.role):
        raise HTTPException(status_code=400, detail={"error": f"invalid role: {req.role}"})
    if not roles.is_valid_seniority(req.seniority):
        raise HTTPException(status_code=400,
                            detail={"error": f"invalid seniority: {req.seniority}"})
    if not roles.is_valid_tenure(req.tenure):
        raise HTTPException(status_code=400,
                            detail={"error": f"invalid tenure: {req.tenure}"})


def _run_query(org: str, req: QueryRequest) -> QueryResponse:
    if not req.question.strip():
        raise HTTPException(status_code=400, detail={"error": "empty question"})
    _validate_segment(req)
    identity = acl.Identity.from_dict(req.identity.model_dump() if req.identity else None)
    result = _engine().query(
        org=org,
        question=req.question,
        identity=identity,
        accept_hash=req.accept_hash,
        force_generate=req.force_generate,
        role=req.role,
        seniority=req.seniority,
        tenure=req.tenure,
        user_level=req.user_level,
    )
    return QueryResponse(**asdict(result))


@app.post("/api/orgs/{org}/query", response_model=QueryResponse)
def query(org: str, req: QueryRequest):
    return _run_query(org, req)


@app.post("/api/orgs/{org}/check", response_model=QueryResponse)
def check(org: str, req: QueryRequest):
    """Alias of /query used by the VS Code extension's PreToolUse hook."""
    return _run_query(org, req)


@app.get("/api/orgs/{org}/stats")
def stats(org: str):
    store = get_store()
    s = store.get_stats(org)
    budget = store.get_budget(org)
    spend = s.get("spend_usd", 0.0)
    hits = int(s.get("hits", 0))
    misses = int(s.get("misses", 0))
    suggests = int(s.get("suggests", 0))
    total = hits + misses + suggests
    return {
        "org": org,
        "budget": budget,
        "spend_usd": round(spend, 4),
        "saved_usd": round(s.get("saved_usd", 0.0), 4),
        "budget_used_pct": round(min(100.0, (spend / budget * 100) if budget else 0), 2),
        "tokens_saved": int(s.get("tokens_saved", 0)),
        "tokens_spent": int(s.get("tokens_spent", 0)),
        "hits": hits,
        "misses": misses,
        "suggests": suggests,
        "total_requests": total,
        "hit_rate_pct": round((hits / total * 100) if total else 0, 1),
        "cache_size": store.cache_size(org),
    }


@app.get("/api/orgs/{org}/activity")
def activity(org: str, limit: int = 50):
    return {"events": get_store().get_logs(org, limit=limit)}


@app.post("/api/orgs/{org}/confidence-check")
def confidence_check(org: str):
    return eval_mod.run_confidence_check()


def _entry_to_dict(c) -> dict:
    return {
        "hash": c.hash,
        "question": c.question,
        "answer": c.answer,
        "role": c.role,
        "seniority": c.seniority,
        "tenure": c.tenure,
        "min_seniority_level": c.min_seniority_level,
        "hit_count": c.hit_count,
        "created_at": c.created_at,
        "last_asked_at": c.last_asked_at,
    }


@app.get("/api/orgs/{org}/trending")
def trending(org: str, role: str = None, seniority: str = None, tenure: str = None,
             limit: int = 10):
    for name, val, ok in (("role", role, roles.is_valid_role(role)),
                          ("seniority", seniority, roles.is_valid_seniority(seniority)),
                          ("tenure", tenure, roles.is_valid_tenure(tenure))):
        if not ok:
            raise HTTPException(status_code=400,
                                detail={"error": f"invalid {name}: {val}"})
    items = get_store().get_trending(org, role=role, seniority=seniority,
                                     tenure=tenure, limit=limit)
    return {
        "segment": {"role": role, "seniority": seniority, "tenure": tenure},
        "items": [
            {
                "hash": c.hash,
                "question": c.question,
                "answer": c.answer,
                "count": c.hit_count,
                "timestamp": c.last_asked_at,
                "role": c.role,
                "seniority": c.seniority,
            }
            for c in items
        ],
    }


@app.get("/api/orgs/{org}/entries")
def list_entries(org: str, role: str = None, seniority: str = None, tenure: str = None):
    items = get_store().list_entries(org, role=role, seniority=seniority, tenure=tenure)
    return {"entries": [_entry_to_dict(c) for c in items]}


@app.patch("/api/orgs/{org}/entries/{hash_}")
def update_entry(org: str, hash_: str, req: EntryUpdateRequest):
    updated = get_store().update_entry(
        org, hash_, answer=req.answer, min_seniority_level=req.min_seniority_level)
    if updated is None:
        raise HTTPException(status_code=404, detail={"error": "entry not found"})
    return _entry_to_dict(updated)


@app.delete("/api/orgs/{org}/entries/{hash_}")
def delete_entry(org: str, hash_: str):
    ok = get_store().delete_entry(org, hash_)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "entry not found"})
    return {"org": org, "hash": hash_, "deleted": True}


@app.post("/api/orgs/{org}/budget")
def set_budget(org: str, req: BudgetRequest):
    get_store().set_budget(org, req.budget)
    return {"org": org, "budget": req.budget}


@app.post("/api/orgs/{org}/reset")
def reset(org: str):
    get_store().reset_org(org)
    return {"org": org, "status": "reset"}
