"""
Tessera — BEFORE simulation.

Every team event hits Claude directly. No cache. Shows baseline token
consumption and cost in Arize Phoenix.

Usage:
  pip install -r requirements.txt
  python mock/before.py
"""

import os
import time
import anthropic
import phoenix as px
from openinference.instrumentation.anthropic import AnthropicInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

# ── Arize Phoenix setup ──────────────────────────────────────────────────────
session = px.launch_app()
print(f"\n  📊 Arize Phoenix: {session.url}\n")

provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:6006/v1/traces"))
)
trace.set_tracer_provider(provider)
AnthropicInstrumentor().instrument(tracer_provider=provider)

# ── Client ───────────────────────────────────────────────────────────────────
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# ── System prompt — simulates real Claude Code context overhead ───────────────
SYSTEM_PROMPT = """You are a helpful engineering assistant embedded in the IDE of an engineer at a SaaS company called Tessera.

The engineer is working in a TypeScript/Next.js codebase. The team uses:
- pnpm as package manager, Turborepo for monorepo
- Drizzle ORM with PostgreSQL (via Neon), PgBouncer for pooling
- Clerk for authentication, LaunchDarkly for feature flags
- Trigger.dev for background jobs, Redis for caching
- AWS (ECS, RDS Aurora, CloudFront, Route53), Terraform via Atlantis
- Datadog for observability, PagerDuty for on-call
- Linear for tickets, Notion for documentation, Slack for communication
- Vitest for unit tests, Playwright for E2E

Answer questions concisely and accurately based on this engineering context.
Always provide actionable, specific answers — not generic advice."""

# ── Team events ──────────────────────────────────────────────────────────────
# (question, role, seniority, repetitions)
TEAM_EVENTS = [
    ("how do I run the dev server",                     "engineer",  "junior",   47),
    ("how do I run database migrations",                "engineer",  "junior",   38),
    ("where is the staging environment",                "engineer",  "junior",   34),
    ("how do I get access to AWS",                      "engineer",  "junior",   31),
    ("who do I ask for help during onboarding",         "engineer",  "junior",   26),
    ("how do I clear my local build cache",             "engineer",  "junior",   22),
    ("how do I run the app locally with Docker",        "engineer",  "junior",   19),
    ("where is our internal documentation",             "engineer",  "junior",   18),
    ("how do I set up my local environment variables",  "engineer",  "junior",   16),
    ("how does our authentication work",                "engineer",  "mid",      21),
    ("how do we write and run tests",                   "engineer",  "mid",      18),
    ("what is our branching and PR strategy",           "engineer",  "mid",      15),
    ("how do we handle feature flags",                  "engineer",  "mid",      13),
    ("how do I deploy a hotfix to production",          "engineer",  "mid",      11),
    ("how do background jobs work",                     "engineer",  "mid",       9),
    ("what is our caching strategy",                    "engineer",  "senior",   11),
    ("how do we handle database connection pooling",    "engineer",  "senior",    9),
    ("how do we approach API versioning",               "engineer",  "senior",    8),
    ("what is our incident response process",           "engineer",  "staff",     7),
    ("what is our multi-region strategy",               "engineer",  "staff",     6),
    ("how do we handle data privacy and GDPR",          "engineer",  "staff",     5),
    ("how do I add a new environment variable to production", "devops", "mid",   14),
    ("how do I check production logs",                  "devops",    "mid",      12),
    ("what is our product development process",         "pm",        "mid",      10),
    ("where do I find user research and customer insights", "pm",    "junior",    8),
]

def run_before():
    total_events = sum(reps for _, _, _, reps in TEAM_EVENTS)
    unique_questions = len(TEAM_EVENTS)

    print(f"  ◼◼ TESSERA — BEFORE (no cache)\n")
    print(f"  {total_events} events · {unique_questions} unique questions\n")
    print(f"  {'─' * 56}")

    total_input  = 0
    total_output = 0
    total_cost   = 0.0
    event_num    = 0

    for question, role, seniority, reps in TEAM_EVENTS:
        for i in range(reps):
            event_num += 1
            user_msg = f"[{role} / {seniority}] {question}"

            try:
                response = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=512,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": user_msg}],
                    metadata={"user_id": f"{role}-{seniority}-{i}", "session_id": "tessera-BEFORE"},
                )

                inp = response.usage.input_tokens
                out = response.usage.output_tokens
                cost = (inp * 0.80 + out * 4.00) / 1_000_000

                total_input  += inp
                total_output += out
                total_cost   += cost

                status = f"  [{event_num:3d}/{total_events}] ✗ LLM  [{seniority:7s}] {question[:48]}"
                print(status, flush=True)

                # Small delay to avoid rate limiting
                time.sleep(0.1)

            except Exception as e:
                print(f"  [{event_num:3d}] ERROR: {e}")
                time.sleep(1.0)

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n  {'─' * 56}")
    print(f"  BEFORE — no cache")
    print(f"  {'─' * 56}")
    print(f"  Total events    {total_events:>10,}")
    print(f"  Input tokens    {total_input:>10,}")
    print(f"  Output tokens   {total_output:>10,}")
    print(f"  Total cost      ${total_cost:>9.2f}")
    print(f"  {'─' * 56}")
    print(f"\n  📊 See traces at {session.url}\n")

    # Write results for the after script to compare
    with open("/tmp/tessera_before.txt", "w") as f:
        f.write(f"{total_events},{total_input},{total_output},{total_cost:.4f}")

if __name__ == "__main__":
    run_before()
