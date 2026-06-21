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
];

const LEVEL = { junior: 1, mid: 2, senior: 3, staff: 4, principal: 5 };

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
    const m = ENTRIES.find(
      (e) => e.question === b.question && e.min_seniority_level <= lvl && (!b.role || e.role === b.role),
    );
    return send(200, m
      ? { decision: "hit", cached: true, answer: m.answer, similarity: 0.95, matched_question: m.question }
      : { decision: "miss", cached: false, answer: null, similarity: 0.2, matched_question: null });
  }

  if (req.method === "GET" && /\/trending$/.test(url.pathname)) {
    const role = url.searchParams.get("role");
    const seniority = url.searchParams.get("seniority");
    const lvl = seniority ? LEVEL[seniority] : 5;
    const items = ENTRIES
      .filter((e) => e.min_seniority_level <= lvl && (!role || e.role === role))
      .sort((a, b) => b.hit_count - a.hit_count)
      .slice(0, 10)
      .map((e) => ({ hash: e.hash, question: e.question, answer: e.answer, count: e.hit_count, role: e.role, seniority: e.seniority }));
    return send(200, { segment: { role, seniority }, items });
  }

  send(404, { error: "not found" });
});

const port = process.env.PORT || 8000;
server.listen(port, () => console.log(`[tessera-mock] http://localhost:${port} — ${ENTRIES.length} entries loaded`));
