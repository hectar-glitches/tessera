// Tiny mock of the OrgCache HTTP API so the MCP server works without the real backend.
// Implements /check, /trending, and /store with canned AcmeCorp data.
import http from "node:http";

const ENTRIES = [
  { hash: "m1", question: "how do I run the dev server", answer: "npm run dev", role: "engineer", seniority: "junior", tenure: "onboarding", min_seniority_level: 1, hit_count: 42, last_asked_at: Date.now() / 1000 },
  { hash: "m4", question: "how do we handle authentication", answer: "NextAuth with JWT sessions; middleware.ts guards routes.", role: "engineer", seniority: "mid", tenure: "experienced", min_seniority_level: 2, hit_count: 15, last_asked_at: Date.now() / 1000 },
  { hash: "m8", question: "what is our multi-region failover strategy", answer: "Active-passive: RDS cross-region replica promotion, Route53 failover, RPO ~5m.", role: "engineer", seniority: "staff", tenure: "experienced", min_seniority_level: 4, hit_count: 4, last_asked_at: Date.now() / 1000 },
];
const LEVEL = { junior: 1, mid: 2, senior: 3, staff: 4, principal: 5 };

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
  });
}

export function createMockBackend() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "POST" && url.pathname.endsWith("/check")) {
      const body = await readBody(req);
      const lvl = body.user_level ?? LEVEL[body.seniority] ?? 5;
      const match = ENTRIES.find(
        (e) => e.question === body.question && e.min_seniority_level <= lvl &&
          (!body.role || e.role === body.role),
      );
      return send(200, match
        ? { decision: "hit", cached: true, answer: match.answer, similarity: 0.95, matched_question: match.question, role: match.role, seniority: match.seniority, min_seniority_level: match.min_seniority_level }
        : { decision: "miss", cached: false, answer: null, similarity: 0.2, matched_question: null });
    }

    if (req.method === "POST" && url.pathname.endsWith("/store")) {
      const body = await readBody(req);
      const hash = "mock-" + Math.random().toString(36).slice(2, 8);
      ENTRIES.push({ hash, ...body, min_seniority_level: LEVEL[body.seniority] || 1, hit_count: 0, last_asked_at: Date.now() / 1000 });
      return send(200, { stored: true, hash });
    }

    if (req.method === "GET" && url.pathname.endsWith("/trending")) {
      const role = url.searchParams.get("role");
      const seniority = url.searchParams.get("seniority");
      const lvl = seniority ? LEVEL[seniority] : 5;
      const items = ENTRIES.filter((e) => e.min_seniority_level <= lvl && (!role || e.role === role))
        .sort((a, b) => b.hit_count - a.hit_count)
        .slice(0, 10)
        .map((e) => ({ hash: e.hash, question: e.question, answer: e.answer, count: e.hit_count, timestamp: e.last_asked_at, role: e.role, seniority: e.seniority }));
      return send(200, { segment: { role, seniority }, items });
    }

    send(404, { error: "not found" });
  });
}

// Allow running standalone: `node mock-backend.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 8000;
  createMockBackend().listen(port, () => {
    console.error(`[orgcache-mock] listening on http://localhost:${port}`);
  });
}
