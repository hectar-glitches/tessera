# Tessera

**Role-aware semantic cache for engineering teams — instant answers before they hit your coding agent.**

Tessera intercepts questions as you work, checks your org's semantic knowledge cache filtered by **role + seniority + tenure**, and surfaces an instant answer in a clean popup panel. Stop repeating questions across your team.

---

## Features

- **Instant popup** — when a question matches the cache at ≥85% similarity, Tessera shows the cached answer inline without interrupting your flow
- **Role-aware** — answers are filtered by your role, seniority, and tenure so junior engineers see onboarding answers, senior engineers see architecture answers
- **Trending sidebar** — live view of the top questions your segment is asking, auto-refreshed every 5 minutes
- **Claude Code integration** — hooks into Claude Code's PreToolUse event to intercept questions before they hit the agent

## Getting started

1. Install the extension
2. Set your profile in VS Code settings (search **Tessera**):
   - `tessera.serverUrl` — your Tessera backend URL
   - `tessera.org` — your organization id
   - `tessera.role` — engineer / designer / pm / devops / manager
   - `tessera.seniority` — junior / mid / senior / staff / principal
3. Open the **Tessera** panel in the Activity Bar to see trending FAQs
4. Questions are checked automatically via the Claude Code hook, or manually via **Tessera: Check selection against cache** in the Command Palette

## Settings

| Setting | Default | Description |
|---|---|---|
| `tessera.serverUrl` | `http://localhost:8000` | Tessera backend base URL |
| `tessera.org` | `acmecorp` | Organization id |
| `tessera.userName` | `""` | Your name for attribution |
| `tessera.role` | `engineer` | Your role |
| `tessera.seniority` | `junior` | Your seniority level |
| `tessera.joinDate` | `""` | ISO join date — determines onboarding vs experienced tenure |
| `tessera.hookPort` | `7778` | Port for the Claude Code PreToolUse hook listener |
| `tessera.similarityThreshold` | `0.85` | Minimum similarity score to show the popup |

## Claude Code integration

Tessera runs a local HTTP listener on `127.0.0.1:7778`. Add this to your Claude Code settings to hook into every agent prompt:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:7778 -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ]
  }
}
```

Tessera always responds `{"decision":"continue"}` — the popup is advisory and never blocks your agent.

## Commands

| Command | Description |
|---|---|
| `Tessera: Check selection against cache` | Check selected text (or typed input) against the cache |
| `Tessera: Refresh trending FAQs` | Manually refresh the trending sidebar |
