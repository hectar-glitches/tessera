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

from . import embeddings, eval as eval_mod, ingest as ingest_mod
from .config import get_settings
from .engine import Engine
from .llm import get_llm
from .models import BudgetRequest, IngestRequest, QueryRequest, QueryResponse
from .store import get_store

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

app = FastAPI(title="Tessera", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.post("/api/orgs/{org}/query", response_model=QueryResponse)
def query(org: str, req: QueryRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Empty question")
    result = _engine().query(
        org=org,
        question=req.question,
        accept_hash=req.accept_hash,
        force_generate=req.force_generate,
    )
    return QueryResponse(**asdict(result))


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


@app.post("/api/orgs/{org}/budget")
def set_budget(org: str, req: BudgetRequest):
    get_store().set_budget(org, req.budget)
    return {"org": org, "budget": req.budget}


@app.post("/api/orgs/{org}/reset")
def reset(org: str):
    get_store().reset_org(org)
    return {"org": org, "status": "reset"}
