# AcmeCorp Platform — Demo Repo

This is the fictional engineering codebase that the Tessera mock server's cached Q&A
entries are *about*. When a new hire asks Tessera "how do I run the dev server?", the
cached answer references files that actually exist here.

## Quick start

```bash
cp .env.example .env.local     # fill from 1Password "Engineering Local Dev"
docker compose up              # postgres :5432, redis :6379, web :3000, api :8000
pnpm install
pnpm db:migrate                # apply migrations in packages/db/migrations/
pnpm dev                       # all packages via Turborepo
```

## Stack

| Layer | Tool |
|---|---|
| Frontend | Next.js 14, React, Tailwind |
| Monorepo | pnpm workspaces + Turborepo |
| Auth | Clerk (`packages/api/src/middleware/auth.ts`) |
| Database | Drizzle ORM + PostgreSQL (Neon in prod), PgBouncer pooling |
| Feature flags | LaunchDarkly (`packages/shared/src/flags.ts`) |
| Background jobs | Trigger.dev (`packages/jobs/src/`) |
| Caching | Redis — TTLs in `packages/api/src/cache/ttl.ts` |
| Infra | AWS ECS + RDS Aurora, Terraform (`infra/ecs.tf`), Atlantis for GitOps |
| Observability | Datadog (logs/APM), Sentry (errors), PagerDuty (alerting) |
| Testing | Vitest (unit/integration), Playwright (E2E) |
| CI/CD | GitHub Actions — auto-deploys `main` to staging, manual promote to prod |

## Tessera cache coverage

Every file here corresponds to at least one of the 25 trending Q&A entries in
`../server.js`. The mapping:

| Cache entry | File(s) |
|---|---|
| "how do I run the dev server" | `package.json` → `pnpm dev` |
| "how do I run database migrations" | `packages/db/migrations/`, `package.json` → `pnpm db:migrate` |
| "where is the staging environment" | (GitHub Actions — not in repo, mentioned in answer) |
| "how do I set up my local environment variables" | `.env.example` |
| "how do I run the app locally with Docker" | `docker-compose.yml` |
| "how does our authentication work" | `packages/api/src/middleware/auth.ts` |
| "how do we handle feature flags" | `packages/shared/src/flags.ts` |
| "how do background jobs work" | `packages/jobs/src/email-notification.ts` |
| "what is our caching strategy" | `packages/shared/src/cache.ts`, `packages/api/src/cache/ttl.ts` |
| "how do I add a new environment variable to production" | `infra/ecs.tf`, `packages/shared/src/env.ts` |
| "how do we handle data privacy and GDPR" | `packages/db/src/schema.ts` (@pii), `scripts/gdpr-delete.mjs` |
| "what is our product development process" | `docs/rfc/RFC-001-workspace-billing-v2.md` |
| "how do we write and run tests" | `packages/web/src/app/dashboard/workspace/[slug]/members.test.ts` |
