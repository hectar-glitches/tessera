"""IAM smoke test: intern-vs-CEO isolation, same-team sharing, team isolation."""
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)
ORG = "ask-ddoski"
c.post(f"/api/orgs/{ORG}/reset")
c.post(f"/api/orgs/{ORG}/ingest/seed")

MAYA = {"user": "Maya", "team": "engineering", "level": "employee"}
LEO = {"user": "Leo", "team": "engineering", "level": "employee"}
RAJ = {"user": "Raj", "team": "engineering", "level": "manager"}
PRIYA = {"user": "Priya", "team": "finance", "level": "manager"}
DANA = {"user": "Dana", "team": "exec", "level": "exec"}


def ask(idn, q, **kw):
    return c.post(f"/api/orgs/{ORG}/query",
                  json={"question": q, "identity": idn, **kw}).json()


def show(tag, r):
    leak = "75,000" in (r["answer"] or "") or "75000" in (r["answer"] or "")
    print(f"{tag:28} decision={r['decision']:7} access={r['access_level']:8} "
          f"teams={r['access_teams']} leak75k={leak}")


print("\n--- intern vs CEO on confidential sponsor figures (CEO asks first) ---")
Q = "What are the sponsorship contract dollar amounts?"
show("Dana(CEO) first ", ask(DANA, Q))   # expect exec answer WITH 75k
show("Maya(intern)    ", ask(MAYA, Q))    # must NOT hit Dana's exec answer, no 75k

print("\n--- same-team cache sharing (public question) ---")
QP = "What time is Saturday lunch?"
show("Maya(eng) first ", ask(MAYA, QP))
show("Leo(eng) shares ", ask(LEO, QP))     # expect hit
show("Priya(fin) shares", ask(PRIYA, QP))  # public => cross-team hit

print("\n--- team isolation (eng-manager-only content) ---")
QE = "What is the engineering platform infrastructure?"
show("Raj(eng mgr)    ", ask(RAJ, QE))
show("Priya(fin mgr)  ", ask(PRIYA, QE))    # must NOT see eng content

print("\nstats:", c.get(f"/api/orgs/{ORG}/stats").json()["hits"], "hits")
