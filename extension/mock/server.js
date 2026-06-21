// Minimal mock of the OrgCache backend so the extension works end-to-end without the
// real server. Implements /api/orgs/:org/check and /trending with canned AcmeCorp data.
// Run: node mock/server.js   (listens on :8000, override with PORT)
const http = require("node:http");

const ENTRIES = [
  { hash: "m1", question: "how do I run the dev server", answer: "npm run dev", role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 12 },
  { hash: "m2", question: "how do I run database migrations", answer: "npm run db:migrate", role: "engineer", seniority: "junior", min_seniority_level: 1, hit_count: 7 },
  { hash: "m4", question: "how do we handle authentication", answer: "NextAuth with JWT sessions; middleware.ts guards routes.", role: "engineer", seniority: "mid", min_seniority_level: 2, hit_count: 5 },
  { hash: "m8", question: "what is our multi-region failover strategy", answer: "Active-passive RDS promotion, Route53 failover, RPO ~5m.", role: "engineer", seniority: "staff", min_seniority_level: 4, hit_count: 3 },
];
const LEVEL = { junior: 1, mid: 2, senior: 3, staff: 4, principal: 5 };

const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : {}));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(obj));
  };

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
    const items = ENTRIES.filter((e) => e.min_seniority_level <= lvl && (!role || e.role === role))
      .sort((a, b) => b.hit_count - a.hit_count)
      .map((e) => ({ hash: e.hash, question: e.question, answer: e.answer, count: e.hit_count, role: e.role, seniority: e.seniority }));
    return send(200, { segment: { role, seniority }, items });
  }

  send(404, { error: "not found" });
});

const port = process.env.PORT || 8000;
server.listen(port, () => console.log(`[orgcache-mock] http://localhost:${port}`));
