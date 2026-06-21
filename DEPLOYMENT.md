# Tessera — Deployment Guide

Production stack:

| Component | Platform | URL |
|-----------|----------|-----|
| Redis | Redis Cloud (free) or Railway Redis plugin | _(connection string only)_ |
| Backend (FastAPI) | Railway | `https://REPLACE-WITH-RAILWAY-URL.up.railway.app` |
| Dashboard (Vite/React) | Vercel | `https://REPLACE-WITH-VERCEL-URL.vercel.app` |

> Fill in the two URLs above after the first deploy. The MCP server runs **locally**
> per-developer and points at the deployed backend.

All required config files are already committed:
- `backend/railway.toml` — Railway build/start/healthcheck
- `backend/app/main.py` — CORS now reads `CORS_ORIGINS` (env-driven, locks down in prod)
- `frontend/vercel.json` — Vite framework + SPA rewrites
- `frontend/.env.production` — `VITE_API_URL`, `VITE_DEFAULT_ORG`

---

## A. Redis (do first)

**Option 1 — Redis Cloud (recommended; has RediSearch):**
1. Sign up at <https://redis.io/cloud> (free 30MB tier).
2. Create a database named `tessera-prod`.
3. Copy the connection string → this is your `REDIS_URL`
   (format: `redis://default:<password>@<host>:<port>`).

**Option 2 — Railway Redis plugin (if Redis Cloud signup is blocked):**
```bash
railway add            # choose "Redis" (or: railway add --plugin redis)
```
Copy the plugin's `REDIS_URL` from the Railway dashboard → Variables.

> ⚠️ **RediSearch required.** Tessera uses a vector index (RediSearch module).
> Redis Cloud includes it. The Railway Redis plugin is vanilla Redis **without**
> RediSearch — if you use it, the backend automatically falls back to its in-memory
> store (works, but cache is not shared across instances / restarts). For a real
> shared cache, use Redis Cloud (or Redis Stack / AWS ElastiCache Redis Stack).

---

## B. Backend → Railway

```bash
npm install -g @railway/cli
railway login                      # interactive (opens browser)
railway init                       # name: tessera-backend
```

Set the service **root directory** to `backend/` (Railway dashboard → Settings →
Source → Root Directory = `backend`). This makes nixpacks pick up
`backend/requirements.txt` and `backend/railway.toml`.

Add environment variables (Railway dashboard → Variables):

| Variable | Value |
|----------|-------|
| `REDIS_URL` | _(from step A)_ |
| `ANTHROPIC_API_KEY` | _(from your `.env`; optional — falls back to stub)_ |
| `ARIZE_API_KEY` | _(optional)_ |
| `ARIZE_SPACE_KEY` | _(optional)_ |
| `CORS_ORIGINS` | `https://REPLACE-WITH-VERCEL-URL.vercel.app` |

> Do **not** set `PORT` manually — Railway injects `$PORT` and the start command in
> `railway.toml` already binds to it.

Deploy:
```bash
railway up
```
Note the generated URL (Settings → Networking → Generate Domain), e.g.
`https://tessera-backend-production.up.railway.app`.

Seed production data:
```bash
curl -X POST https://<railway-url>/api/orgs/acmecorp/ingest/seed
# -> {"org":"acmecorp","entries":60,...}
```

Verify:
```bash
curl https://<railway-url>/api/health
# -> {"status":"ok","store_backend":"redis"|"memory",...}
```

> ⚠️ **Build size note.** `requirements.txt` includes `sentence-transformers`
> (pulls in torch, ~2GB). If the Railway build runs out of space/memory on the free
> tier, remove that line — the backend automatically uses a lightweight hashed
> embedder (lower paraphrase quality, but fully functional). Re-add it on a paid
> plan or pre-bake a Docker image for best semantic quality.

---

## C. Dashboard → Vercel

```bash
npm install -g vercel
cd frontend
```

Set the backend URL — either edit `frontend/.env.production`:
```
VITE_API_URL=https://<railway-url>
VITE_DEFAULT_ORG=acmecorp
```
…**or** (recommended) add `VITE_API_URL` and `VITE_DEFAULT_ORG` as Environment
Variables in the Vercel project dashboard and delete `.env.production`.

Deploy:
```bash
vercel            # first run: link/create project "tessera-dashboard"
vercel --prod     # production deploy
```
Note the URL, e.g. `https://tessera-dashboard.vercel.app`.

---

## D. Lock down CORS (after C)

CORS is already env-driven. Set the backend's `CORS_ORIGINS` to your real origins
(Railway → Variables):
```
CORS_ORIGINS=http://localhost:5173,https://tessera-dashboard.vercel.app
```
Then redeploy the backend:
```bash
railway up
```
(Leaving `CORS_ORIGINS` unset or `*` keeps the API open — fine for local dev, not prod.)

---

## Connect the MCP server to the production backend

The MCP server runs locally next to your coding agent and talks to the deployed API:

```bash
cd mcp-server
npm install
ORGCACHE_URL=https://<railway-url> ORGCACHE_ORG=acmecorp npm start
```

Agent config (Claude Code / Cursor / Devin):
```json
{
  "mcpServers": {
    "tessera": {
      "command": "node",
      "args": ["/absolute/path/to/tessera/mcp-server/index.js"],
      "env": {
        "ORGCACHE_URL": "https://<railway-url>",
        "ORGCACHE_ORG": "acmecorp"
      }
    }
  }
}
```
Tools exposed: `check_cache`, `store_answer`, `get_trending`.

The VS Code extension connects the same way — set `orgcache.serverUrl` to the Railway
URL in VS Code settings.

---

## Seed a new org

Each org is namespaced by id. To stand up a new org (e.g. `globex`):

```bash
# 1. Ingest a knowledge source (creates RAG chunks for generation context)
curl -X POST https://<railway-url>/api/orgs/globex/ingest \
  -H 'Content-Type: application/json' \
  -d '{"document":"# Globex Engineering Guide\n..."}'

# 2. (acmecorp demo only) load the 60 role-tagged sample Q&As
curl -X POST https://<railway-url>/api/orgs/acmecorp/ingest/seed
```

To pre-populate role-tagged cache entries for a custom org, add a query with the
segment fields (it will be cached for that segment on first miss):

```bash
curl -X POST https://<railway-url>/api/orgs/globex/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"how do I deploy","role":"engineer","seniority":"junior","tenure":"onboarding","user_level":1}'
```

Then point the dashboard at it via `VITE_DEFAULT_ORG=globex` (or pick it from the
org selector in the UI).

---

## Redeploy cheatsheet

| Change | Command |
|--------|---------|
| Backend code / env | `railway up` (from `backend/`) |
| Dashboard | `vercel --prod` (from `frontend/`) |
| Re-seed acmecorp | `curl -X POST https://<railway-url>/api/orgs/acmecorp/ingest/seed` |
