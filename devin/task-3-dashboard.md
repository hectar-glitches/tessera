# Devin Task — Sub-agent 3: Admin Dashboard Upgrade (Frontend)

> Paste this entire file as the prompt for a fresh Devin session. Self-contained.

## Repo & setup
- Repo: `https://github.com/hectar-glitches/tessera`
- Branch: **`feat/dashboard-upgrade`** off `main`.
- Read `devin/api-contract.md` — the endpoints you consume. Build against a **mock
  data layer** so you are not blocked by Sub-agent 1.
- Frontend: `cd frontend && npm install && npm run dev` (Vite, React 18, Tailwind,
  lucide-react already configured).

## Existing code you are extending (DO NOT rebuild)
- `frontend/src/components/Dashboard.jsx` — current admin dashboard.
- `frontend/src/components/Chat.jsx` — chat UI (leave as-is).
- `frontend/src/api.js` — API client. **Important:** it currently hardcodes
  `export const ORG = "ask-ddoski"`. Add support for `acmecorp` (e.g. an org selector
  or a second exported client) WITHOUT breaking the existing `ask-ddoski` calls.
- `frontend/src/App.jsx` — tab shell (`chat` | `dash`).

## What to build (add to Dashboard, keep existing functionality intact)

### 1. Role/Seniority/Tenure filter bar (top of dashboard)
Three dropdowns: Role | Seniority | Tenure (values from the contract enums, plus an
"All" option). Selection is the single source of truth that all sections below filter by.

### 2. Cache Health panel — 4 metric cards (with lucide icons)
- Total entries in cache.
- Hit rate % (last 24h).
- Tokens saved = `cache_hits × avg_tokens_per_answer × 1` (use stats from
  `/api/orgs/{org}/stats`; if a field is missing, derive from activity).
- Dollar savings = `tokens_saved × $0.000015`.

### 3. Trending FAQ table
Columns: Question | Answer Preview | Role | Seniority | Hits | Last Asked.
Source: `GET /api/orgs/{org}/trending` with the selected filters. Click a row → expand
to full answer. This enhances (does not delete) the existing activity view.

### 4. Cache Entry Manager
List entries from `GET /api/orgs/{org}/entries` with: Question, Answer preview, Role,
Seniority, Hit count. Per row:
- **[Edit]** → inline edit answer → `PATCH /api/orgs/{org}/entries/{hash}` `{answer}`.
- **[Delete]** → `DELETE /api/orgs/{org}/entries/{hash}` (confirm first).
- **[Set Level]** → change `min_seniority_level` (1–5) → `PATCH {min_seniority_level}`.
- **Staleness badge**: if `created_at` > 30 days ago, show a ⚠️ warning pill.

> If the `entries`/PATCH/DELETE endpoints are not live yet, render from mock data and
> feature-flag the Edit/Delete/Set-Level buttons (disabled with a tooltip "backend
> pending"). The table must still render.

### 5. Activity feed (enhance existing)
Show timestamp, question, HIT/MISS, role, seniority. Color-coded: green=hit, red=miss.
Source: existing `GET /api/orgs/{org}/activity`.

## Mock data layer (so you are independent)
Add `frontend/src/mockData.js` with realistic AcmeCorp entries/trending/stats matching
the contract shapes, and a `VITE_USE_MOCK` flag in `api.js`: when set (or when a fetch
fails), serve mock data so the dashboard renders fully offline. Include "how do I run
the dev server" → "npm run dev" among the mocks.

## Tests / verification
- `npm run build` succeeds (no errors).
- All 5 sections render with `VITE_USE_MOCK=1 npm run dev`.
- Changing the filter bar updates the trending table + entry manager.
- Add a component test (vitest + @testing-library/react) for the filter bar driving
  the trending table render.

## Constraints
- Use the existing Tailwind + lucide-react setup; match the current dark UI style.
- Do not break `ask-ddoski` views or the Chat tab.
- All new files under `frontend/src/components/`; only `Dashboard.jsx` + `api.js`
  among existing files may be modified.
- Add a `## Admin dashboard (OrgCache)` section to `frontend/README.md` (create if absent).

## Deliverable / report back
- Open a PR to `main` titled: `feat(web): role-aware admin dashboard`.
- In the PR body: list new components, and screenshots/description of the 5 sections
  rendering against mock data. Do NOT merge.
