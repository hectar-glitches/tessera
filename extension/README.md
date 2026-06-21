# OrgCache VS Code Extension

Intercepts questions before they hit your coding agent, checks the org-scoped semantic
cache filtered by **role + seniority + tenure**, and shows an instant answer in a popup
panel. Also surfaces a trending-FAQ sidebar for your segment.

## Develop / run (F5)

```bash
cd extension
npm install
npm run build          # esbuild -> dist/extension.js
npm test               # vitest unit tests (helpers)
```

Then press **F5** in VS Code (with this folder open) to launch the Extension
Development Host. The "Run OrgCache Extension" config builds first.

### Try it with the mock backend (no real server needed)

```bash
npm run mock           # mock OrgCache backend on http://localhost:8000
```

In the Extension Development Host:

1. Set your settings (see below) — defaults already point at the mock.
2. Run **OrgCache: Check selection against cache** (Command Palette) on the text
   `how do I run the dev server`.
3. A popup panel appears: **89%+ match → `npm run dev`** with
   `[✓ Use This Answer] [Ask Agent →] [✕]`.
   - **Use This Answer** copies the answer to your clipboard and closes the panel.
   - **Ask Agent →** dismisses and lets the question flow to your agent.
   - **✕** dismisses (negative signal, logged to the OrgCache output channel).
4. Open the **OrgCache** view in the Activity Bar for the trending sidebar (top 5 for
   your role/seniority/tenure, auto-refreshes every 5 min).

## Settings

| Setting | Default | Notes |
|---------|---------|-------|
| `orgcache.serverUrl` | `http://localhost:8000` | Backend base URL |
| `orgcache.org` | `acmecorp` | Org id |
| `orgcache.userName` | `""` | Attribution |
| `orgcache.role` | `engineer` | engineer/designer/pm/devops/manager |
| `orgcache.seniority` | `junior` | junior/mid/senior/staff/principal |
| `orgcache.joinDate` | `""` | ISO date → onboarding (<90d) or experienced |
| `orgcache.hookPort` | `7777` | Claude Code PreToolUse hook listener port |
| `orgcache.similarityThreshold` | `0.85` | Min similarity to show the popup |

## Claude Code hook

The extension runs a local listener on `127.0.0.1:7777`. Point a Claude Code
PreToolUse hook at it; the extension extracts the question, checks the cache, and shows
the popup on a confident hit. It always responds `{"decision":"continue"}` — the popup
is advisory and never blocks your agent.

## Packaging

```bash
npm run package        # produces orgcache-1.0.0.vsix (requires @vscode/vsce)
```

## Notes

- Webviews are rendered as inline HTML (no separate bundler) and communicate with the
  host via `postMessage`.
- All network calls degrade silently (logged to the **OrgCache** output channel); the
  extension never throws into the editor, and works fully against `npm run mock`.
