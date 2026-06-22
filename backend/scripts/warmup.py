"""Judge-mode warm-up for a Tessera demo.

Run this against the *live* server 1-2 minutes before judges arrive. It drives the
running uvicorn process over HTTP so it warms the exact thing the judges will hit:
the Redis connection and the embedding model loaded inside that process.

Phases:
  1. CONNECTIVITY  — confirm the API is up and backed by Redis (not the in-memory
                     fallback), and report the embedding / LLM / Sentry status.
  2. MODEL WARM-UP — fire one throwaway query so the first real demo query is instant
                     instead of paying the one-time MiniLM load (~15-20s cold).
  3. SEED          — reset + re-seed both demo orgs (ask-ddoski IAM story, acmecorp
                     role tiers) so state is clean and reproducible.
  4. AMBIENT       — drive realistic traffic so the dashboard shows a live hit rate,
                     dollars saved, trending FAQs, and an activity feed.
  5. HERO PRIMING  — (default) pre-run the scripted "hero" queries so each is a
                     guaranteed instant cache hit during the demo. Use
                     --keep-hero-cold to leave them cold for a live miss->generate.

Usage:
    python -m scripts.warmup                       # http://localhost:8000
    python -m scripts.warmup --base-url https://api.example.com
    python -m scripts.warmup --keep-hero-cold      # show a live generation in the demo
    python -m scripts.warmup --no-ambient          # skip ambient traffic
"""
from __future__ import annotations

import argparse
import sys
import time
from typing import List, Optional, Tuple

import httpx

ASK = "ask-ddoski"
ACME = "acmecorp"

# IAM personas for the ask-ddoski governance story.
MAYA = {"user": "Maya", "team": "engineering", "level": "employee"}
LEO = {"user": "Leo", "team": "engineering", "level": "employee"}
RAJ = {"user": "Raj", "team": "engineering", "level": "manager"}
PRIYA = {"user": "Priya", "team": "finance", "level": "manager"}
DANA = {"user": "Dana", "team": "exec", "level": "exec"}

# Public hackathon questions — anyone may ask; used to fill the stats/activity feed.
PUBLIC_QUESTIONS = [
    "What are the three tracks?",
    "When is the submission deadline?",
    "What is the WiFi password?",
    "How big can a team be?",
    "What are the prizes?",
    "Who are the sponsors?",
    "What time is Saturday dinner?",
    "When is the closing ceremony?",
]

# acmecorp role-tiered questions: (question, role, seniority, tenure).
ACME_QUESTIONS = [
    ("how do I run the dev server", "engineer", "junior", "onboarding"),
    ("how do I run database migrations", "engineer", "junior", "onboarding"),
    ("how do we handle authentication", "engineer", "mid", "experienced"),
    ("what is our caching strategy", "engineer", "mid", "experienced"),
    ("what is our service architecture", "engineer", "senior", "experienced"),
    ("what is our observability stack", "devops", "senior", "experienced"),
    ("what is our multi-region failover strategy", "engineer", "staff", "experienced"),
]

# ----------------------------------------------------------------- console output
GREEN, RED, YELLOW, DIM, BOLD, RESET = (
    "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[1m", "\033[0m",
)


def _supports_color() -> bool:
    return sys.stdout.isatty()


def c(text: str, color: str) -> str:
    return f"{color}{text}{RESET}" if _supports_color() else text


def phase(n: int, title: str) -> None:
    print()
    print(c(f"=== {n}. {title} ===", BOLD))


