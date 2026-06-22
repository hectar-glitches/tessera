// Mock data layer for OrgCache. Lets the dashboard render fully offline (VITE_USE_MOCK=1
// or whenever a live request fails). Shapes mirror devin/api-contract.md.

const now = Date.now() / 1000;
const day = 86400;

const ENTRIES = [
  { hash: "m1", question: "how do I run the dev server", answer: "npm run dev", role: "engineer", seniority: "junior", tenure: "onboarding", min_seniority_level: 1, hit_count: 42, created_at: now - 3 * day, last_asked_at: now - 0.2 * day },
  { hash: "m2", question: "how do I run database migrations", answer: "npm run db:migrate (prisma migrate dev locally).", role: "engineer", seniority: "junior", tenure: "onboarding", min_seniority_level: 1, hit_count: 28, created_at: now - 5 * day, last_asked_at: now - 1 * day },
  { hash: "m3", question: "how do I set up my local env file", answer: "Copy .env.example to .env.local and fill values from 1Password.", role: "engineer", seniority: "junior", tenure: "onboarding", min_seniority_level: 1, hit_count: 19, created_at: now - 40 * day, last_asked_at: now - 2 * day },
  { hash: "m4", question: "how do we handle authentication", answer: "NextAuth with JWT sessions; middleware.ts guards routes.", role: "engineer", seniority: "mid", tenure: "experienced", min_seniority_level: 2, hit_count: 15, created_at: now - 10 * day, last_asked_at: now - 1 * day },
  { hash: "m5", question: "what is our caching strategy", answer: "RSC + Next.js fetch cache; Redis for shared server-side caching.", role: "engineer", seniority: "mid", tenure: "experienced", min_seniority_level: 2, hit_count: 11, created_at: now - 12 * day, last_asked_at: now - 3 * day },
  { hash: "m6", question: "what is our service architecture", answer: "Next.js monolith on ECS Fargate behind ALB, async workers, RDS Postgres.", role: "engineer", seniority: "senior", tenure: "experienced", min_seniority_level: 3, hit_count: 8, created_at: now - 20 * day, last_asked_at: now - 4 * day },
  { hash: "m7", question: "what is our observability stack", answer: "OpenTelemetry -> Tempo, metrics -> Prometheus, logs -> Loki.", role: "devops", seniority: "senior", tenure: "experienced", min_seniority_level: 3, hit_count: 6, created_at: now - 45 * day, last_asked_at: now - 6 * day },
  { hash: "m8", question: "what is our multi-region failover strategy", answer: "Active-passive: RDS cross-region replica promotion, Route53 failover, RPO ~5m.", role: "engineer", seniority: "staff", tenure: "experienced", min_seniority_level: 4, hit_count: 4, created_at: now - 25 * day, last_asked_at: now - 7 * day },
  { hash: "m9", question: "what is our north-star technical strategy", answer: "Consolidate on the typed TS stack; optimize mean-time-to-ship.", role: "engineer", seniority: "principal", tenure: "experienced", min_seniority_level: 5, hit_count: 2, created_at: now - 60 * day, last_asked_at: now - 10 * day },
];

const SENIORITY_LEVEL = { junior: 1, mid: 2, senior: 3, staff: 4, principal: 5 };

function filtered(filters = {}) {
  const lvl = filters.seniority ? SENIORITY_LEVEL[filters.seniority] : 5;
  return ENTRIES.filter((e) => {
    if (filters.role && e.role !== filters.role) return false;
    if (filters.tenure && e.tenure !== filters.tenure) return false;
    return e.min_seniority_level <= lvl;
  });
}

const STATS = {
  org: "acmecorp", budget: 50, spend_usd: 0.182, saved_usd: 1.946,
  budget_used_pct: 0.36, tokens_saved: 129_700, tokens_spent: 12_100,
  hits: 135, misses: 22, suggests: 9, total_requests: 166, hit_rate_pct: 81.3,
  cache_size: ENTRIES.length,
};

