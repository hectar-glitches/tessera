"""
Tessera — AFTER simulation.
Same 325 events — Tessera cache intercepts repeats. Only 25 first-time questions hit Claude.
Traces sent to Arize cloud when ARIZE_SPACE_ID + ARIZE_API_KEY are set.
"""
import os, time, json, requests, anthropic
from arize.otel import register
from openinference.instrumentation.anthropic import AnthropicInstrumentor

KEY            = os.environ.get("ANTHROPIC_API_KEY", "")

# ── Arize cloud tracing ───────────────────────────────────────────────────────
ARIZE_SPACE_ID = os.environ.get("ARIZE_SPACE_ID", "")
ARIZE_API_KEY  = os.environ.get("ARIZE_API_KEY", "")

if ARIZE_SPACE_ID and ARIZE_API_KEY:
    tp = register(
        space_id=ARIZE_SPACE_ID,
        api_key=ARIZE_API_KEY,
        project_name="tessera-AFTER",
    )
    AnthropicInstrumentor().instrument(tracer_provider=tp)
    print("  📡 Arize tracing active → project: tessera-AFTER\n")
else:
    print("  ⚠  No Arize keys — set ARIZE_SPACE_ID + ARIZE_API_KEY to enable tracing\n")
BACKEND        = os.environ.get("TESSERA_BACKEND", "http://localhost:8000")
ORG            = os.environ.get("TESSERA_ORG", "acmecorp")
LEVEL          = {"junior":1,"mid":2,"senior":3,"staff":4,"principal":5}

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

def bold(s):   return f"\033[1m{s}\033[0m"
def green(s):  return f"\033[32m{s}\033[0m"
def cyan(s):   return f"\033[36m{s}\033[0m"
def red(s):    return f"\033[31m{s}\033[0m"
def dim(s):    return f"\033[2m{s}\033[0m"
def bar(r,w=32): return green("█"*round(r*w)) + dim("░"*(w-round(r*w)))

def check(q, role, seniority):
    try:
        r = requests.post(f"{BACKEND}/api/orgs/{ORG}/check",
            json={"question":q,"role":role,"seniority":seniority,"user_level":LEVEL.get(seniority,1)},
            timeout=2)
        return r.json().get("decision") == "hit"
    except: return False

def run():
    total = sum(r for *_,r in EVENTS)
    print(f"\n  {bold('◼◼ TESSERA  —  AFTER  (with cache)')}")
    print(f"  {dim(f'{total} events · {len(EVENTS)} unique questions · repeats served from cache')}\n")
    print(f"  {'─'*60}")

    inp_total = out_total = cost_total = hits = misses = n = 0
    seen = set()

    for q, role, seniority, reps in EVENTS:
        for i in range(reps):
            n += 1
            first = q not in seen
            seen.add(q)

            if not first:
                hits += 1
                print(f"  [{n:3d}/{total}] {green('✓ HIT')}  {dim(f'[{seniority:7s}]')}  {q[:50]}", flush=True)
                continue

            misses += 1
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
                print(f"  [{n:3d}/{total}] {red('✗ LLM')}  {dim(f'[{seniority:7s}]')}  {q[:50]}  {dim('(first seen → cached)')}", flush=True)
                time.sleep(0.05)
            except Exception as e:
                print(f"  [{n:3d}] ERROR: {e}"); time.sleep(2)

    # Load before results
    before = None
    try:
        with open("/tmp/tessera_before.json") as f: before = json.load(f)
    except: pass

    hit_rate = hits / total * 100

    print(f"\n  {'─'*60}")
    if before:
        saved     = before["cost"] - cost_total
        saved_pct = saved / before["cost"] * 100
        print(f"  {bold('BEFORE vs AFTER — TESSERA IMPACT')}")
        print(f"  {'─'*60}")
        print(f"  {'':26}  {'BEFORE':>10}  {'AFTER':>10}  {'DELTA':>10}")
        print(f"  {'─'*60}")
        llm_delta  = before['events'] - misses
        inp_delta  = before['inp'] - inp_total
        out_delta  = before['out'] - out_total
        print(f"  LLM calls          {before['events']:>10,}  {misses:>10,}  {green(f'-{llm_delta:,}'):>19}")
        print(f"  Cache hits         {'—':>10}  {hits:>10,}  {green(f'+{hits:,}  ({hit_rate:.0f}%)'):>19}")
        print(f"  Input tokens       {before['inp']:>10,}  {inp_total:>10,}  {green(f'-{inp_delta:,}'):>19}")
        print(f"  Output tokens      {before['out']:>10,}  {out_total:>10,}  {green(f'-{out_delta:,}'):>19}")
        bc = before['cost']
        print(f"  {bold('Cost')}               {red(f'${bc:.4f}'):>17}  {green(f'${cost_total:.4f}'):>10}")
        print(f"  {'─'*60}")
        print(f"  {bold('Saved')}              {cyan(f'${saved:.4f}  ({saved_pct:.1f}% reduction)'):>10}")
        before_cost_fmt = f"${bc:.4f}"
        after_cost_fmt  = f"${cost_total:.4f}"
        print(f"\n  {dim('Before')}  {bar(1.0)}  {red(before_cost_fmt)}")
        print(f"  {dim('After')}   {bar(1-saved_pct/100)}  {green(after_cost_fmt)}")
    else:
        print(f"  {bold('RESULT — WITH TESSERA')}")
        print(f"  LLM calls     {misses:>8,}  {dim('(first-time only)')}")
        print(f"  Cache hits    {hits:>8,}  {dim(f'({hit_rate:.1f}%)')}")
        print(f"  Input tokens  {inp_total:>8,}")
        print(f"  Output tokens {out_total:>8,}")
        print(f"  {bold('Cost')}          {green(f'${cost_total:.4f}')}")

    print(f"\n  {dim('Tip: run before.py first to see the full comparison')}\n")

if __name__ == "__main__": run()
