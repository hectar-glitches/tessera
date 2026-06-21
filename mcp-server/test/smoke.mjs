// Smoke test: boot the mock backend, point the MCP lib at it, and verify the three
// tools return correct results. Run with `npm test` (node test/smoke.mjs).
import assert from "node:assert";
import { createMockBackend } from "../mock-backend.js";

const PORT = 8799;
process.env.ORGCACHE_URL = `http://localhost:${PORT}`;
process.env.ORGCACHE_ORG = "acmecorp";

// Import AFTER setting env so lib picks up ORGCACHE_URL.
const { checkCache, storeAnswer, getTrending } = await import("../lib.js");

const server = createMockBackend();
await new Promise((r) => server.listen(PORT, r));

try {
  // 1. check_cache for a seeded junior question -> hit with the right answer.
  const hit = await checkCache({
    question: "how do I run the dev server",
    role: "engineer", seniority: "junior", tenure: "onboarding",
  });
  assert.equal(hit.hit, true, "expected a cache hit");
  assert.equal(hit.answer, "npm run dev", "expected npm run dev");
  console.log("check_cache hit:", JSON.stringify(hit));

  // 2. Hierarchy: a junior must NOT get the staff-only failover answer.
  const blocked = await checkCache({
    question: "what is our multi-region failover strategy",
    role: "engineer", seniority: "junior",
  });
  assert.equal(blocked.hit, false, "junior must not see staff-only answer");
  console.log("check_cache hierarchy-blocked:", JSON.stringify(blocked));

  // 3. get_trending for the junior segment -> only junior-visible items.
  const trending = await getTrending({ role: "engineer", seniority: "junior" });
  assert.ok(trending.items.length > 0, "expected trending items");
  assert.ok(trending.items.every((i) => i.seniority === "junior"),
    "junior trending must not include higher-seniority items");
  console.log("get_trending items:", trending.items.length);

  // 4. store_answer round-trips through the mock store endpoint.
  const stored = await storeAnswer({
    question: "how do I rotate my db password",
    answer: "Use the rotate-secret runbook.",
    role: "devops", seniority: "mid",
  });
  assert.equal(stored.stored, true, "expected store to succeed");
  console.log("store_answer:", JSON.stringify(stored));

  console.log("\nMCP smoke test PASSED");
} finally {
  server.close();
}