const ACTIVITY = [
  { decision: "hit", question: "how do I run the dev server", similarity: 0.94, tokens_saved: 250, dollars_saved: 0.00375, note: "engineer/junior" },
  { decision: "hit", question: "how do we handle authentication", similarity: 0.88, tokens_saved: 260, dollars_saved: 0.0039, note: "engineer/mid" },
  { decision: "miss", question: "how do I configure feature flags for canary", similarity: 0.41, tokens_saved: 0, dollars_saved: 0, note: "generated via stub" },
  { decision: "suggest", question: "how do I run the prod server", similarity: 0.79, tokens_saved: 0, dollars_saved: 0, note: "surfaced close matches" },
];

export function mockApi(org, key, ...args) {
  switch (key) {
    case "health":
      return { status: "ok", store_backend: "mock", embedding_backend: "mock", llm_available: false };
    case "info":
      return { org, chunks: 12, cache_size: ENTRIES.length, budget: 50 };
    case "ingestSeed":
      return { org, entries: ENTRIES.length, backend: "mock" };
    case "stats":
      return STATS;
    case "activity":
      return { events: ACTIVITY };
    case "trending": {
      const f = args[0] || {};
      const items = filtered(f)
        .slice()
        .sort((a, b) => b.hit_count - a.hit_count)
        .slice(0, f.limit || 10)
        .map((e) => ({ hash: e.hash, question: e.question, answer: e.answer, count: e.hit_count, timestamp: e.last_asked_at, role: e.role, seniority: e.seniority }));
      return { segment: { role: f.role, seniority: f.seniority, tenure: f.tenure }, items };
    }
    case "entries":
      return { entries: filtered(args[0] || {}) };
    case "updateEntry": {
      const [hash, patch] = args;
      const e = ENTRIES.find((x) => x.hash === hash);
      if (e) Object.assign(e, patch);
      return e || { error: "not found" };
    }
    case "deleteEntry": {
      const [hash] = args;
      const i = ENTRIES.findIndex((x) => x.hash === hash);
      if (i >= 0) ENTRIES.splice(i, 1);
      return { deleted: i >= 0, hash };
    }
    case "query": {
      const [question] = args;
      const match = ENTRIES.find((e) => e.question === question);
      return match
        ? { decision: "hit", cached: true, answer: match.answer, similarity: 0.95, matched_question: match.question, tokens_saved: 250, dollars_saved: 0.00375, role: match.role, seniority: match.seniority, min_seniority_level: match.min_seniority_level }
        : { decision: "miss", cached: false, answer: "(mock) generated answer", similarity: 0.3, matched_question: null };
    }
    case "confidenceCheck":
      return { embedding_backend: "mock", threshold: 0.55, total_pairs: 0, baseline_accuracy: 0.3, hybrid_accuracy: 0.75, results: [], by_bucket: {} };
    case "setBudget":
      return { org, budget: args[0] };
    case "reset":
      return { org, status: "reset" };
    case "guide":
      return { document: "# AcmeCorp Guide (mock)\n" };
    case "redisInternals":
      return {
        backend: "redis",
        server: { redis_version: "7.4.0", used_memory_human: "3.2M", uptime_days: 1 },
        modules: ["ReJSON", "search"],
        index: { name: "tessera:idx:v3", num_docs: 21, vector_dim: 384, distance_metric: "COSINE", algorithm: "HNSW" },
        keys: { chunks: 12, cache_entries: ENTRIES.length, reverse_index_sets: 12 },
        reverse_index_sample: { chunk_id: "guide#sec-saturday-meals", cache_entries_pointing_here: 3 },
        sample_ttls: [
          { hash: "m9", level: "exec", ttl_seconds: 900 },
          { hash: "m8", level: "manager", ttl_seconds: 3600 },
          { hash: "m4", level: "employee", ttl_seconds: 86400 },
          { hash: "m1", level: "public", ttl_seconds: 604800 },
        ],
        ttl_tiers: { public: 604800, employee: 86400, manager: 3600, exec: 900 },
      };
    default:
      return {};
  }
}

export const MOCK_ENTRIES = ENTRIES;
