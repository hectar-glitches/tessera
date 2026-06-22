# RFC-001: Workspace-Level Billing

**Status:** Accepted  
**Author:** @eng-leads  
**Review period:** 3 days async → 30-min sync if needed  
**Linear:** CYC-1234

## Problem

Billing is currently tied to teams, but customers create multiple workspaces per team
and want per-workspace billing visibility. Support tickets about "which workspace is
driving our bill" are the #1 billing support category.

## Proposal

Move billing to workspace granularity. Each workspace gets its own billing subscription.
Teams become the account/SSO boundary only.

**Data model changes:**
- Add `workspace_id` FK to `subscriptions` table (migration 0003)
- Deprecate `team_id` FK on `subscriptions` (sunset: Q4 2026)

**API changes:** `/api/v2/billing/*` routes scoped to workspace, not team. v1 routes
kept for backwards compatibility until sunset (CYC-890).

**Frontend:** `workspace-billing-v2` LaunchDarkly flag gates the new UI. Rollout:
10% → 50% → 100% over 2 weeks with churn metric checks at each gate.

## Alternatives considered

- **Per-seat billing:** rejected — too complex for our current customer size.
- **Keep team billing:** rejected — unblocks an enterprise deal worth $2M ARR.

## Open questions

- [ ] What happens to teams with zero workspaces? (Answer: gate behind workspace
  creation — resolved by @product in Slack thread 2026-05-14)
