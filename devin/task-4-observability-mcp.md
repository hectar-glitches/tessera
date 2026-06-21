# Devin Task — Sub-agent 4: Observability + MCP Server

> Paste this entire file as the prompt for a fresh Devin session. Self-contained.

## Repo & setup
- Repo: `https://github.com/hectar-glitches/tessera`
- Branch: **`feat/observability-mcp`** off `main`.
- Read `devin/api-contract.md`. Your MCP tools call the HTTP API there; build against a
  **mock/stub** so you are not blocked by Sub-agent 1.
- Backend in `backend/` (Python). MCP server is a NEW top-level folder `mcp-server/` (Node).

## Part A — Arize logging (`backend/app/arize_logger.py`)
1. Add `arize` to `backend/requirements.txt`.
2. Create `arize_logger.py` exposing `log_decision(**fields)` that:
   - Reads `ARIZE_API_KEY` / `ARIZE_SPACE_KEY` from env (via existing
     `app/config.py` settings pattern — add the two optional settings there).
   - If keys are present, initializes the Arize client and logs one record per
     decision with fields: `question, cache_hit:bool, similarity_score, role,
     seniority, tokens_saved, response_time_ms`. Also log cache-miss + a coarse
     `response_quality` placeholder for generated answers.
   - **If keys are absent, fall back to structured stdout logging** (JSON line) so the
     pipeline is fully demoable offline. Never raise — wrap in try/except.
3. Inject into `backend/app/engine.py`: call `log_decision(...)` after each decision in
   `Engine.query()` (hit/suggest/miss). **Add only this single guarded call site** plus
   the import — keep the diff minimal to avoid conflicts with Sub-agent 1 (who also edits
   `engine.py`). Time the request with `time.perf_counter()` for `response_time_ms`.
4. Append `ARIZE_API_KEY=` and `ARIZE_SPACE_KEY=` to `backend/.env.example` (append only).

## Part B — MCP server (`mcp-server/`)
Build a Node MCP server using `@modelcontextprotocol/sdk` over **stdio** transport
(standard for VS Code / Claude Code MCP). It exposes OrgCache to any MCP-compatible agent.

Tools (signatures + behavior per `api-contract.md`):
- `check_cache(question, role, seniority, tenure)` → calls
  `POST {ORGCACHE_URL}/api/orgs/acmecorp/check`, returns
  `{ hit, answer|null, similarity }`.
- `store_answer(question, answer, role, seniority, tenure)` → stores a Q&A. Coordinate
  via the contract: default to `POST /query` with `force_generate` semantics OR a
  dedicated write endpoint if Sub-agent 1 exposes one; return `{ stored, hash }`.
- `get_trending(role, seniority, tenure)` → calls `GET /trending`, returns `items[]`.

Config: read `ORGCACHE_URL` from env (default `http://localhost:8000`). On connection
failure, return a structured tool error (do not crash the server).

`mcp-server/package.json` scripts:
```json
{ "scripts": { "start": "node index.js" } }
```
(Repo-root convenience: also wire `"start": "node mcp-server/index.js"` if a root
`package.json` is appropriate, else document the path.)

README snippet to add (to root `README.md` under a new `## MCP server` section):
```
Connect any MCP-compatible agent to OrgCache by adding to its MCP config:
{
  "mcpServers": {
    "orgcache": { "command": "node", "args": ["path/to/orgcache/mcp-server/index.js"] }
  }
}
```

## Mock fallback (so you are independent)
Add `mcp-server/mock-backend.js` (tiny Node HTTP stub implementing `/check`,
`/trending`, and the write path with canned AcmeCorp data incl. "how do I run the dev
server" → "npm run dev"). Document `ORGCACHE_URL=http://localhost:8000 npm start`
against either the mock or the real backend.

## Tests / verification
- Python: a unit test that `log_decision` with no keys writes a JSON line and never
  raises; with mocked client, calls `.log(...)` once. Run `cd backend && pytest -q`
  and `python -m scripts.smoke` (must still pass — `ask-ddoski` intact).
- MCP: `cd mcp-server && npm install && npm start` boots with no errors; a scripted
  `check_cache` call for "how do I run the dev server" against the mock returns
  `{hit:true, answer:"npm run dev"}`. Include a `mcp-server/test/smoke.mjs`.

## Constraints
- Python additions = Python; MCP server = Node/TypeScript-or-JS.
- Minimal `engine.py` diff (one guarded call + import). Append-only to `.env.example`.
- Everything degrades gracefully offline (no Arize key, no live backend).
- Add README sections for both the Arize logger and the MCP server.

## Deliverable / report back
- Open a PR to `main` titled: `feat(obs): Arize logging + MCP server`.
- In the PR body: the MCP start command, a sample `check_cache` tool-call result, and
  a sample stdout Arize log line. Do NOT merge.
