#!/usr/bin/env bash
#
# OrgCache — Devin orchestration helper.
#
# Spawns the 4 sub-agent sessions in parallel via the Devin API and polls their
# status. This is a CONVENIENCE wrapper; you can also paste each task-*.md into the
# Devin web UI by hand. Verify the API shape against the current Devin docs:
# the endpoints below reflect the public API at time of writing and may change.
#
# Usage:
#   export DEVIN_API_KEY=sk-...
#   ./devin/orchestrate.sh spawn     # create 4 sessions, save ids to .devin-sessions
#   ./devin/orchestrate.sh status    # poll all saved sessions
#   ./devin/orchestrate.sh message <session_id> "your unblock message"
#
set -euo pipefail

API="${DEVIN_API_BASE:-https://api.devin.ai/v1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESS_FILE="$HERE/.devin-sessions"
REPO_URL="https://github.com/hectar-glitches/tessera"

if [[ -z "${DEVIN_API_KEY:-}" ]]; then
  echo "ERROR: export DEVIN_API_KEY first." >&2
  exit 1
fi
command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 1; }

auth=(-H "Authorization: Bearer ${DEVIN_API_KEY}" -H "Content-Type: application/json")

# task file -> human label
TASKS=(
  "task-1-backend.md|Sub-agent 1: role/seniority backend"
  "task-2-extension.md|Sub-agent 2: VS Code extension"
  "task-3-dashboard.md|Sub-agent 3: dashboard upgrade"
  "task-4-observability-mcp.md|Sub-agent 4: observability + MCP"
)

create_session() {
  local file="$1" label="$2"
  local prompt
  # Prefix the task with the repo + contract reminder, then the full task file.
  prompt="$(cat <<EOF
You are an autonomous Devin sub-agent on the OrgCache project.
Repo: ${REPO_URL}
First read devin/api-contract.md in the repo, then complete the task below exactly.
Open a PR to main with the title specified; do NOT merge.

$(cat "$HERE/$file")
EOF
)"
  # jq -Rs safely JSON-encodes the multiline prompt.
  local body
  body="$(jq -nc --arg p "$prompt" --arg t "$label" \
    '{prompt:$p, title:$t, idempotent:true}')"
  curl -sS "${auth[@]}" -X POST "$API/sessions" -d "$body"
}

cmd_spawn() {
  : > "$SESS_FILE"
  for entry in "${TASKS[@]}"; do
    local file="${entry%%|*}" label="${entry##*|}"
    echo ">> spawning: $label"
    local resp sid url
    resp="$(create_session "$file" "$label")"
    sid="$(echo "$resp" | jq -r '.session_id // .id // empty')"
    url="$(echo "$resp" | jq -r '.url // empty')"
    if [[ -z "$sid" ]]; then
      echo "   !! failed to create session. raw response:" >&2
      echo "   $resp" >&2
      continue
    fi
    echo "$sid|$label|$url" >> "$SESS_FILE"
    echo "   session_id=$sid  url=$url"
  done
  echo
  echo "Saved session ids to $SESS_FILE"
  echo "Now follow devin/coordinator.md for merge order + integration test."
}

cmd_status() {
  [[ -f "$SESS_FILE" ]] || { echo "No $SESS_FILE; run 'spawn' first." >&2; exit 1; }
  while IFS='|' read -r sid label url; do
    [[ -z "$sid" ]] && continue
    local resp state pr
    resp="$(curl -sS "${auth[@]}" "$API/session/$sid" || true)"
    state="$(echo "$resp" | jq -r '.status_enum // .status // "unknown"')"
    pr="$(echo "$resp" | jq -r '(.pull_request.url // .pr_url // empty)')"
    printf '%-34s  %-12s  %s\n' "$label" "$state" "${pr:-$url}"
  done < "$SESS_FILE"
}

cmd_message() {
  local sid="$1"; shift
  local msg="$*"
  local body; body="$(jq -nc --arg m "$msg" '{message:$m}')"
  curl -sS "${auth[@]}" -X POST "$API/session/$sid/message" -d "$body"
  echo
}

case "${1:-}" in
  spawn)   cmd_spawn ;;
  status)  cmd_status ;;
  message) shift; cmd_message "$@" ;;
  *) echo "usage: $0 {spawn|status|message <session_id> <text>}" >&2; exit 1 ;;
esac
