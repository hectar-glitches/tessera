"""End-to-end smoke test (in-memory store + fallback embedder + stub LLM)."""
import json

from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)
ORG = "ask-ddoski"

print("health:", c.get("/api/health").json())

print("ingest:", c.post(f"/api/orgs/{ORG}/ingest/seed").json())

q1 = c.post(f"/api/orgs/{ORG}/query", json={"question": "What time is Saturday lunch?"}).json()
print("\nQ1 (miss expected):", q1["decision"], "| answer:", q1["answer"][:80])

q2 = c.post(f"/api/orgs/{ORG}/query", json={"question": "What time is Saturday lunch?"}).json()
print("Q2 same (hit expected):", q2["decision"], "| saved$:", q2["dollars_saved"])

q3 = c.post(f"/api/orgs/{ORG}/query", json={"question": "What time is Sunday lunch?"}).json()
print("Q3 near-miss (suggest/miss expected):", q3["decision"],
      "| suggestions:", [s["question"] for s in q3["suggestions"]])

print("\nstats:", json.dumps(c.get(f"/api/orgs/{ORG}/stats").json(), indent=2))

cc = c.post(f"/api/orgs/{ORG}/confidence-check").json()
print("\nconfidence-check:")
print("  embedding_backend:", cc["embedding_backend"], "threshold:", cc["threshold"])
print("  baseline_accuracy:", cc["baseline_accuracy"], "hybrid_accuracy:", cc["hybrid_accuracy"])
print("  by_bucket:", json.dumps(cc["by_bucket"], indent=2))
