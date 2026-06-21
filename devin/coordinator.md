# OrgCache — Coordinator Playbook

You are the human (or thin script) coordinating 4 parallel Devin sessions. Devin
does not auto-merge across sessions, so cross-agent ordering and integration are
your job. This file is your checklist.

## 0. Before spawning

- [ ] Devin GitHub app has write access to `hectar-glitches/tessera`.
- [ ] `api-contract.md` is committed to `main` (so every agent can read it).
- [ ] Baseline smoke test passes locally:
  ```bash
  cd backend && pip install -r requirements.txt && python -m scripts.smoke
  ```

## 1. Spawn (parallel)

Create 4 sessions, one per task file. Each branches off `main`:

| Session | Task file | Branch | PR title |
|---------|-----------|--------|----------|
| 1 | `task-1-backend.md` | `feat/role-seniority-backend` | `feat(backend): role+seniority+tenure cache layer + trending` |
| 2 | `task-2-extension.md` | `feat/vscode-extension` | `feat(ext): OrgCache VS Code extension` |
| 3 | `task-3-dashboard.md` | `feat/dashboard-upgrade` | `feat(web): role-aware admin dashboard` |
| 4 | `task-4-observability-mcp.md` | `feat/observability-mcp` | `feat(obs): Arize logging + MCP server` |

All four can run at once because each builds against `api-contract.md` with mocks.

## 2. Monitor (every ~15 min)

For each session, check status (UI or `orchestrate.sh status`). Common unblocks:

- **Agent asks "where is the test suite?"** → "There is no pytest suite yet. Run
  `cd backend && python -m scripts.smoke` as the smoke test, and the
  `/confidence-check` endpoint. Sub-agent 1 introduces pytest; others should add
  their own tests under their component."
- **Agent 3/4 blocked on backend endpoints** → "Do not wait for Sub-agent 1. Build
  against the mocks in `api-contract.md`. Feature-flag anything that needs the live
  endpoint."
- **Agent edits a file owned by another agent** → tell it to revert and stay within
  the file list in its task. (See ownership map below.)

### File ownership (conflict avoidance)
- Sub-agent 1: `backend/app/{redis_store,store,engine,main,models}.py`,
  `backend/data/*`, `backend/tests/*`.
- Sub-agent 2: `extension/**` only (new folder).
- Sub-agent 3: `frontend/src/components/Dashboard.jsx`, `frontend/src/api.js`,
  and new files under `frontend/src/components/`.
- Sub-agent 4: `backend/app/arize_logger.py` (new), `mcp-server/**` (new),
  `.env.example` (append only), one small hook line in `engine.py`.

> `engine.py` and `.env.example` are touched by both Sub-agent 1 and Sub-agent 4.
> Mitigation: Sub-agent 4 adds **only** a single guarded `log_decision(...)` call and
> appends to `.env.example`; merge Sub-agent 1 first, then Sub-agent 4 rebases.

## 3. Merge order (strict)

1. **Sub-agent 1** (backend) → merge to `main` first. Re-run smoke test on `main`.
2. **Sub-agent 3** (dashboard) → rebase on `main`, verify it renders against the now-live
   endpoints, merge.
3. **Sub-agent 4** (observability/MCP) → rebase on `main`, resolve `engine.py` +
   `.env.example`, merge.
4. **Sub-agent 2** (extension) → rebase on `main`, verify popup hits live backend, merge.

After each merge, run the smoke test before proceeding.

## 4. Integration test (after all merged)

```bash
# 1. Redis
docker compose up -d redis

# 2. Backend
cd backend && source .venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000 &

# 3. Seed AcmeCorp
curl -X POST http://localhost:8000/api/orgs/acmecorp/ingest/seed

# 4. Role-filtered query (junior engineer, onboarding)
curl -X POST http://localhost:8000/api/orgs/acmecorp/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"how do I run the dev server","role":"engineer","seniority":"junior","tenure":"onboarding","user_level":1}'
# expect decision=hit, answer="npm run dev"

# 5. Hierarchy check: junior must NOT receive a staff-only answer
curl -X POST http://localhost:8000/api/orgs/acmecorp/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"what is our multi-region failover strategy","role":"engineer","seniority":"junior","tenure":"onboarding","user_level":1}'
# expect decision=miss or suggest (NOT a staff-level hit)

# 6. Trending for the segment
curl 'http://localhost:8000/api/orgs/acmecorp/trending?role=engineer&seniority=junior&tenure=onboarding'

# 7. Dashboard
cd ../frontend && npm install && npm run dev   # load, switch org to acmecorp

# 8. MCP server
cd ../mcp-server && npm install && npm start    # then call check_cache tool

# 9. Arize: confirm decision logs appear (or mock-logged to stdout if no key)
```

Pass criteria:
- [ ] Junior gets the level-1 answer instantly (cache hit).
- [ ] Junior does **not** get a staff-only answer (hierarchy enforced).
- [ ] `/trending` returns segment-correct items.
- [ ] MCP `check_cache` returns the seeded answer.
- [ ] Arize logs present (or stub logs if no key).
- [ ] `ask-ddoski` legacy flow still works (`python -m scripts.smoke`).

## 5. Compile the final PR

Open ONE PR to `main` (or treat the last merge as the umbrella). Title:

```
feat: OrgCache v1 — role-aware semantic cache + VS Code extension + MCP server
```

Description must include:
- **Per sub-agent**: what was built + files touched.
- **Run locally**: the step-by-step from §4.
- **Demo scenario**: "A junior engineer on day 3 asks 'how do I run the dev server'
  and OrgCache returns `npm run dev` instantly via popup — 0 tokens, no agent call."
- **Known limitations / mocked**: e.g. Arize key optional (stub logging fallback),
  60 seed Q&As are synthetic, MCP `store_answer` write path, entity-CRUD feature flags.
