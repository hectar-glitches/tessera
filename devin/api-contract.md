# OrgCache — Frozen API & Data Contract (v1)

**Every sub-agent builds against this contract.** It is the single source of truth
for request/response shapes so the four parallel agents stay independent. Do not
change a field name or type without updating this file and notifying the coordinator.

Base URL (dev): `http://localhost:8000`
Demo org id: `acmecorp`

---

## Shared enums

```
role        = "engineer" | "designer" | "pm" | "devops" | "manager"
seniority   = "junior" | "mid" | "senior" | "staff" | "principal"
tenure      = "onboarding" | "experienced"
user_level  = 1 | 2 | 3 | 4 | 5      # junior=1 ... principal=5
```

Seniority → level mapping (authoritative):
```
junior=1, mid=2, senior=3, staff=4, principal=5
```

Hierarchy rule: a user at `user_level=L` may see any cache entry whose
`min_seniority_level <= L`. (Junior sees only level-1 content; principal sees all.)

---

## Cache entry shape (stored in Redis / memory store)

Existing fields (do not remove): `hash, question, answer, entities, chunk_ids,
tokens_in, tokens_out`.

**New fields (Sub-agent 1 adds these):**
```
role:                string   # role this answer is for
seniority:           string   # seniority tier
tenure:              string   # onboarding | experienced
min_seniority_level: int      # 1..5, used for hierarchy filtering
hit_count:           int      # incremented on every cache hit (for trending)
created_at:          float    # unix ts, for staleness badge
last_asked_at:       float    # unix ts of most recent hit
```

---

## Endpoint: POST `/api/orgs/{org}/query`

Request body (extends existing `QueryRequest`; old fields stay optional):
```json
{
  "question": "how do I run the dev server",
  "role": "engineer",
  "seniority": "junior",
  "tenure": "onboarding",
  "user_level": 1,
  "accept_hash": null,
  "force_generate": false
}
```
- `role`, `seniority`, `tenure`, `user_level` are **optional**. If omitted, behavior
  is the legacy Tessera behavior (no role filtering) so `ask-ddoski` keeps working.
- When provided, search is filtered to entries the user is allowed to see
  (`min_seniority_level <= user_level`) and ranked within their `role`/`tenure`
  segment.

Response (extends existing `QueryResponse`):
```json
{
  "decision": "hit | suggest | miss",
  "cached": true,
  "answer": "npm run dev",
  "similarity": 0.91,
  "matched_question": "how do I start the dev server",
  "suggestions": [],
  "tokens_saved": 320,
  "dollars_saved": 0.0048,
  "via": "cache",
  "model": "cache",
  "entities": ["focus:method"],
  "role": "engineer",
  "seniority": "junior",
  "min_seniority_level": 1
}
```

`/api/check` (used by the extension) is an **alias** for this endpoint with the same
contract. Sub-agent 1 may add `POST /api/orgs/{org}/check` as a thin alias, or the
extension calls `/query` directly. Default: extension calls `/query`.

---

## Endpoint: GET `/api/orgs/{org}/trending`

Query params (all optional): `role`, `seniority`, `tenure`, `limit` (default 10).

Returns the most-hit answers for that segment, respecting the hierarchy rule
(only entries with `min_seniority_level <= level(seniority)`):
```json
{
  "segment": { "role": "engineer", "seniority": "junior", "tenure": "onboarding" },
  "items": [
    {
      "hash": "a1b2c3",
      "question": "how do I run the dev server",
      "answer": "npm run dev",
      "count": 12,
      "timestamp": 1750300000.0,
      "role": "engineer",
      "seniority": "junior"
    }
  ]
}
```

---

## Endpoint additions for the dashboard (Sub-agent 3 consumes; Sub-agent 1 provides)

- `GET /api/orgs/{org}/entries?role=&seniority=&tenure=` → list cache entries with
  the new fields above (for the Cache Entry Manager).
- `PATCH /api/orgs/{org}/entries/{hash}` body `{ "answer"?: string,
  "min_seniority_level"?: int }` → inline edit / set level.
- `DELETE /api/orgs/{org}/entries/{hash}` → remove from cache.

> If Sub-agent 1 cannot finish the entry CRUD in time, Sub-agent 3 must fall back to
> read-only rendering with mocked data and feature-flag the edit/delete buttons.
> Coordinator decides at merge time.

---

## MCP tools (Sub-agent 4) — must call the HTTP API above

```
check_cache(question, role, seniority, tenure)  -> { hit: bool, answer: string|null, similarity: float }
store_answer(question, answer, role, seniority, tenure) -> { stored: bool, hash: string }
get_trending(role, seniority, tenure)           -> items[] (same shape as /trending)
```

`store_answer` maps to a generate/force-write path; coordinator confirms whether it
writes via `/query` (force_generate) or a dedicated endpoint.

---

## Error handling (all endpoints)

- Bad/missing required field → `400` with `{ "error": "message" }`.
- Unknown org/hash → `404` with `{ "error": "message" }`.
- Never return a bare `500` for user input. Log the trace, return JSON.
