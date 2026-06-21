"""
Tessera — BEFORE simulation.
325 team events, every one hits Claude. No cache.
Traces sent to Arize cloud when ARIZE_SPACE_ID + ARIZE_API_KEY are set.
"""
import os, time, json, anthropic
from arize.otel import register
from openinference.instrumentation.anthropic import AnthropicInstrumentor

KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# ── Arize cloud tracing (optional) ───────────────────────────────────────────
ARIZE_SPACE_ID = os.environ.get("ARIZE_SPACE_ID", "")
ARIZE_API_KEY  = os.environ.get("ARIZE_API_KEY", "")

if ARIZE_SPACE_ID and ARIZE_API_KEY:
    tp = register(
        space_id=ARIZE_SPACE_ID,
        api_key=ARIZE_API_KEY,
        project_name="tessera-BEFORE",
    )
    AnthropicInstrumentor().instrument(tracer_provider=tp)
    print("  📡 Arize tracing active → project: tessera-BEFORE\n")
else:
    print("  ⚠  No Arize keys — set ARIZE_SPACE_ID + ARIZE_API_KEY to enable tracing\n")

client = anthropic.Anthropic(api_key=KEY)

SYSTEM = """You are a helpful engineering assistant embedded in the IDE of an engineer at a SaaS startup.
The team uses: Next.js, pnpm/Turborepo, Drizzle ORM + PostgreSQL (Neon), PgBouncer, Clerk auth,
LaunchDarkly feature flags, Trigger.dev background jobs, Redis, AWS (ECS/RDS Aurora/CloudFront/Route53),
Terraform + Atlantis, Datadog, PagerDuty, Linear, Notion, Slack, Vitest, Playwright.
Answer concisely with actionable specifics — not generic advice."""

EVENTS = [
    ("how do I run the dev server",                          "engineer", "junior",  47),
    ("how do I run database migrations",                     "engineer", "junior",  38),
    ("where is the staging environment",                     "engineer", "junior",  34),
    ("how do I get access to AWS",                           "engineer", "junior",  31),
    ("who do I ask for help during onboarding",              "engineer", "junior",  26),
    ("how do I clear my local build cache",                  "engineer", "junior",  22),
    ("how do I run the app locally with Docker",             "engineer", "junior",  19),
    ("where is our internal documentation",                  "engineer", "junior",  18),
    ("how do I set up my local environment variables",       "engineer", "junior",  16),
    ("how does our authentication work",                     "engineer", "mid",     21),
    ("how do we write and run tests",                        "engineer", "mid",     18),
    ("what is our branching and PR strategy",                "engineer", "mid",     15),
    ("how do we handle feature flags",                       "engineer", "mid",     13),
    ("how do I deploy a hotfix to production",               "engineer", "mid",     11),
    ("how do background jobs work",                          "engineer", "mid",      9),
    ("what is our caching strategy",                         "engineer", "senior",  11),
    ("how do we handle database connection pooling",         "engineer", "senior",   9),
    ("how do we approach API versioning",                    "engineer", "senior",   8),
    ("what is our incident response process",                "engineer", "staff",    7),
    ("what is our multi-region strategy",                    "engineer", "staff",    6),
    ("how do we handle data privacy and GDPR",               "engineer", "staff",    5),
    ("how do I add a new environment variable to production","devops",   "mid",     14),
    ("how do I check production logs",                       "devops",   "mid",     12),
    ("what is our product development process",              "pm",       "mid",     10),
    ("where do I find user research and customer insights",  "pm",       "junior",   8),
]

def bold(s):  return f"\033[1m{s}\033[0m"
def red(s):   return f"\033[31m{s}\033[0m"
def dim(s):   return f"\033[2m{s}\033[0m"

def run():
    total = sum(r for *_, r in EVENTS)
    print(f"\n  {bold('◼◼ TESSERA  —  BEFORE  (no cache)')}")
    print(f"  {dim(f'{total} events · {len(EVENTS)} unique questions · every event hits Claude')}\n")
    print(f"  {'─'*60}")

    inp_total = out_total = cost_total = n = 0
    results = []

    for q, role, seniority, reps in EVENTS:
        for i in range(reps):
            n += 1
            try:
                r = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=400,
                    system=SYSTEM,
                    messages=[{"role":"user","content":f"[{role}/{seniority}] {q}"}],
                )
                inp = r.usage.input_tokens
                out = r.usage.output_tokens
                cost = (inp * 0.80 + out * 4.00) / 1_000_000
                inp_total += inp; out_total += out; cost_total += cost
                tag = red("✗ LLM")
                print(f"  [{n:3d}/{total}] {tag}  {dim(f'[{seniority:7s}]')}  {q[:50]}", flush=True)
                time.sleep(0.05)
            except Exception as e:
                print(f"  [{n:3d}] ERROR: {e}"); time.sleep(2)

        results.append((q, role, seniority, reps))

    print(f"\n  {'─'*60}")
    print(f"  {bold('RESULT — WITHOUT TESSERA')}")
    print(f"  {'─'*60}")
    print(f"  LLM calls       {total:>8,}")
    print(f"  Input tokens    {inp_total:>8,}")
    print(f"  Output tokens   {out_total:>8,}")
    print(f"  {bold('Total cost')}      {red(f'${cost_total:>7.4f}')}")
    print(f"  {'─'*60}\n")

    with open("/tmp/tessera_before.json","w") as f:
        json.dump({"events":total,"inp":inp_total,"out":out_total,"cost":cost_total},f)

    print(f"  {dim('Saved to /tmp/tessera_before.json — run after.py next')}\n")

if __name__ == "__main__": run()