_checks: List[Tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> bool:
    tag = c("OK  ", GREEN) if ok else c("FAIL", RED)
    line = f"  [{tag}] {label}"
    if detail:
        line += c(f"  — {detail}", DIM)
    print(line)
    _checks.append((ok, label))
    return ok


def warn(label: str, detail: str = "") -> None:
    line = f"  [{c('WARN', YELLOW)}] {label}"
    if detail:
        line += c(f"  — {detail}", DIM)
    print(line)


# ----------------------------------------------------------------- http helpers
def _query(client: httpx.Client, base: str, org: str, question: str, **kw) -> dict:
    body = {"question": question, **kw}
    r = client.post(f"{base}/api/orgs/{org}/query", json=body)
    r.raise_for_status()
    return r.json()


def run(base: str, keep_hero_cold: bool, do_ambient: bool) -> int:
    base = base.rstrip("/")
    print(c("Tessera judge-mode warm-up", BOLD), c(f"-> {base}", DIM))
    client = httpx.Client(timeout=90.0)

    # 1. CONNECTIVITY -------------------------------------------------------
    phase(1, "Connectivity")
    try:
        health = client.get(f"{base}/api/health").json()
    except Exception as exc:
        check(False, "API reachable", f"{type(exc).__name__}: {exc}")
        print(c("\n  Is the server running?  uvicorn app.main:app --port 8000", YELLOW))
        return 1
    check(True, "API reachable", base)

    backend = health.get("store_backend", "?")
    on_redis = backend == "redis"
    if on_redis:
        check(True, "store backend", "redis (production path)")
    else:
        check(False, "store backend",
              f"'{backend}' — Redis NOT connected; vector search + reverse index "
              f"are running on the in-memory fallback")

    embed = health.get("embedding_backend", "?")
    if embed == "fallback":
        warn("embedding backend", "hashed fallback (install sentence-transformers for real semantics)")
    else:
        check(True, "embedding backend", embed)

    if health.get("llm_available"):
        check(True, "LLM", "Claude available (real generations on a miss)")
    else:
        warn("LLM", "no ANTHROPIC_API_KEY — misses use the deterministic stub")

    if health.get("sentry_enabled"):
        check(True, "Sentry", "enabled (governance issues + traces live)")
    else:
        warn("Sentry", "disabled — set SENTRY_DSN to demo the silent-failure thesis")

    # 2. MODEL WARM-UP ------------------------------------------------------
    phase(2, "Model warm-up")
    t0 = time.perf_counter()
    try:
        _query(client, base, ASK, "warmup ping please ignore")
        dt = time.perf_counter() - t0
        if dt > 8:
            check(True, "embedding model loaded", f"cold start absorbed in {dt:.1f}s")
        else:
            check(True, "embedding model warm", f"first query {dt:.2f}s")
    except Exception as exc:
        check(False, "model warm-up query", f"{type(exc).__name__}: {exc}")

    # 3. SEED ---------------------------------------------------------------
    phase(3, "Reset + seed demo orgs")
    for org, label in ((ASK, "ask-ddoski (IAM story)"), (ACME, "acmecorp (role tiers)")):
        try:
            client.post(f"{base}/api/orgs/{org}/reset").raise_for_status()
            seed = client.post(f"{base}/api/orgs/{org}/ingest/seed").json()
            info = client.get(f"{base}/api/orgs/{org}/info").json()
            n = seed.get("entries", info.get("cache_size", "?"))
            check(True, f"seeded {label}",
                  f"{n} cache entries, {info.get('chunks', '?')} chunks")
        except Exception as exc:
            check(False, f"seed {label}", f"{type(exc).__name__}: {exc}")

    # 4. AMBIENT TRAFFIC ----------------------------------------------------
    if do_ambient:
        phase(4, "Ambient traffic (so the dashboard looks alive)")
        personas = [MAYA, LEO, RAJ, PRIYA, DANA]
        n_ask = 0
        try:
            for i, q in enumerate(PUBLIC_QUESTIONS):
                idn = personas[i % len(personas)]
                _query(client, base, ASK, q, identity=idn)   # first ask -> miss/generate
                _query(client, base, ASK, q, identity=idn)   # repeat   -> hit
                n_ask += 2
            check(True, "ask-ddoski ambient", f"{n_ask} queries across 5 personas")
        except Exception as exc:
            check(False, "ask-ddoski ambient", f"{type(exc).__name__}: {exc}")

        n_acme = 0
        try:
            for q, role, sen, ten in ACME_QUESTIONS:
                seg = {"role": role, "seniority": sen, "tenure": ten}
                _query(client, base, ACME, q, **seg)
                _query(client, base, ACME, q, **seg)
                n_acme += 2
            check(True, "acmecorp ambient", f"{n_acme} role-tiered queries")
        except Exception as exc:
            check(False, "acmecorp ambient", f"{type(exc).__name__}: {exc}")
    else:
        phase(4, "Ambient traffic")
        print(c("  skipped (--no-ambient)", DIM))

    # 5. HERO PRIMING -------------------------------------------------------
    phase(5, "Hero queries")
    if keep_hero_cold:
        print(c("  left COLD (--keep-hero-cold) — these will miss->generate live:", DIM))
        print(c("    Dana(CEO): 'What are the sponsorship contract dollar amounts?'", DIM))
        print(c("    acmecorp junior: 'how do I run the dev server'", DIM))
    else:
        try:
            # IAM story: CEO asks the confidential figure first so an exec-labelled
            # entry exists. The demo then shows Maya(intern) being correctly denied it.
            _query(client, base, ASK, "What are the sponsorship contract dollar amounts?",
                   identity=DANA)
            # Same-team public share + cross-team public share.
            _query(client, base, ASK, "What time is Saturday lunch?", identity=MAYA)
            _query(client, base, ASK, "What time is Saturday lunch?", identity=LEO)
            # Eng-manager-only content (Priya in finance must NOT see it live).
            _query(client, base, ASK, "What is the engineering platform infrastructure?",
                   identity=RAJ)
            check(True, "ask-ddoski hero queries primed", "instant hits in the demo")
        except Exception as exc:
            check(False, "ask-ddoski hero priming", f"{type(exc).__name__}: {exc}")

        try:
            _query(client, base, ACME, "how do I run the dev server",
                   role="engineer", seniority="junior", tenure="onboarding")
            _query(client, base, ACME, "what is our north-star technical strategy",
                   role="engineer", seniority="principal", tenure="experienced")
            check(True, "acmecorp hero queries primed", "junior + principal tiers")
        except Exception as exc:
            check(False, "acmecorp hero priming", f"{type(exc).__name__}: {exc}")

    # SUMMARY ---------------------------------------------------------------
    phase(6, "Readiness")
    for org, label in ((ASK, "ask-ddoski"), (ACME, "acmecorp")):
        try:
            s = client.get(f"{base}/api/orgs/{org}/stats").json()
            print(f"  {c(label, BOLD)}: "
                  f"{s['hits']} hits / {s['total_requests']} reqs "
                  f"({s['hit_rate_pct']}% hit rate) · "
                  f"{s['tokens_saved']:,} tokens saved · "
                  f"${s['saved_usd']:.4f} saved · "
                  f"{s['cache_size']} entries")
        except Exception as exc:
            warn(f"{label} stats", f"{type(exc).__name__}: {exc}")

    failed = [label for ok, label in _checks if not ok]
    print()
    if not failed:
        msg = "READY — open the dashboard and demo." if on_redis else \
            "Functional, but Redis is on the in-memory fallback (see WARN above)."
        print(c(f"  {msg}", GREEN if on_redis else YELLOW))
        return 0
    print(c(f"  {len(failed)} check(s) FAILED: {', '.join(failed)}", RED))
    return 1


def main() -> int:
    p = argparse.ArgumentParser(description="Judge-mode warm-up for a Tessera demo.")
    p.add_argument("--base-url", default="http://localhost:8000",
                   help="Live API base URL (default: http://localhost:8000)")
    p.add_argument("--keep-hero-cold", action="store_true",
                   help="Leave hero queries cold for a live miss->generate demo")
    p.add_argument("--no-ambient", action="store_true",
                   help="Skip ambient traffic that populates the dashboard")
    args = p.parse_args()
    return run(args.base_url, args.keep_hero_cold, not args.no_ambient)


if __name__ == "__main__":
    raise SystemExit(main())
