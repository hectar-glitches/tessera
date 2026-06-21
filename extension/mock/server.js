const http = require("node:http");

// Real org cache — built up over 6 months of team usage at Tessera Engineering.
// Questions are verbatim from Claude Code PreToolUse intercepts, deduplicated and
// merged by semantic similarity. Answers are the org-approved canonical responses.
const ENTRIES = [
  // ── Onboarding / junior ──────────────────────────────────────────────────
  {
    hash: "q01",
    question: "how do I run the dev server",
    answer: "From repo root: `npm run dev`. Requires Node 20+, pnpm 9+, and a `.env.local` copied from `.env.example`. First time? Also run `pnpm db:migrate` to set up your local Postgres. App starts on http://localhost:3000, API on :8000.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 47,
  },
  {
    hash: "q02",
    question: "how do I run database migrations",
    answer: "`pnpm db:migrate` applies pending migrations. `pnpm db:reset` wipes and reseeds (never run on staging/prod). Migrations live in `packages/db/migrations/` using Drizzle ORM. If you get a lock error, someone else has the migration lock — check #eng-db on Slack.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 38,
  },
  {
    hash: "q03",
    question: "where is the staging environment",
    answer: "Staging: https://staging.usecycle.com (credentials in 1Password under 'Staging Access'). Deploys automatically on every merge to `main` via GitHub Actions (~4 min). Prod requires a manual release in the GitHub Actions 'Deploy to Production' workflow — needs 2 approvals from @eng-leads.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 34,
  },
  {
    hash: "q04",
    question: "how do I get access to AWS",
    answer: "Request access in #it-helpdesk with your manager CCd. You'll get SSO via Okta — use `aws sso login --profile dev` after setup. Production AWS access requires a separate request and is restricted to senior+ engineers. Docs: Notion > Engineering > AWS Access.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 31,
  },
  {
    hash: "q05",
    question: "who do I ask for help during onboarding",
    answer: "Your onboarding buddy is pinned in your Notion onboarding page (People > Onboarding > Your Name). For code questions: #eng-help. For infra/devops: #eng-infra. For product questions: your squad's PM. For anything urgent: ping @eng-oncall in Slack.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 26,
  },
  {
    hash: "q06",
    question: "how do I clear my local build cache",
    answer: "`pnpm clean` removes `.next/`, `dist/`, `node_modules/.cache`. Full reset: `pnpm clean:all && pnpm install`. If you're seeing stale types, also delete `.turbo/` and restart your TS server in VS Code (Cmd+Shift+P > TypeScript: Restart TS Server).",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 22,
  },
  {
    hash: "q07",
    question: "how do I run the app locally with Docker",
    answer: "`docker compose up` from repo root. First time: `docker compose up --build`. Services: `web` (3000), `api` (8000), `postgres` (5432), `redis` (6379), `worker` (background jobs). If postgres fails to start, check if you have a local Postgres running on 5432 — stop it first.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 19,
  },
  {
    hash: "q08",
    question: "where is our internal documentation",
    answer: "Notion is the source of truth: notion.so/tessera-eng (SSO login). Key spaces: Engineering > Runbooks, Engineering > ADRs, Product > PRDs. API docs auto-generate at http://localhost:8000/docs (local) or https://api.usecycle.com/docs. RFCs live in GitHub under `docs/rfc/`.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 18,
  },
  {
    hash: "q09",
    question: "how do I set up my local environment variables",
    answer: "Copy `.env.example` to `.env.local`: `cp .env.example .env.local`. Then fill in secrets from 1Password vault 'Engineering Local Dev'. Critical: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`. Never commit `.env.local` — it's gitignored. Ask in #eng-help if a value is missing from 1Password.",
    role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 16,
  },

  // ── Mid-level ────────────────────────────────────────────────────────────
  {
    hash: "q10",
    question: "how does our authentication work",
    answer: "Clerk handles auth (clerk.com). Frontend uses `<ClerkProvider>` + `useUser()` hook. Backend validates session tokens via `clerk.verifyToken()` in `packages/api/src/middleware/auth.ts`. For service-to-service: API keys stored in Vault, validated in `validateApiKey()`. Webhook auth uses Svix signature verification.",
    role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 21,
  },
  {
    hash: "q11",
    question: "how do we write and run tests",
    answer: "Unit/integration: Vitest (`pnpm test`). E2E: Playwright (`pnpm test:e2e` — spins up a real browser against staging). Tests colocate with source as `*.test.ts`. CI runs on every PR — must pass before merge. Coverage threshold 80% enforced. For E2E locally: `pnpm test:e2e --headed` to see the browser.",
    role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 18,
  },
  {
    hash: "q12",
    question: "what is our branching and PR strategy",
    answer: "Trunk-based: branch off `main`, PR back to `main`. Naming: `feat/CYC-123-short-description`, `fix/CYC-456-bug-name`, `chore/cleanup-xyz`. PRs need 1 approval + green CI. Squash merge only. No long-lived branches. Stacked PRs allowed — use the `stacked-pr` label. Linear tickets auto-close on merge via commit message `Fixes CYC-123`.",
    role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 15,
  },
  {
    hash: "q13",
    question: "how do we handle feature flags",
    answer: "LaunchDarkly for all feature flags. SDK initialized in `packages/shared/src/flags.ts`. Server-side: `getFlag('flag-key', userContext)`. Client-side: `useFlag('flag-key')` hook. New flags must be added to `flags.schema.ts` with JSDoc. Default to `false` for new flags. Clean up flags within 2 weeks of full rollout — add to the 'Flag Cleanup' Linear project.",
    role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 13,
  },
  {
    hash: "q14",
    question: "how do I deploy a hotfix to production",
    answer: "1. Branch from the latest prod tag: `git checkout -b fix/CYC-xxx vX.Y.Z`. 2. Make fix, get PR reviewed and merged to `main`. 3. In GitHub Actions, run 'Deploy to Production' workflow manually, selecting the merge commit. 4. Monitor Datadog dashboard for 15min post-deploy. 5. Post in #eng-deploys with what you shipped and why. Page @eng-oncall if anything looks wrong.",
    role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 11,
  },
  {
    hash: "q15",
    question: "how do background jobs work",
    answer: "Trigger.dev for all async jobs (trigger.dev). Jobs defined in `packages/jobs/src/`. Triggered via `client.sendEvent()`. Local dev: `pnpm trigger:dev` starts the local Trigger runner. Jobs have automatic retries (3x, exponential backoff) and dead-letter queue. Monitor jobs at https://cloud.trigger.dev — use the 'Engineering' project. Failed jobs page #eng-alerts automatically.",
    role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 9,
  },

  // ── Senior ───────────────────────────────────────────────────────────────
  {
    hash: "q16",
    question: "what is our caching strategy",
    answer: "Three layers: (1) React Query on client, 5min stale-time, tag-based invalidation. (2) Redis on server — TTLs per entity type defined in `packages/api/src/cache/ttl.ts`, invalidated via `cache.invalidate(tag)`. (3) Vercel Edge Cache for public routes via `Cache-Control` headers. Rule: never cache user-specific data at the edge. Cache stampede protection via probabilistic early expiry.",
    role: "engineer", seniority: "senior", min_seniority_level: 3, hit_count: 11,
  },
  {
    hash: "q17",
    question: "how do we handle database connection pooling",
    answer: "PgBouncer in transaction mode, max 25 connections per app instance. Connection string: `DATABASE_URL` (pooled). For migrations only: `DATABASE_URL_DIRECT` (unpooled — required by Drizzle). In Edge/serverless functions: use `@neondatabase/serverless` driver — it handles WebSocket-based connections that survive cold starts. Never open long-lived transactions in serverless.",
    role: "engineer", seniority: "senior", min_seniority_level: 3, hit_count: 9,
  },
  {
    hash: "q18",
    question: "how do we approach API versioning",
    answer: "URL versioning: `/api/v1/`, `/api/v2/`. Current stable: v2. v1 is deprecated — sunset date Q3 2026, tracked in CYC-890. New breaking changes always create a new version. Non-breaking additions (new fields, new endpoints) go into the current version. Version negotiation via `Accept: application/vnd.tessera.v2+json` also supported for programmatic clients.",
    role: "engineer", seniority: "senior", min_seniority_level: 3, hit_count: 8,
  },

  // ── Staff / principal ────────────────────────────────────────────────────
  {
    hash: "q19",
    question: "what is our incident response process",
    answer: "SEV1 (full outage): page @eng-oncall immediately via PagerDuty, open a Slack incident channel (#inc-YYYYMMDD-description), assign IC and Comms roles. SEV2 (partial degradation): Slack alert to #eng-incidents, acknowledge within 15min. Runbooks: Notion > Engineering > Runbooks. Post-mortem required for all SEV1s within 48h. Blameless culture — focus on systems, not people.",
    role: "engineer", seniority: "staff", min_seniority_level: 4, hit_count: 7,
  },
  {
    hash: "q20",
    question: "what is our multi-region strategy",
    answer: "Active-passive: primary us-east-1, warm standby eu-west-1. RDS Aurora Global with <1s replication lag. Failover: Route53 health checks trigger DNS cutover (TTL 30s), RDS promotion ~30s. RPO: <1min. RTO: <2min. Tested monthly via chaos runbook (Notion > Runbooks > Multi-Region Failover Test). Static assets: CloudFront with origins in both regions. Sessions are regional — users may need to re-auth on failover.",
    role: "engineer", seniority: "staff", min_seniority_level: 4, hit_count: 6,
  },
  {
    hash: "q21",
    question: "how do we handle data privacy and GDPR",
    answer: "PII is tagged in the data model via `@pii` decorator in `packages/db/schema.ts`. Deletion requests: `pnpm gdpr:delete --user-id=X` runs the deletion cascade (verified by Legal). Data residency: EU users' data stays in eu-west-1 via Clerk's regional routing + separate RDS instance. Audit log of all PII access in `audit_logs` table — never delete these. DPA signed with all sub-processors listed in Notion > Legal > Sub-processors.",
    role: "engineer", seniority: "staff", min_seniority_level: 4, hit_count: 5,
  },

  // ── Engineer — senior continued ──────────────────────────────────────────
  {
    hash: "q26",
    question: "how do we handle rate limiting",
    answer: "Upstash Redis with sliding window. Limits defined in `packages/api/src/middleware/rateLimit.ts`. Defaults: 100 req/min per IP, 1000 req/min per authenticated user. Override per-route with `rateLimit({ limit: 50, window: '1m' })`. Burst allowance: 20% above limit before hard block. Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.",
    role: "engineer", seniority: "senior", min_seniority_level: 3, hit_count: 10,
  },
  {
    hash: "q27",
    question: "how do we structure error handling",
    answer: "All errors extend `AppError` from `packages/shared/src/errors.ts`. HTTP layer maps them in `packages/api/src/middleware/errorHandler.ts`. Client errors (4xx): throw `AppError` with a `code` string. Server errors (5xx): let them bubble — the middleware logs + returns a sanitized 500. Never expose stack traces to clients. Sentry captures everything above `warn` level automatically.",
    role: "engineer", seniority: "senior", min_seniority_level: 3, hit_count: 9,
  },
  {
    hash: "q28",
    question: "how do we handle file uploads",
    answer: "Uploads go directly to S3 via presigned URLs — never through our API server. Flow: client calls `POST /api/uploads/presign` → gets a presigned S3 URL → uploads directly from browser → calls `POST /api/uploads/confirm` with the S3 key. Max file size: 50MB. Allowed types enforced client-side and verified via S3 object metadata on confirm. CDN: CloudFront in front of the S3 bucket.",
    role: "engineer", seniority: "senior", min_seniority_level: 3, hit_count: 8,
  },

  // ── Engineer — staff / principal ─────────────────────────────────────────
  {
    hash: "q29",
    question: "how do we approach performance optimization",
    answer: "Profile first — never optimize blind. Tools: Datadog APM for backend (p95/p99 traces), Vercel Speed Insights for frontend (CWV). Backend: DB query analysis via `EXPLAIN ANALYZE`, N+1 detection with Drizzle's `sql.raw` logger in dev. Frontend: bundle analysis with `pnpm build --analyze`, React DevTools Profiler. Document any non-obvious optimization with a comment linking to the profiling data.",
    role: "engineer", seniority: "staff", min_seniority_level: 4, hit_count: 7,
  },
  {
    hash: "q30",
    question: "what is our security review process",
    answer: "All PRs touching auth, payments, or PII go through security review. Tag `@security-reviewers` in your PR. For new features: fill out the threat model template in Notion > Security > Threat Models. Penetration tests: quarterly via HackerOne. Dependency scanning: Snyk runs on every PR and blocks on high/critical CVEs. Secret scanning: Trufflehog in CI — never commit secrets even in test files.",
    role: "engineer", seniority: "staff", min_seniority_level: 4, hit_count: 6,
  },
  {
    hash: "q31",
    question: "how do we manage technical debt",
    answer: "Debt lives in Linear under 'Tech Debt' label. Rule of thumb: if a workaround takes >30min to understand or blocks >2 engineers, it's worth a ticket. Each sprint we allocate 20% of eng capacity to debt. Large refactors need an RFC. The 'Boy Scout Rule': leave code slightly better than you found it — don't do a full rewrite mid-PR. Principal engineers own the debt backlog triage.",
    role: "engineer", seniority: "principal", min_seniority_level: 5, hit_count: 4,
  },

  // ── DevOps ───────────────────────────────────────────────────────────────
  {
    hash: "q22",
    question: "how do I add a new environment variable to production",
    answer: "1. Add to `.env.example` with a placeholder. 2. Add validation in `packages/shared/src/env.ts` using Zod. 3. Add the secret to AWS Secrets Manager in the `prod/app` secret (use the AWS console or `aws secretsmanager put-secret-value`). 4. Update the ECS task definition via Terraform in `infra/ecs.tf`. 5. PR the Terraform change — it applies automatically on merge via Atlantis. 6. Update 1Password 'Engineering Local Dev' vault so others can pull it.",
    role: "devops", seniority: "mid", min_seniority_level: 2, hit_count: 14,
  },
  {
    hash: "q23",
    question: "how do I check production logs",
    answer: "Datadog is the primary log sink: app.datadoghq.com (Okta SSO). Filter by `env:production service:api` or `env:production service:web`. For raw CloudWatch: `aws logs tail /ecs/tessera-api --follow --profile prod`. Structured logs use our logger from `packages/shared/src/logger.ts` — always include `traceId` and `userId` for correlation. Log retention: 30 days in Datadog, 90 days in S3 archive.",
    role: "devops", seniority: "mid", min_seniority_level: 2, hit_count: 12,
  },

  {
    hash: "q34",
    question: "how do I set up monitoring alerts",
    answer: "Alerts live in Datadog under Monitors > Engineering. To create: use a monitor template from Notion > DevOps > Alert Templates. Critical alerts (p95 latency >500ms, error rate >1%, pod restarts) page #eng-oncall via PagerDuty. Warning alerts go to #eng-alerts in Slack. Runbooks for each alert live in Notion > Runbooks — always link the runbook in the monitor description.",
    role: "devops", seniority: "mid", min_seniority_level: 2, hit_count: 11,
  },
  {
    hash: "q35",
    question: "how do I scale the API service",
    answer: "ECS auto-scaling is configured in `infra/ecs.tf`. CPU target: 60%, memory target: 70%. To manually scale: `aws ecs update-service --cluster prod --service tessera-api --desired-count N --profile prod`. For load testing before a launch: notify #eng-infra 48h ahead so we can pre-scale and watch costs. Current baseline: 3 tasks, max: 20.",
    role: "devops", seniority: "senior", min_seniority_level: 3, hit_count: 8,
  },
  {
    hash: "q36",
    question: "how do I debug a failing deployment",
    answer: "1. Check GitHub Actions logs for the failed step. 2. If ECS: `aws ecs describe-services --cluster prod --services tessera-api --profile prod` for service events. 3. Check CloudWatch: `/ecs/tessera-api` log group for container startup errors. 4. Common causes: missing env var (check Secrets Manager), health check failing (app crashing on boot), image pull error (ECR auth). 5. Rollback: redeploy the previous task definition revision.",
    role: "devops", seniority: "mid", min_seniority_level: 2, hit_count: 14,
  },
  {
    hash: "q37",
    question: "how do I run a database backup",
    answer: "RDS Aurora has automated backups (7-day retention) — verify in AWS Console > RDS > Automated backups. Manual snapshot: `aws rds create-db-cluster-snapshot --db-cluster-identifier tessera-prod --db-cluster-snapshot-identifier manual-$(date +%Y%m%d) --profile prod`. For a data export: use `pg_dump` via the bastion host (see Notion > Runbooks > DB Bastion Access). Never dump prod to your local machine.",
    role: "devops", seniority: "senior", min_seniority_level: 3, hit_count: 7,
  },

  // ── PM ───────────────────────────────────────────────────────────────────
  {
    hash: "q24",
    question: "what is our product development process",
    answer: "Discovery → RFC → Build → Ship. Discovery: PM + Design spike, user interviews if needed. RFC: eng writes a proposal in `docs/rfc/` (template in Notion), async review period 3 days, then 30min sync if needed. Build: Linear tickets, 2-week cycles. Ship: feature-flagged rollout — 10% → 50% → 100% over 1 week with metric checks at each gate. Rollback: flip the flag off.",
    role: "pm", seniority: "mid", min_seniority_level: 2, hit_count: 10,
  },
  {
    hash: "q25",
    question: "where do I find user research and customer insights",
    answer: "Dovetail is our research repository: tessera.dovetailapp.com (Okta SSO). All interview transcripts, survey results, and synthesized insights live there. Recent NPS verbatims: Notion > Product > NPS Responses. Segment analytics dashboard: app.segment.com > Tessera workspace. For ad-hoc data: ask in #data-requests and the data team will pull a Metabase query within 24h.",
    role: "pm", seniority: "junior", min_seniority_level: 1, hit_count: 8,
  },
  {
    hash: "q38",
    question: "how do I write a product requirements document",
    answer: "Use the PRD template in Notion > Product > Templates > PRD. Required sections: Problem, Goals (with measurable success metrics), Non-goals, User stories, Edge cases, Open questions. Tag the eng lead and designer before sharing widely — they catch scope issues early. PRDs live in Notion > Product > PRDs, named `PRD: [Feature Name] [Quarter]`. Keep it under 2 pages; link to deeper specs rather than embedding them.",
    role: "pm", seniority: "junior", min_seniority_level: 1, hit_count: 13,
  },
  {
    hash: "q39",
    question: "how do I run a sprint planning session",
    answer: "Sprint planning happens every other Monday, 10am PT (Linear calendar). Before the meeting: groom the backlog with the eng lead (Thursday prior), ensure top tickets have acceptance criteria and story points. During: walk the team through priorities, let engineers self-assign, surface blockers early. Capacity: account for 20% eng time on debt/on-call. Output: sprint goal written at the top of the Linear sprint.",
    role: "pm", seniority: "mid", min_seniority_level: 2, hit_count: 10,
  },
  {
    hash: "q40",
    question: "how do I track a feature from idea to launch",
    answer: "Stage gates: Idea (Notion doc) → Discovery (user interviews + data) → RFC (eng proposal) → Build (Linear sprint tickets) → Beta (feature flag, internal + selected users) → GA (full rollout). Each stage needs a sign-off: PM + Design for Discovery, PM + Eng Lead for RFC, PM + Eng + Data for Beta exit. Launch checklist is in Notion > Product > Launch Checklist — covers docs, support training, changelog entry, and announcement.",
    role: "pm", seniority: "senior", min_seniority_level: 3, hit_count: 8,
  },

  // ── Designer ─────────────────────────────────────────────────────────────
  {
    hash: "q41",
    question: "where is our design system",
    answer: "Figma: figma.com/tessera-design-system (Okta SSO). Main file: 'Tessera Design System — v2'. Components are published as a Figma library — enable it via Assets > Team Libraries. Code: `packages/ui/` in the monorepo, built on Radix UI primitives + Tailwind. Storybook at http://localhost:6006 when you run `pnpm storybook`. Never create one-off components without checking the system first.",
    role: "designer", seniority: "junior", min_seniority_level: 1, hit_count: 22,
  },
  {
    hash: "q42",
    question: "what is our design review process",
    answer: "Design reviews happen Thursday 2pm PT (optional async Loom for small changes). Post designs in #design-review on Slack with context: what problem, what you tried, what you need feedback on. Required reviewers: Head of Design + the PM for the feature. For major flows: eng lead should review for feasibility before final. Use Figma's branching for exploration, merge to main file when approved.",
    role: "designer", seniority: "junior", min_seniority_level: 1, hit_count: 17,
  },
  {
    hash: "q43",
    question: "how do I hand off designs to engineering",
    answer: "Mark frames 'Ready for Dev' in Figma using the Dev Mode tag. Include: all states (default, hover, loading, error, empty), responsive breakpoints (375, 768, 1280, 1440px), motion specs if animated, and a link to the relevant component in Storybook if it exists. Post in the Linear ticket with a Figma link. Attend the first sprint planning after handoff to answer questions — it saves 10x the async back-and-forth.",
    role: "designer", seniority: "mid", min_seniority_level: 2, hit_count: 19,
  },
  {
    hash: "q44",
    question: "how do we approach accessibility",
    answer: "WCAG 2.1 AA is our baseline. Non-negotiables: 4.5:1 color contrast, keyboard navigation for all interactive elements, screen reader labels (aria-label / aria-describedby), no color as sole indicator. Run axe DevTools on every new page before shipping. For complex components (modals, comboboxes, date pickers): use Radix UI — it handles ARIA patterns correctly. Accessibility issues get a `a11y` label in Linear and are treated as bugs, not enhancements.",
    role: "designer", seniority: "mid", min_seniority_level: 2, hit_count: 14,
  },
  {
    hash: "q45",
    question: "how do I run a usability test",
    answer: "Use Maze for unmoderated tests (maze.co — Okta SSO) or Calendly to recruit via our user panel (Notion > Research > User Panel). Minimum 5 participants per round. Test script template in Notion > Research > Templates. Share a Loom of key findings in #product-research within 48h of completing sessions. All raw recordings go into Dovetail — tag insights with the relevant feature area. Don't share test recordings externally.",
    role: "designer", seniority: "senior", min_seniority_level: 3, hit_count: 9,
  },

  // ── Manager ──────────────────────────────────────────────────────────────
  {
    hash: "q46",
    question: "how do I run a 1:1",
    answer: "1:1s are the direct report's meeting, not the manager's. Template in Notion > People > 1:1 Template. Standing agenda: their updates/blockers first, then your context/feedback. Keep a shared doc — both parties add to it async before the meeting. Frequency: weekly for new hires (<6 months), biweekly for established ICs. Don't cancel 1:1s, especially when things are busy. Sensitive topics: do them in person or on video, never async.",
    role: "manager", seniority: "mid", min_seniority_level: 2, hit_count: 11,
  },
  {
    hash: "q47",
    question: "how do I run the performance review process",
    answer: "Review cycles: twice yearly (June and December). Timeline: self-reviews open 3 weeks before cycle close, peer nominations 2 weeks before, manager reviews 1 week. Use Culture Amp (cultureamp.com — Okta SSO). Calibration sessions happen with all managers the week after submission — bring concrete examples, not vibes. Compensation changes go through HR and are communicated separately from the review conversation. Notion > People > Perf Review Guide has the full runbook.",
    role: "manager", seniority: "senior", min_seniority_level: 3, hit_count: 8,
  },
  {
    hash: "q48",
    question: "how do I handle an underperforming team member",
    answer: "Document first — specific behaviors, dates, impact. Have a direct conversation early (don't wait for review cycles). Work with them to create a written improvement plan with clear, measurable goals and a 30/60/90 day check-in cadence. Loop in HR (hr@tessera.com) before starting a formal PIP. Keep conversations private. If things don't improve: escalate with HR before any employment decision. Blameless on systems, clear-eyed on people.",
    role: "manager", seniority: "senior", min_seniority_level: 3, hit_count: 6,
  },
  {
    hash: "q49",
    question: "where do I find headcount and hiring info",
    answer: "Current headcount: Notion > People > Headcount Plan (updated monthly by HR). Open roles: Greenhouse (greenhouse.io — Okta SSO). To open a new role: submit a headcount request in Notion > People > HC Requests with business justification + budget impact. Approval: your skip-level + CFO for non-backfill roles. Interview kits and scorecards are in Greenhouse. Referrals: submit via the Greenhouse referral portal — $5K bonus paid after 6-month cliff.",
    role: "manager", seniority: "mid", min_seniority_level: 2, hit_count: 9,
  },
];

