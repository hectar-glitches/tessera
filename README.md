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

## Role-aware cache (OrgCache)

OrgCache builds on Tessera with a role + seniority + tenure segmentation layer so an
org's shared cache serves *role-appropriate* answers.

**New cache-entry fields:** `role` (engineer/designer/pm/devops/manager),
`seniority` (junior/mid/senior/staff/principal), `tenure` (onboarding/experienced),
`min_seniority_level` (1–5), plus `hit_count`, `created_at`, `last_asked_at`.

**Hierarchy rule:** a user at `user_level = L` only sees entries with
`min_seniority_level <= L` (junior=1 … principal=5). Tenure adds a soft re-rank boost
(onboarding favors setup/tooling; experienced favors architecture/patterns).

**Endpoints (org `acmecorp`):**

- `POST /api/orgs/{org}/query` (and alias `/check`) accept optional
  `{ role, seniority, tenure, user_level }`; omitting them preserves legacy behavior.
- `GET /api/orgs/{org}/trending?role=&seniority=&tenure=&limit=` — top entries by
  `hit_count` for a segment, hierarchy-filtered.
- `GET /api/orgs/{org}/entries`, `PATCH /api/orgs/{org}/entries/{hash}`
  (`answer`, `min_seniority_level`), `DELETE /api/orgs/{org}/entries/{hash}` — dashboard
  entry management.

**Seed:** `POST /api/orgs/acmecorp/ingest/seed` loads 60 role-tagged AcmeCorp Q&As
(Next.js + PostgreSQL + AWS) from `backend/data/acmecorp_seed.json`.

**Tests:** `cd backend && python -m scripts.smoke` (legacy) and `pytest -q`
(role-filtering suite in `backend/tests/`).

## Observability (Arize)

Every cache decision is logged via `backend/app/arize_logger.py` with its similarity,
role, seniority, tokens saved, and latency. Set `ARIZE_API_KEY` + `ARIZE_SPACE_KEY` to
ship records to Arize; without them, decisions are logged as structured JSON lines to
stdout (prefixed `ARIZE_LOG`) so the pipeline stays demoable offline. The logger never
raises into the request path.

## MCP server

`mcp-server/` is a Node MCP server (stdio transport) exposing OrgCache to any
MCP-compatible agent (Claude Code, Cursor, Devin, …). Tools: `check_cache`,
`store_answer`, `get_trending`. Connect an agent by adding to its MCP config:

```json
{
  "mcpServers": {
    "orgcache": {
      "command": "node",
      "args": ["path/to/orgcache/mcp-server/index.js"],
      "env": { "ORGCACHE_URL": "http://localhost:8000" }
    }
  }
}
```

See `mcp-server/README.md` for details and `npm test` (boots a mock backend).

## Track

Submitted under **Ddoski's Toolbox** (single main track).
