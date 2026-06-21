# feat: OrgCache v1 — role-aware semantic cache + VS Code extension + MCP server

Builds OrgCache on top of the existing Tessera base **without breaking** any legacy
`ask-ddoski` functionality. Four workstreams, integrated and tested.

## What each sub-agent built

### 1. Role + Seniority layer (backend)
- New cache-entry fields: `role`, `seniority`, `tenure`, `min_seniority_level`,
  `hit_count`, `created_at`, `last_asked_at` — in both `RedisStore` (indexed Tag/Numeric
  fields + auto-migration) and the in-memory fallback.
- **Hierarchy rule**: `min_seniority_level <= user_level` (junior=1 … principal=5),
  pushed into the RediSearch query; tenure adds a soft re-rank boost.
- `POST /query` (+ `/check` alias) accept `{role, seniority, tenure, user_level}`;
  omitting them = legacy behavior. New `GET /trending` and `GET/PATCH/DELETE /entries`.
- 60 role-tagged AcmeCorp Q&As (`backend/data/acmecorp_seed.json`) + seed loader.
- New pytest suite (`backend/tests/`), legacy smoke test still green.
- Files: `app/{roles,seed,arize_logger}.py`, `app/{store,redis_store,engine,main,models,config}.py`.

### 2. VS Code extension (`extension/`)
- TypeScript host (esbuild bundle): settings, tenure/level derivation, Claude Code
  PreToolUse hook listener on `:7777`, OrgCache output channel.
- Popup webview panel on a confident cache hit (`[✓ Use This Answer] [Ask Agent →] [✕]`)
  + always-on trending sidebar (5-min refresh).
- `mock/server.js` for full offline E2E; vitest helper tests; F5 launch config.

### 3. Admin dashboard (frontend)
- Org selector + role/seniority/tenure **FilterBar**; **CacheHealth** metric cards;
  **TrendingTable**; **CacheEntryManager** (inline edit / set level / delete / staleness).
- `createApi(org)` factory with new endpoints + `mockData.js` fallback (`VITE_USE_MOCK`).
- vitest tests; legacy Chat tab + ask-ddoski views untouched.

### 4. Observability + MCP (`mcp-server/`, backend)
- `arize_logger.log_decision` (stdout JSON fallback, never raises) wired into a single
  timed site in `Engine.query`; `ARIZE_*` config + `.env.example`.
- Node stdio MCP server exposing `check_cache`, `store_answer`, `get_trending`; mock
  backend + smoke test.

## Run locally

```bash
# 1. (optional) Redis — falls back to in-memory if absent
docker compose up -d redis

# 2. Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
curl -X POST http://localhost:8000/api/orgs/acmecorp/ingest/seed   # 60 entries

# 3. Dashboard
cd ../frontend && npm install && npm run dev        # http://localhost:5173 (org: AcmeCorp)

# 4. MCP server
cd ../mcp-server && npm install && ORGCACHE_URL=http://localhost:8000 npm start

# 5. VS Code extension
cd ../extension && npm install && npm run build     # then press F5
```

## Demo scenario

> A **junior engineer on day 3** types *"how do I run the dev server"*. OrgCache checks
> the org cache filtered to their level, finds a 95%+ match, and pops up **`npm run dev`**
> instantly — **0 tokens, no agent call**. When the same junior asks *"what is our
> multi-region failover strategy"* (a **staff-only** entry), the hierarchy filter hides
> it (decision = miss), while a **principal** asking the same gets an instant hit.

Verified end-to-end: seed (60) → junior hit → junior blocked from staff entry →
principal hit → segment trending → MCP `check_cache` (live) → Arize stdout logs.

## Test status

| Suite | Result |
|-------|--------|
| `backend` pytest | 8 passed |
| `backend` smoke (legacy ask-ddoski) | passed |
| `mcp-server` smoke | passed |
| `frontend` build + vitest | build OK, 3 passed |
| `extension` tsc + vitest | compile OK, 6 passed |

## Known limitations / what's mocked

- **No `ANTHROPIC_API_KEY`** → deterministic stub generation; **no Redis** → in-memory
  store; **no `ARIZE_*`** → decisions logged as `ARIZE_LOG` JSON lines to stdout.
- The 60 AcmeCorp Q&As are synthetic.
- MCP `store_answer` has no verbatim-write backend endpoint yet; against the real backend
  it force-generates an entry (mock backend stores verbatim). Dedicated `/store` is future work.
- Extension webviews are inline HTML (no separate React/Vite webview bundler) — a
  pragmatic, fully-working choice; popup + sidebar behave per spec.
- Fallback embedder weakens paraphrase matching (see confidence-check); real
  `sentence-transformers` improves it.
