# OrgCache — Devin Orchestration Package

This folder turns the OrgCache build spec into **4 self-contained Devin session
tasks** plus a coordinator workflow. Each task file is written to be pasted into
its own Devin session (its own isolated cloud VM) with **no shared context** — so
every prompt repeats the repo URL, the relevant existing code, the contract it
must honor, and how to test + open a PR.

## Files

| File | Purpose |
|------|---------|
| `api-contract.md` | The frozen API/data contract all four agents build against. Read first. |
| `coordinator.md` | Your playbook: spawn order, merge order, integration test, final PR. |
| `task-1-backend.md` | Sub-agent 1 — role/seniority/tenure layer + `/trending` + 60 seed Q&As. |
| `task-2-extension.md` | Sub-agent 2 — VS Code extension (popup webview + trending sidebar). |
| `task-3-dashboard.md` | Sub-agent 3 — Dashboard upgrade (filters, health, trending, manager). |
| `task-4-observability-mcp.md` | Sub-agent 4 — Arize logging + Node MCP server. |
| `orchestrate.sh` | Optional: spawn all 4 sessions + poll status via the Devin API. |

## Why a shared contract?

Devin sessions are **isolated and parallel** — they cannot see each other's
branches. If the dashboard agent waited for the backend agent's PR, you lose the
parallelism. Instead, `api-contract.md` freezes the request/response shapes up
front. Agents 2/3/4 build against **mocks of that contract** and stay independent
(this also satisfies the spec's "every component must work with mock data if
others are down"). The coordinator then merges in dependency order and runs one
integration test.

## Prerequisites

1. **Devin account** with API access — https://app.devin.ai (Cognition).
2. **GitHub app**: install Devin's GitHub app and grant it access to
   `hectar-glitches/tessera` (Settings → Integrations in Devin).
3. **API key**: create one in Devin settings. Export it locally:
   ```bash
   export DEVIN_API_KEY=sk-...        # your Devin API key
   ```
4. `curl` and `jq` installed (for `orchestrate.sh`).

> Devin's API surface changes occasionally. The endpoints used here
> (`POST /v1/sessions`, `GET /v1/session/{id}`, `POST /v1/session/{id}/message`)
> reflect the public API at time of writing — **verify against the current Devin
> API docs** before relying on `orchestrate.sh`. The task files themselves are
> transport-agnostic: you can paste them into the Devin web UI manually instead.

## Two ways to run

### A. Manual (most reliable)
1. Open Devin → create a new session.
2. Paste the full contents of `task-1-backend.md` as the prompt.
3. Repeat for tasks 2, 3, 4 in **separate** sessions (they run in parallel).
4. Follow `coordinator.md` to review + merge PRs in order, then integrate.

### B. Scripted
```bash
export DEVIN_API_KEY=sk-...
./devin/orchestrate.sh spawn      # creates 4 sessions, writes session ids to .devin-sessions
./devin/orchestrate.sh status     # polls all 4 and prints state + PR links
```

## Conventions every agent must follow

- Base branch: `main`. Each agent works on its own branch (named in its task file).
- Org id for OrgCache demo: **`acmecorp`** (the legacy demo org `ask-ddoski` must
  keep working).
- Never break existing Tessera behavior. Run the smoke test before and after.
- Add a README section for every new component.
- Backend = Python, extension = TypeScript. All new endpoints return JSON and
  handle errors gracefully (never 500 on bad input — return 4xx with a JSON body).
- Open a PR to `main` with the exact title given in the task file. Do **not** merge;
  the coordinator merges.
