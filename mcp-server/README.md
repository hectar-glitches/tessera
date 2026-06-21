# OrgCache MCP Server

Exposes OrgCache to any MCP-compatible coding agent (Claude Code, Cursor, Devin, …)
over the standard **stdio** transport.

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `check_cache` | `question, role?, seniority?, tenure?` | `{ hit, answer\|null, similarity }` |
| `store_answer` | `question, answer, role?, seniority?, tenure?` | `{ stored, hash }` |
| `get_trending` | `role?, seniority?, tenure?` | `{ items: [...] }` |

`seniority` is mapped to a `user_level` (junior=1 … principal=5) so the backend's
hierarchy filter applies — a junior never receives a staff-only answer.

## Run

```bash
cd mcp-server
npm install
ORGCACHE_URL=http://localhost:8000 npm start   # talks to the real backend
# or, fully offline:
npm run mock &                                  # mock backend on :8000
ORGCACHE_URL=http://localhost:8000 npm start
npm test                                        # smoke test (boots mock + calls tools)
```

Env: `ORGCACHE_URL` (default `http://localhost:8000`), `ORGCACHE_ORG` (default `acmecorp`).

## Connect an agent

Add to your agent's MCP config:

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

## Known limitations

- `store_answer` has no verbatim-write endpoint on the public backend yet; against the
  real backend it triggers a force-generate so an entry exists for the question/segment.
  The provided answer text is stored verbatim only by the mock backend. A dedicated
  `POST /orgs/{org}/store` endpoint is future work.
