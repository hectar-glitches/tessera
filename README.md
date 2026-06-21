# Tessera

**Token-aware FAQ infrastructure for orgs.** A semantic-cache-backed RAG assistant
that lets an org safely cut LLM API costs while serving accurate, source-grounded
answers. Demoed as **Ask Ddoski** for AI Hackathon 2026.

> Semantic caching exists as developer infrastructure. Tessera turns it into a
> budget-and-trust tool a non-technical org admin can actually own, solves the
> false-positive problem that makes naive caching unsafe to deploy, and shows the
> accuracy live.

## Why it's safe (the core idea)

Naive semantic caching serves the wrong answer on near-miss queries — same sentence
shape, different entity ("Saturday lunch" vs "Sunday lunch"). Tessera extracts
entities (numbers, dates, days, track/sponsor names) on both ingest and query, and
only auto-serves a cached answer when **vector similarity is high AND the entities
match**.

When similarity is high but entities disagree (the dangerous gray zone), Tessera does
**not** silently serve. Instead it surfaces the close matches to the user as a
"did you mean one of these previously answered questions?" popup — the human
disambiguates, and the false positive never reaches them as a confident wrong answer.

## Architecture

```
ingest doc -> chunk -> embed -> extract entities -> Redis vector index
                                                      + chunk hash + reverse index

query -> embed -> extract entities -> Redis hybrid search (vector KNN + entity tag)
      -> decide:
           high sim + entity match      -> CACHE HIT  (instant, $0)
           high sim + entity mismatch    -> SUGGEST    (popup, user picks)
           low sim / no match            -> CACHE MISS (call Claude, store entry)
```

Every request is logged with its decision path, tokens saved, and dollars saved.

## Stack

- **Backend:** FastAPI, redis-py (Redis Stack / RediSearch), Anthropic SDK,
  sentence-transformers (local embeddings, with a deterministic fallback).
- **Frontend:** React + Vite + Tailwind.
- **Storage:** Redis Stack — vector search, the chunk-to-cache-key reverse index
  (Redis beyond caching), and Lua-atomic writes.

## Quick start

### 1. Redis Stack

```bash
docker compose up -d redis
```

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add ANTHROPIC_API_KEY (optional; falls back to a stub)
uvicorn app.main:app --reload --port 8000
```

Then seed the demo org:

```bash
curl -X POST http://localhost:8000/api/orgs/ask-ddoski/ingest/seed
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

## Notes on degradation (works without external services)

- **No Redis?** The store falls back to an in-memory implementation with the same
  interface (vector search, reverse index, atomic writes). Use Redis for the demo —
  the reverse index is a prize talking point.
- **No `ANTHROPIC_API_KEY`?** Generation falls back to a deterministic
  context-stitching stub so the full flow stays demoable offline.
- **No `sentence-transformers`?** Embeddings fall back to a hashed bag-of-words
  vector so tests and CI run without heavy ML deps.

## Confidence check

The `/api/orgs/{org}/confidence-check` endpoint runs the hand-built test suite two
ways — vector-similarity-only baseline vs entity-filtered hybrid — and reports which
pairs each gets right. The baseline visibly fails the near-miss-by-entity bucket; the
hybrid passes all four. This is re-runnable live from the dashboard.

## Multi-tenant & storage design

- Every key namespaced by org: `org:{org_id}:cache:{hash}`, `org:{org_id}:chunk:{id}`.
- Source of truth = most recent completed ingestion per org (last-write-wins).
  Multi-document conflict resolution is explicitly out of scope (future work).
- Cache-entry writes and their reverse-index updates are wrapped in a single Lua
  script so a concurrent re-ingest can't open a stale-write window.

## Track

Submitted under **Ddoski's Toolbox** (single main track).
