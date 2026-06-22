"""Headline numbers for the pitch — accuracy + cost, reproducible offline.

Two grounded numbers and one transparent model:
  1. ACCURACY      — baseline (vector-only) vs Tessera (vector + entity) on the eval set.
  2. FALSE SERVES  — how many wrong answers the baseline auto-serves vs Tessera (the
                     near-miss buckets where the cache *should not* match).
  3. COST          — $ saved per N queries at a given hit rate (assumptions stated).

No server, Redis, or API keys required — it calls the same eval the dashboard's
"confidence check" runs, plus the pricing from config.

    python -m scripts.eval_numbers
    python -m scripts.eval_numbers --queries 10000 --hit-rate 0.6
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import eval as eval_mod          # noqa: E402
from app.config import get_settings        # noqa: E402


def _dollars(tin: int, tout: int, s) -> float:
    return tin / 1e6 * s.price_input_per_m + tout / 1e6 * s.price_output_per_m


def _bar(pct: float, width: int = 24) -> str:
    filled = int(round(pct * width))
    return "█" * filled + "·" * (width - filled)


def main() -> int:
    p = argparse.ArgumentParser(description="Tessera headline numbers (offline).")
    p.add_argument("--in-tokens", type=int, default=900,
                   help="assumed input tokens per generated (miss) answer")
    p.add_argument("--out-tokens", type=int, default=250,
                   help="assumed output tokens per generated answer")
    p.add_argument("--queries", type=int, default=1000,
                   help="query volume for the savings projection")
    p.add_argument("--hit-rate", type=float, default=None,
                   help="single hit rate (0..1); default prints a table")
    args = p.parse_args()

    s = get_settings()
    rep = eval_mod.run_confidence_check()
    results = rep["results"]

    # --- accuracy ---------------------------------------------------------
    base_acc = rep["baseline_accuracy"]
    hyb_acc = rep["hybrid_accuracy"]

    # --- false serves (the safety number) ---------------------------------
    # Pairs whose correct decision is "do NOT serve": a baseline match here is a
    # confidently-wrong auto-served answer; Tessera should refuse it.
    should_not = [r for r in results if not r["expected_match"]]
    base_false = sum(1 for r in should_not if r["baseline_predicts_match"])
    hyb_false = sum(1 for r in should_not if r["hybrid_predicts_match"])
    reduction = (1 - hyb_false / base_false) * 100 if base_false else 0.0

    # --- cost model -------------------------------------------------------
    cost_per_miss = _dollars(args.in_tokens, args.out_tokens, s)

    print()
    print("=" * 64)
    print("  TESSERA — HEADLINE NUMBERS")
    print("=" * 64)
    print(f"  eval set: {rep['total_pairs']} pairs · embedder: {rep['embedding_backend']}"
          f" · hit threshold: {rep['threshold']}")

    print("\n  1) ACCURACY  (correct serve/refuse decisions)")
    print(f"     baseline · vector only   {_bar(base_acc)}  {base_acc*100:5.1f}%")
    print(f"     Tessera  · hybrid        {_bar(hyb_acc)}  {hyb_acc*100:5.1f}%")

    print("\n  2) FALSE SERVES  (wrong answers the cache auto-served)")
    print(f"     on {len(should_not)} 'should-not-match' pairs:")
    print(f"     baseline served WRONG:   {base_false}")
    print(f"     Tessera  served wrong:   {hyb_false}")
    print(f"     -> {reduction:.0f}% reduction in confidently-wrong answers")

    print("\n     by bucket (baseline correct / hybrid correct):")
    for bucket, st in rep["by_bucket"].items():
        print(f"       {bucket:<22} {st['baseline']}/{st['total']}"
              f"   ->   {st['hybrid']}/{st['total']}")

    print("\n  3) COST SAVED  (cache hit = $0; miss = one grounded generation)")
    print(f"     pricing: ${s.price_input_per_m:.2f}/M in · ${s.price_output_per_m:.2f}/M out")
    print(f"     assumed per answer: {args.in_tokens} in + {args.out_tokens} out tokens"
          f"  ->  ${cost_per_miss:.5f}/generation")
    rates = [args.hit_rate] if args.hit_rate is not None else [0.4, 0.6, 0.8]
    print(f"     savings over {args.queries:,} queries:")
    for hr in rates:
        saved = hr * args.queries * cost_per_miss
        print(f"       at {hr*100:4.0f}% hit rate   ${saved:8.2f}   "
              f"(${saved/args.queries*1000:.2f} per 1k)")

    # --- copy-paste block -------------------------------------------------
    headline_hr = args.hit_rate if args.hit_rate is not None else 0.6
    saved_1k = headline_hr * 1000 * cost_per_miss
    print("\n" + "-" * 64)
    print("  SLIDE NUMBERS (copy/paste)")
    print("-" * 64)
    print(f"  • {hyb_acc*100:.0f}% accuracy vs {base_acc*100:.0f}% for a naive cache")
    print(f"  • {reduction:.0f}% fewer confidently-wrong answers served")
    print(f"  • ~${saved_1k:.0f} saved per 1,000 questions at a {headline_hr*100:.0f}% hit rate")
    print("=" * 64 + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
