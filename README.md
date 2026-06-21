# Tessera

**Token-aware FAQ infrastructure for orgs.** A semantic-cache-backed RAG assistant
that lets an org safely cut LLM API costs while serving accurate, source-grounded
answers — and never serving one across a permission boundary. Demoed as **Ask Ddoski**
for AI Hackathon 2026.

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

Every request is logged with its decision path, tokens saved, and dollars saved. Both
the cache search and RAG retrieval are access-scoped to the requester's identity (see
[IAM / access-control governance](#iam--access-control-governance)), so neither a hit
nor a suggestion can leak across a permission boundary.

## Stack

- **Backend:** FastAPI, redis-py (Redis Stack / RediSearch), Anthropic SDK,
  sentence-transformers (local embeddings, with a deterministic fallback).
- **Governance:** an IAM/RBAC layer (clearance levels + team boundaries) on top of the
  role/seniority/tenure segmentation, with sensitivity-tiered cache TTLs.
- **Observability:** Sentry (tracing + AI-governance issues) and Arize (decision logs),
  both optional and no-op without keys.
- **Clients:** a React + Vite + Tailwind dashboard, a VS Code extension, and a Node MCP
  server.
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

## IAM / access-control governance

Beyond entity-safety, Tessera enforces a second boundary: **who is allowed to see an
answer.** A shared org cache is dangerous if an answer generated from a manager-only or
finance-only source can be served to anyone who asks a similar question.
`backend/app/acl.py` is the governance core.

**Two axes**, declared per source section via an inline directive
(`<!-- acl: level=manager team=finance -->`):

- **level** — an ordered clearance tier: `public < employee < manager < exec`.
- **team** — an unordered cache-sharing boundary (teammates share; `exec` sees across
  all teams).

A cached answer **inherits the most-restrictive label** of the chunks it was generated
from (`acl.combine`). A requester — an `Identity` (`user` / `team` / `level`), sent as
the optional `identity` field on `/query` — may see an entry iff
`identity.level >= entry.level` **and** (`entry` has no team restriction, the identity's
team is allowed, or the identity is `exec`).

Enforced on **both cache hits and suggestions**, and RAG retrieval is itself
access-scoped — so a low-clearance user can never be served, *see the existence of*, or
have an answer grounded on, content above their clearance.

**Demo personas** (`GET /api/identities`): Maya (intern), Leo (engineer), Raj (eng
manager), Priya (finance manager), Dana (CEO) — the intern-vs-CEO and same-team-sharing
story.

## Label-aware cache TTL

Cache entries expire on a sensitivity-tiered schedule (`config.cache_ttl_for`): the
more restrictive an answer's ACL level, the sooner it expires. Correctness on source
edits is handled event-driven by the reverse-index invalidation; these TTLs are a
*risk ceiling* that bounds staleness and the blast radius of any mislabel.

| Level | TTL |
|-------|-----|
| `public` | 7 days |
| `employee` | 24 hours |
| `manager` | 1 hour |
| `exec` | 15 minutes |

The served/written entry's absolute expiry is surfaced as `expires_at` on the query
response; `0` disables expiry for a tier.

## Observability

### Arize

Every cache decision is logged via `backend/app/arize_logger.py` with its similarity,
role, seniority, tokens saved, and latency. Set `ARIZE_API_KEY` + `ARIZE_SPACE_KEY` to
ship records to Arize; without them, decisions are logged as structured JSON lines to
stdout (prefixed `ARIZE_LOG`) so the pipeline stays demoable offline. The logger never
raises into the request path.

### Sentry — the silent-failure thesis

An LLM's worst failures never throw: a confident wrong answer, a cache hit that crosses
a permission boundary, an ungrounded hallucination, and a runaway bill all return HTTP
200. `backend/app/telemetry.py` turns those *silent, semantic* failures into first-class
Sentry signals:

- **Traces** — every `/query` is a transaction; `ai.embed -> cache.search ->
  rag.retrieve -> llm.generate` are child spans carrying similarity, tokens, and $ cost.
- **Governance issues** — `ACL_DENIAL` (denied an unauthorized `accept_hash`),
  `NEAR_MISS` (entity-conflict suggest), `UNGROUNDED_ANSWER` (RAG top below the floor),
  and `BOUNDARY_PROBE` (N attempts at gated content within a sliding window) are raised
  as grouped, fingerprinted issues tagged by `team` / `clearance`.

Everything is a no-op unless `SENTRY_DSN` is set, and every SDK call is defensively
wrapped so it can never break a request. `/api/health` exposes `sentry_enabled`.

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

## VS Code extension

`extension/` is a TypeScript VS Code extension that intercepts a question before it
hits your coding agent, checks the org cache filtered by role/seniority/tenure (via the
`/check` alias of `/query`), and shows the answer in a popup — plus a trending-FAQ
sidebar for your segment. It also runs a local Claude Code PreToolUse hook listener and
works fully against a bundled mock backend (`npm run mock`). See `extension/README.md`.

## Built with Devin

`devin/` is the orchestration package that built OrgCache as four parallel,
context-isolated Devin sessions against a frozen `api-contract.md`, merged in dependency
order per `coordinator.md`. See `devin/README.md`.

## Deployment

See `DEPLOYMENT.md` for hosting the backend (PaaS, `$PORT` + `CORS_ORIGINS`) and the
dashboard.

## Tracks

The build demonstrates three prize angles:

- **Redis (beyond caching)** — vector KNN with an ACL + segment prefilter, the
  chunk→cache-key reverse index for event-driven invalidation, and Lua-atomic writes.
- **Sentry** — silent/semantic AI failures (above) as first-class issues and traces.
- **Cognition** — built with Devin (`devin/`).

Submitted under **Ddoski's Toolbox**.
