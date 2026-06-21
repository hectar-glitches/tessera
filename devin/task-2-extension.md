# Devin Task — Sub-agent 2: VS Code Extension (New Component)

> Paste this entire file as the prompt for a fresh Devin session. Self-contained.

## Repo & setup
- Repo: `https://github.com/hectar-glitches/tessera`
- Branch: **`feat/vscode-extension`** off `main`.
- Read `devin/api-contract.md` — your only knowledge of the backend. Build against it
  with a **mock server fallback** so you are not blocked by Sub-agent 1.
- Create everything under a new top-level folder: **`extension/`**. Touch no other folders.

## Stack
TypeScript + VS Code Extension API for the host; React + Vite for the webview UI.
Bundle with `esbuild` (extension host) + Vite (webview). Package with `vsce`.

## What to build

### 1. Extension host (`extension/src/extension.ts`)
- On activate, read settings (schema below): `serverUrl, userName, role, seniority,
  joinDate`. Compute `tenure` from `joinDate`: `onboarding` if days-since < 90 else
  `experienced`; compute `user_level` from `seniority` (junior=1…principal=5).
- Register a local HTTP listener on `localhost:7777` to receive a **Claude Code
  PreToolUse hook** event. On event, extract the question text and `POST
  {serverUrl}/api/orgs/acmecorp/check` (alias of `/query`) with
  `{question, role, seniority, tenure, user_level}`.
- If response `decision==="hit"` and `similarity > 0.85`, open the popup webview panel
  with the answer. Otherwise stay silent and let the question pass through to the agent.
- Commands: `orgcache.openTrending`, `orgcache.checkSelection` (manual test path that
  sends the current editor selection to `/check`).

### 2. Popup webview (`extension/webview/`, React)
A `WebviewPanel` (tab overlay, NOT a sidebar) shown on cache hit. Layout:
```
⚡ OrgCache  ·  89% match
"how do I run the dev server"
→ npm run dev
👥 12 engineers at your level asked this this week
[✓ Use This Answer]  [Ask Agent →]  [✕]
```
Buttons via `postMessage` to the host:
- **Use This Answer** → copy answer to clipboard (`vscode.env.clipboard.writeText`),
  close panel.
- **Ask Agent →** → close panel, signal host to forward the original question to
  Claude Code (resolve the hook so it proceeds).
- **✕** → close, `POST` a negative signal (best-effort; ignore failure).
The "N engineers at your level" line uses the trending `count` for the matched
question when available, else hides itself.

### 3. Trending sidebar (`WebviewViewProvider`, always visible)
- Shows top 5 from `GET {serverUrl}/api/orgs/acmecorp/trending?role=&seniority=&tenure=`.
- Refresh on activation + every 5 minutes (`setInterval`).
- Each card: question preview, answer, hit count; click expands to full answer.

### 4. Settings schema (`extension/package.json` → `contributes.configuration`)
```
orgcache.serverUrl  string  default "http://localhost:8000"
orgcache.userName   string
orgcache.role       enum [engineer, designer, pm, devops, manager]
orgcache.seniority  enum [junior, mid, senior, staff, principal]
orgcache.joinDate   string  (ISO date)
```
(Note: contract base URL is `:8000`. The spec's `:3000`/`:7777` are the dev-server and
hook ports respectively — use `:8000` for the backend API, `:7777` for the hook listener.)

### 5. Mock fallback (so you are independent)
Add `extension/mock/server.js` — a tiny Express/Node mock implementing `/check` and
`/trending` per the contract with 3–4 canned AcmeCorp answers (incl. "how do I run the
dev server" → "npm run dev"). `npm run mock` starts it on `:8000`. The extension must
work end-to-end against this mock when the real backend is down.

## Tests / verification
- `npm run compile` (tsc) and `npm run build` (webview) succeed with no type errors.
- Add a lightweight test for the pure helpers (`tenure` calc, `seniority→level`) using
  `vitest` or `mocha`.
- Manual: launch Extension Development Host (F5), run `orgcache.checkSelection` on the
  text "how do I run the dev server" with mock server running → popup appears showing
  `npm run dev` at >85% match.
- `npm run package` produces a `.vsix`.

## Constraints
- TypeScript everywhere. No edits outside `extension/`.
- Network calls wrapped in try/catch; on any error the extension degrades silently
  (never throw into the editor; log to an output channel `OrgCache`).
- Add `extension/README.md`: install, configure settings, run mock, F5 dev loop,
  package `.vsix`.

## Deliverable / report back
- Open a PR to `main` titled: `feat(ext): OrgCache VS Code extension`.
- In the PR body: the `.vsix` build path, the F5 steps, and a description of the popup
  rendering against the mock server. Do NOT merge.
