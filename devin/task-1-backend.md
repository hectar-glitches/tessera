# Devin Task — Sub-agent 1: Role + Seniority Layer (Backend)

> Paste this entire file as the prompt for a fresh Devin session. It is
> self-contained; you have no other context.

## Repo & setup
- Repo: `https://github.com/hectar-glitches/tessera`
- Clone, then create and work on branch: **`feat/role-seniority-backend`** off `main`.
- Read `devin/api-contract.md` first — it is the frozen contract you must implement.
- Python backend lives in `backend/`. Install: `cd backend && pip install -r requirements.txt`.

## Existing code you are extending (DO NOT rebuild)
- `backend/app/store.py` — `BaseStore` (abstract), `MemoryStore` (fallback),
  dataclasses `CacheCandidate`, `Chunk`, `ChunkHit`, `LogEntry`. `get_store()` picks
  Redis if available else memory.
- `backend/app/redis_store.py` — `RedisStore` (RediSearch vector index, reverse index,
  Lua atomic write `LUA_WRITE`). Index name `tessera:idx`, key prefix `org:`.
- `backend/app/engine.py` — `Engine.query()` decision logic (hit/suggest/miss),
  `_serve_hit`, `_generate`, `write_cache_entry` call site.
- `backend/app/main.py` — FastAPI routes incl. `POST /api/orgs/{org}/query`,
  `POST /api/orgs/{org}/ingest/seed`, `/stats`, `/activity`.
- `backend/app/models.py` — `QueryRequest` = `{ question, accept_hash, force_generate }`,
  `QueryResponse`, `IngestRequest`, `BudgetRequest`.
- `backend/data/ask_ddoski_guide.md` + `test_pairs.json` — legacy demo data.
- There is **no pytest suite yet**. The smoke test is `cd backend && python -m scripts.smoke`.

## What to build

### 1. Data model — new cache-entry fields
Add to every cache entry (both `RedisStore` and `MemoryStore`, and the
`CacheCandidate` dataclass): `role`, `seniority`, `tenure`, `min_seniority_level:int`,
`hit_count:int`, `created_at:float`, `last_asked_at:float`. Keep all existing fields.
Update `write_cache_entry(...)` signature and the `LUA_WRITE` HSET field list to
persist them. In Redis, index `role`, `seniority`, `tenure` as `TagField` and
`min_seniority_level` as `NumericField` so they are filterable.

### 2. Hierarchy filtering
Authoritative mapping: `junior=1, mid=2, senior=3, staff=4, principal=5`.
A user at `user_level=L` may only see entries with `min_seniority_level <= L`.
Implement this filter in `search_cache(...)` (add optional kwargs
`user_level`, `role`, `tenure`; when `None`, behave exactly as today so `ask-ddoski`
is unaffected). In Redis, push the numeric filter into the RediSearch query
(`@min_seniority_level:[-inf L]`) and tag filters for role/tenure; in `MemoryStore`,
filter in Python.

### 3. Tenure segmentation
`onboarding` (0–90 days) should rank setup/tooling/process answers higher;
`experienced` (90+) ranks architecture/patterns/decisions higher. Implement as a
soft re-rank boost (do not hard-exclude). Tag seed entries with the right `tenure`.

### 4. Extend `POST /api/orgs/{org}/query`
Per `api-contract.md`, accept optional `role, seniority, tenure, user_level`. Thread
them into `Engine.query()` → `store.search_cache(...)`. On a hit, increment
`hit_count` and set `last_asked_at`. Add `role, seniority, min_seniority_level` to the
response. Validate enums → return `400 {"error": ...}` on invalid values. Also add a
thin alias `POST /api/orgs/{org}/check` with the identical contract (the extension uses it).

### 5. New endpoint `GET /api/orgs/{org}/trending`
Query params `role, seniority, tenure, limit=10`. Return the top entries by
`hit_count` within the segment, respecting the hierarchy rule. Response shape exactly
as in `api-contract.md` (`{segment, items:[{hash,question,answer,count,timestamp,role,seniority}]}`).

### 6. Entry management endpoints (for the dashboard)
- `GET /api/orgs/{org}/entries?role=&seniority=&tenure=` → list entries w/ new fields.
- `PATCH /api/orgs/{org}/entries/{hash}` `{answer?, min_seniority_level?}` → update.
- `DELETE /api/orgs/{org}/entries/{hash}` → remove (and clean reverse index).
Return `404 {"error":...}` for unknown hash.

### 7. Seed data — 60 AcmeCorp Q&As
Create `backend/data/acmecorp_seed.json` (Next.js + PostgreSQL + AWS stack), each item:
`{question, answer, role, seniority, tenure, min_seniority_level}`. Distribution:
- 20 junior/onboarding (`min_seniority_level=1`): setup, tooling, "how do I…".
  **Must include**: Q "how do I run the dev server" → A "npm run dev".
- 15 mid/experienced (`level=2`): architecture, workflows, patterns.
- 15 senior (`level=3`): system design, ADRs, tradeoffs.
- 10 staff/principal (`level=4`/`5`): strategy, cross-team, org-level. **Must include**
  a staff-only Q like "what is our multi-region failover strategy".
Wire `POST /api/orgs/{org}/ingest/seed` so that for org `acmecorp` it loads these as
pre-populated cache entries (embed each question, store with its fields). Keep the
`ask-ddoski` seed path unchanged.

## Tests (required)
- Introduce pytest: add `backend/tests/` and `pytest` to `requirements.txt`.
- Add **3+ new tests** for role filtering:
  1. junior (`level=1`) cannot receive a `min_seniority_level>=2` entry.
  2. principal (`level=5`) can receive a level-4 staff entry.
  3. `/trending` returns only segment-appropriate, hierarchy-allowed items ordered by `hit_count`.
- Run before AND after your changes:
  ```bash
  cd backend && python -m scripts.smoke      # must still pass (ask-ddoski intact)
  pytest -q                                   # new tests green
  ```

## Constraints
- Never break legacy `ask-ddoski` behavior (omitted role params ⇒ old behavior).
- Works with `MemoryStore` if Redis is down (mirror all logic in both stores).
- All endpoints return JSON; bad input ⇒ 4xx with `{"error": ...}`, never bare 500.
- Add a `## Role-aware cache (OrgCache)` section to `README.md` documenting the new
  fields, hierarchy rule, and endpoints.

## Deliverable / report back
- Open a PR to `main` titled: `feat(backend): role+seniority+tenure cache layer + trending`.
- In the PR body: list modified files, paste a sample `curl` of a junior-engineer query
  returning the level-1 answer, and the pytest output. Do NOT merge.
