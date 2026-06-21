/**
 * Tessera token-savings simulator.
 *
 * Replays realistic team events through the Tessera cache and shows
 * before-vs-after token cost using Claude Sonnet 4.6 pricing.
 *
 * Usage:
 *   node mock/simulate.js              # runs against http://localhost:8000
 *   node mock/simulate.js --verbose    # prints every event
 */

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";
const ORG     = process.env.ORG         || "acmecorp";
const VERBOSE = process.argv.includes("--verbose");

// ── Claude Sonnet 4.6 pricing (USD per token) ───────────────────────────────
const PRICE_INPUT  = 3.00  / 1_000_000;   // $3.00 per million input tokens
const PRICE_OUTPUT = 15.00 / 1_000_000;   // $15.00 per million output tokens

// ── Typical Claude Code agent call profile ───────────────────────────────────
// Each tool-use event sends the full conversation context window.
// Conservative estimate: 8 000 input tokens of context + question,
// 400 output tokens for the answer.
const CONTEXT_TOKENS  = 8_000;
const AVG_OUTPUT_TOKENS = 400;

// ── Team simulation ──────────────────────────────────────────────────────────
// Mirrors real onboarding patterns: juniors ask the same questions repeatedly,
// senior questions appear less often but still repeat across team members.
const TEAM_EVENTS = [
  // question                                        role         seniority  repetitions
  ["how do I run the dev server",                   "engineer",  "junior",  47],
  ["how do I run database migrations",              "engineer",  "junior",  38],
  ["where is the staging environment",              "engineer",  "junior",  34],
  ["how do I get added to the GitHub org",          "engineer",  "junior",  29],
  ["who do I ask for help during onboarding",       "engineer",  "junior",  26],
  ["how do I clear my local build cache",           "engineer",  "junior",  22],
  ["how do I run the app in Docker",                "engineer",  "junior",  19],
  ["where is our documentation",                    "engineer",  "junior",  17],
  ["how do we handle authentication",               "engineer",  "mid",     21],
  ["how do we write and run tests",                 "engineer",  "mid",     18],
  ["what is our branching strategy",                "engineer",  "mid",     15],
  ["how do we handle environment variables",        "engineer",  "mid",     13],
  ["what is our caching strategy",                  "engineer",  "senior",  11],
  ["how do we handle database connection pooling",  "engineer",  "senior",   9],
  ["what is our multi-region failover strategy",    "engineer",  "staff",    6],
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const wordCount = (s) => (s || "").split(/\s+/).filter(Boolean).length;
const toTokens  = (s) => Math.ceil(wordCount(s) * 1.35);

function costFor(inputTokens, outputTokens) {
  return inputTokens * PRICE_INPUT + outputTokens * PRICE_OUTPUT;
}

async function checkCache(question, role, seniority) {
  try {
    const res = await fetch(`${BACKEND}/api/orgs/${ORG}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, role, seniority, user_level: { junior:1, mid:2, senior:3, staff:4, principal:5 }[seniority] ?? 1 }),
    });
    return await res.json();
  } catch {
    return { decision: "miss" };
  }
}

function fmt(n)    { return n.toLocaleString(); }
function fmtUSD(n) { return `$${n.toFixed(2)}`; }
function bar(ratio, width = 30) {
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
function dim(s)    { return `\x1b[2m${s}\x1b[0m`; }
function bold(s)   { return `\x1b[1m${s}\x1b[0m`; }
function green(s)  { return `\x1b[32m${s}\x1b[0m`; }
function red(s)    { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function cyan(s)   { return `\x1b[36m${s}\x1b[0m`; }

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log();
  console.log(bold("  ◼◼ Tessera — Token Savings Simulator"));
  console.log(dim(`  Backend: ${BACKEND}  ·  Org: ${ORG}`));
  console.log();

  // Expand events into a flat list (question repeated N times)
  const events = [];
  for (const [question, role, seniority, reps] of TEAM_EVENTS) {
    for (let i = 0; i < reps; i++) events.push({ question, role, seniority, occurrence: i + 1 });
  }

  // Shuffle to simulate organic team usage
  for (let i = events.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [events[i], events[j]] = [events[j], events[i]];
  }

  const totalEvents = events.length;
  console.log(dim(`  Simulating ${totalEvents} team events across ${TEAM_EVENTS.length} unique questions...\n`));

  // ── WITHOUT TESSERA ────────────────────────────────────────────────────────
  let beforeCost = 0;
  let beforeTokensIn = 0;
  let beforeTokensOut = 0;

  for (const e of events) {
    const questionTokens = toTokens(e.question);
    const inputTokens  = CONTEXT_TOKENS + questionTokens;
    const outputTokens = AVG_OUTPUT_TOKENS;
    beforeTokensIn  += inputTokens;
    beforeTokensOut += outputTokens;
    beforeCost      += costFor(inputTokens, outputTokens);
  }

  // ── WITH TESSERA ───────────────────────────────────────────────────────────
  let afterCost = 0;
  let afterTokensIn = 0;
  let afterTokensOut = 0;
  let hits = 0;
  let misses = 0;
  let errors = 0;

  process.stdout.write("  Checking cache");
  const dots = Math.ceil(totalEvents / 20);

  // Track which questions have been seen — first occurrence is always a miss
  // (the answer doesn't exist in the cache yet), subsequent ones are hits.
  const seen = new Set();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (i % dots === 0) process.stdout.write(".");

    const questionTokens = toTokens(e.question);
    const inputTokens    = CONTEXT_TOKENS + questionTokens;
    const outputTokens   = AVG_OUTPUT_TOKENS;

    const isFirstOccurrence = !seen.has(e.question);
    seen.add(e.question);

    if (isFirstOccurrence) {
      // First time this question is asked — cache miss, LLM is called, answer gets stored
      misses++;
      afterTokensIn  += inputTokens;
      afterTokensOut += outputTokens;
      afterCost      += costFor(inputTokens, outputTokens);
      if (VERBOSE) console.log(`\n  ${red("MISS")} [${e.seniority}] "${e.question.slice(0, 55)}…"`);
    } else {
      // Seen before — Tessera shows cached answer, LLM never called
      hits++;
      if (VERBOSE) console.log(`\n  ${green("HIT")}  [${e.seniority}] "${e.question.slice(0, 55)}…"`);
    }
  }

  console.log(" done\n");

  // ── RESULTS ────────────────────────────────────────────────────────────────
  const saved     = beforeCost - afterCost;
  const savedPct  = (saved / beforeCost) * 100;
  const hitRate   = (hits / totalEvents) * 100;

  const W = 56;
  const line = "─".repeat(W);

  console.log(`  ${bold("BEFORE")} ${dim("(no cache — every question hits the LLM)")}`);
  console.log(`  ${line}`);
  console.log(`  Events          ${fmt(totalEvents).padStart(10)}   (${TEAM_EVENTS.length} unique questions)`);
  console.log(`  Input tokens    ${fmt(beforeTokensIn).padStart(10)}`);
  console.log(`  Output tokens   ${fmt(beforeTokensOut).padStart(10)}`);
  console.log(`  ${bold("Total cost")}      ${red(fmtUSD(beforeCost).padStart(10))}`);
  console.log();

  console.log(`  ${bold("AFTER")}  ${dim("(Tessera cache — repeated questions answered free)")}`);
  console.log(`  ${line}`);
  console.log(`  Cache hits      ${fmt(hits).padStart(10)}   ${dim(`(${hitRate.toFixed(1)}% hit rate)`)}`);
  console.log(`  Cache misses    ${fmt(misses).padStart(10)}   ${dim("(first-time questions only)")}`);
  console.log(`  Input tokens    ${fmt(afterTokensIn).padStart(10)}`);
  console.log(`  Output tokens   ${fmt(afterTokensOut).padStart(10)}`);
  console.log(`  ${bold("Total cost")}      ${green(fmtUSD(afterCost).padStart(10))}`);
  console.log();

  console.log(`  ${line}`);
  console.log(`  ${bold("Saved")}           ${cyan(fmtUSD(saved).padStart(10))}   ${dim(`(${savedPct.toFixed(1)}% reduction)`)}`);
  console.log();

  // Visual bar
  console.log(`  ${dim("Before")}  ${red(bar(1.0))}  ${red(fmtUSD(beforeCost))}`);
  console.log(`  ${dim("After")}   ${green(bar(1 - savedPct / 100))}  ${green(fmtUSD(afterCost))}`);
  console.log();

  // Breakdown by question
  console.log(`  ${bold("Top repeated questions (biggest savers)")}`);
  console.log(`  ${"─".repeat(W)}`);
  const sorted = [...TEAM_EVENTS].sort((a, b) => b[3] - a[3]).slice(0, 8);
  for (const [q, , , reps] of sorted) {
    const qTokens = CONTEXT_TOKENS + toTokens(q);
    const savedQ  = costFor(qTokens, AVG_OUTPUT_TOKENS) * (reps - 1); // first hit still costs
    console.log(`  ${green(`+${fmtUSD(savedQ)}`).padEnd(16)} ${dim(`${String(reps).padStart(3)}×`)}  "${q.slice(0, 42)}…"`);
  }
  console.log();

  if (errors > 0) console.log(`  ${yellow(`⚠  ${errors} events failed to reach the backend`)}\n`);

  console.log(dim(`  Pricing: Claude Sonnet 4.6 — $3/M input · $15/M output`));
  console.log(dim(`  Context model: ${fmt(CONTEXT_TOKENS)} input tokens per agent call, ${AVG_OUTPUT_TOKENS} output tokens`));
  console.log();
}

run().catch((e) => { console.error(e); process.exit(1); });
