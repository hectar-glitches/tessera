"""The confidence check — the strongest demo beat.

Runs the hand-built test suite two ways:
  - baseline: vector similarity only (auto-hit if sim >= threshold)
  - hybrid:   vector similarity AND entity match (Tessera's safety filter)

The baseline visibly fails the near-miss-by-entity bucket (false-positive cache hits);
the hybrid passes all four buckets. Self-contained and re-runnable from the dashboard.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

from . import embeddings, entities
from .config import get_settings

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_pairs() -> List[dict]:
    with open(DATA_DIR / "test_pairs.json") as f:
        return json.load(f)


def run_confidence_check(pairs: List[dict] | None = None) -> Dict:
    settings = get_settings()
    pairs = pairs or load_pairs()
    threshold = settings.sim_hit

    results = []
    base_correct = hybrid_correct = 0
    bucket_stats: Dict[str, Dict[str, int]] = {}

    for p in pairs:
        ref, probe = p["reference"], p["probe"]
        expected = bool(p["expected_match"])
        bucket = p["bucket"]

        v1, v2 = embeddings.embed(ref), embeddings.embed(probe)
        sim = embeddings.cosine(v1, v2)
        ref_ents = entities.extract(ref)
        probe_ents = entities.extract(probe)
        conflict, cats = entities.conflict(ref_ents, probe_ents)

        baseline_pred = sim >= threshold
        hybrid_pred = baseline_pred and not conflict

        b_ok = baseline_pred == expected
        h_ok = hybrid_pred == expected
        base_correct += int(b_ok)
        hybrid_correct += int(h_ok)

        bs = bucket_stats.setdefault(bucket, {"total": 0, "baseline": 0, "hybrid": 0})
        bs["total"] += 1
        bs["baseline"] += int(b_ok)
        bs["hybrid"] += int(h_ok)

        results.append({
            "bucket": bucket,
            "reference": ref,
            "probe": probe,
            "expected_match": expected,
            "similarity": round(sim, 4),
            "entity_conflict": conflict,
            "conflict_categories": cats,
            "baseline_predicts_match": baseline_pred,
            "hybrid_predicts_match": hybrid_pred,
            "baseline_correct": b_ok,
            "hybrid_correct": h_ok,
        })

    n = len(pairs)
    return {
        "threshold": threshold,
        "embedding_backend": embeddings.backend_name(),
        "total_pairs": n,
        "baseline_accuracy": round(base_correct / n, 4) if n else 0.0,
        "hybrid_accuracy": round(hybrid_correct / n, 4) if n else 0.0,
        "baseline_correct": base_correct,
        "hybrid_correct": hybrid_correct,
        "by_bucket": bucket_stats,
        "results": results,
    }
