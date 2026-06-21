# Tessera / OrgCache Frontend

React + Vite + Tailwind admin UI for the role-aware semantic cache.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (proxies to backend on :8000)
npm run build        # production build
npm test             # vitest unit tests
```

Set `VITE_API_BASE` to point at a non-default backend, e.g.
`VITE_API_BASE=http://localhost:8000 npm run dev`.

## Admin dashboard (OrgCache)

The dashboard (`src/components/Dashboard.jsx`) gained a role-aware OrgCache view on top
of the legacy Tessera panels:

- **Org selector** — switch between `acmecorp` (OrgCache demo) and `ask-ddoski` (legacy).
- **Filter bar** (`FilterBar.jsx`) — Role / Seniority / Tenure dropdowns. Every section
  below filters by the selection.
- **Cache Health** (`CacheHealth.jsx`) — 4 metric cards: entries, hit rate, tokens
  saved, dollar savings (`tokens_saved × $0.000015`).
- **Trending FAQs** (`TrendingTable.jsx`) — top segment questions by hit count; click a
  row to expand the full answer.
- **Cache Entry Manager** (`EntryManager.jsx`) — inline-edit answers, set
  `min_seniority_level` (1–5), delete entries, and a ⚠️ staleness badge for entries
  older than 30 days.
- **Activity feed** — color-coded HIT / NEAR-MISS / GENERATED events.

### Offline / mock mode

`src/mockData.js` provides a full mock of the OrgCache API. The dashboard renders
entirely offline when:

- `VITE_USE_MOCK=1 npm run dev` (force mock), or
- a live backend request fails (automatic fallback).

This satisfies the "works independently with mock data" constraint, so the UI is
demoable even if the backend, Redis, or other components are down.

## API client

`src/api.js` exports:

- `api` — legacy client bound to `ask-ddoski` (used by the Chat tab).
- `createApi(org)` — factory for a per-org client with the OrgCache endpoints
  (`trending`, `entries`, `updateEntry`, `deleteEntry`, role-aware `query`), each with
  automatic mock fallback.
