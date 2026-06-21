import { z } from "zod";

// All env vars validated at boot. A missing required var crashes fast with a
// clear error rather than surfacing as a runtime null-dereference.

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_URL_DIRECT: z.string().url(),

  // Auth
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),

  // AI
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),

  // Feature flags
  LAUNCHDARKLY_SDK_KEY: z.string().min(1),

  // Background jobs
  TRIGGER_API_KEY: z.string().startsWith("tr_"),
  TRIGGER_API_URL: z.string().url().default("https://api.trigger.dev"),

  // Caching
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Observability (optional — no-op without them)
  DATADOG_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),

  // Webhooks
  SVIX_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),

  // Service-to-service
  SERVICE_API_KEY_HASH: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);
