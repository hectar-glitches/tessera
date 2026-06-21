"""Print real similarities per pair and sweep thresholds to pick sim_hit."""
import json

from app import embeddings, entities, eval as eval_mod

pairs = eval_mod.load_pairs()
print("backend:", embeddings.backend_name())

rows = []
for p in pairs:
    v1, v2 = embeddings.embed(p["reference"]), embeddings.embed(p["probe"])
    sim = embeddings.cosine(v1, v2)
    conflict, _ = entities.conflict(entities.extract(p["reference"]),
                                    entities.extract(p["probe"]))
    rows.append((p["bucket"], p["expected_match"], round(sim, 3), conflict, p["probe"]))

for bucket in ["paraphrase", "near-miss-by-entity", "same-entity-different-intent", "unrelated"]:
    print(f"\n== {bucket} ==")
    for b, exp, sim, conf, probe in rows:
        if b == bucket:
            print(f"  sim={sim} conflict={conf} exp={exp}  {probe}")

print("\nThreshold sweep (baseline_acc, hybrid_acc):")
for thr in [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.86]:
    bc = hc = 0
    for b, exp, sim, conf, _ in rows:
        base = sim >= thr
        hyb = base and not conf
        bc += int(base == exp)
        hc += int(hyb == exp)
    n = len(rows)
    print(f"  thr={thr}: baseline={bc}/{n} ({bc/n:.0%})  hybrid={hc}/{n} ({hc/n:.0%})")