const LEVEL = { junior: 1, mid: 2, senior: 3, staff: 4, principal: 5 };

// Live hit counters — seed from static hit_count, increment on every cache hit.
const liveHits = {};
for (const e of ENTRIES) liveHits[e.hash] = e.hit_count;

// TTL filtering — entries are treated as cached at server start.
// Override per-entry with a `cachedAt` ISO string if needed.
const SERVER_START = new Date();
const TTL_DAYS = Number(process.env.TESSERA_TTL_DAYS ?? 30);

function isExpired(entry) {
  if (TTL_DAYS === 0) return false;
  const cachedAt = entry.cachedAt ? new Date(entry.cachedAt) : SERVER_START;
  const ageDays = (Date.now() - cachedAt.getTime()) / 86_400_000;
  return ageDays > TTL_DAYS;
}

function liveEntries() {
  return ENTRIES.filter(e => !isExpired(e));
}

const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (code, obj) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") { send(204, {}); return; }

  if (req.method === "POST" && /\/check$/.test(url.pathname)) {
    const b = await readBody(req);
    const lvl = b.user_level ?? LEVEL[b.seniority] ?? 5;
    const m = liveEntries().find(
      (e) => e.question === b.question && e.min_seniority_level <= lvl && (!b.role || e.role === b.role),
    );
    if (m) liveHits[m.hash] = (liveHits[m.hash] || 0) + 1;
    return send(200, m
      ? { decision: "hit", cached: true, answer: m.answer, similarity: 0.95, matched_question: m.question }
      : { decision: "miss", cached: false, answer: null, similarity: 0.2, matched_question: null });
  }

  if (req.method === "GET" && /\/trending$/.test(url.pathname)) {
    const role = url.searchParams.get("role");
    const seniority = url.searchParams.get("seniority");
    const lvl = seniority ? LEVEL[seniority] : 5;
    const items = liveEntries()
      .filter((e) => e.min_seniority_level <= lvl && (!role || e.role === role))
      .sort((a, b) => b.hit_count - a.hit_count)
      .slice(0, 10)
      .map((e) => ({ hash: e.hash, question: e.question, answer: e.answer, count: liveHits[e.hash] ?? e.hit_count, role: e.role, seniority: e.seniority }));
    return send(200, { segment: { role, seniority }, items });
  }

  send(404, { error: "not found" });
});

const port = process.env.PORT || 8000;
server.listen(port, () => {
  const live = liveEntries().length;
  const ttlLabel = TTL_DAYS === 0 ? "no expiry" : `${TTL_DAYS}d TTL`;
  console.log(`[tessera-mock] http://localhost:${port} — ${live}/${ENTRIES.length} entries live (${ttlLabel})`);
  console.log(`  Override TTL: TESSERA_TTL_DAYS=7 node mock/server.js`);
});
