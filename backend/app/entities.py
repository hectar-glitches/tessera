"""Lightweight entity extraction for the safety filter.

We extract a small set of *discriminative* entities — the ones that flip the meaning
of a near-miss query (a day, a number/date, a named track/sponsor/prize, a meal).
Each entity is a ``category:value`` tag. Two queries "conflict" when they both name a
value in the same category but those values disagree (e.g. ``day:saturday`` vs
``day:sunday``). Conflicts are what make naive semantic caching unsafe; we surface
them instead of serving a confident wrong answer.
"""
from __future__ import annotations

import re
from typing import Dict, List, Set, Tuple

DAYS = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]
MONTHS = [
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
]
MEALS = ["breakfast", "brunch", "lunch", "dinner", "snack", "snacks"]
ORDINALS = {
    "first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5",
    "1st": "1", "2nd": "2", "3rd": "3", "4th": "4", "5th": "5",
}

# Demo-tenant wordlists. In production these come from the org's ingested doc
# (proper nouns) plus an admin-editable list; kept short and explicit here.
DEFAULT_TRACKS = {
    "lab": ["ddoski's lab", "ddoskis lab", "lab track", "the lab"],
    "toolbox": ["ddoski's toolbox", "ddoskis toolbox", "toolbox track", "the toolbox"],
    "world": ["world track", "ddoski's world", "ddoskis world"],
}
DEFAULT_SPONSORS = {
    "anthropic": ["anthropic", "claude"],
    "redis": ["redis"],
    "vercel": ["vercel"],
    "modal": ["modal"],
}

_NUM_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
_TIME_RE = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b", re.I)
_MONEY_RE = re.compile(r"\$\s?\d+(?:,\d{3})*(?:\.\d+)?\b")

# Question "focus" — what the asker actually wants. Treated as an entity category so
# that same-entity / different-intent pairs ("when is X" vs "where is X") conflict and
# are NOT auto-served. Multi-word phrases are checked before single words.
_FOCUS_PHRASES = [
    ("time", ["what time", "when"]),
    ("place", ["where", "which room", "what room", "location", "venue"]),
    ("person", ["who"]),
    ("quantity", ["how much", "how many", "how big", "how large", "how long",
                  "maximum", "minimum", "prize", "price", "cost", "amount"]),
    ("reason", ["why"]),
    ("method", ["how do", "how can", "how to", "qualify", "apply", "register",
                "submit"]),
    ("event", ["what happens", "what occurs", "happen at", "what goes on"]),
]


def _extract_focus(t: str) -> Set[str]:
    found: Set[str] = set()
    for focus, phrases in _FOCUS_PHRASES:
        if any(_phrase_present(t, p) for p in phrases):
            found.add(focus)
    return found


def _phrase_present(text: str, phrase: str) -> bool:
    return re.search(r"\b" + re.escape(phrase) + r"\b", text) is not None


def extract(
    text: str,
    tracks: Dict[str, List[str]] | None = None,
    sponsors: Dict[str, List[str]] | None = None,
) -> List[str]:
    tracks = tracks or DEFAULT_TRACKS
    sponsors = sponsors or DEFAULT_SPONSORS
    t = text.lower()
    tags: Set[str] = set()

    for d in DAYS:
        if _phrase_present(t, d):
            tags.add(f"day:{d}")
    for m in MONTHS:
        if _phrase_present(t, m):
            tags.add(f"month:{m}")
    for meal in MEALS:
        if _phrase_present(t, meal.rstrip("s")):
            tags.add(f"meal:{meal.rstrip('s')}")

    for word, val in ORDINALS.items():
        if _phrase_present(t, word):
            tags.add(f"ordinal:{val}")

    for money in _MONEY_RE.findall(t):
        tags.add(f"money:{re.sub(r'[^0-9.]', '', money)}")
    for tm in _TIME_RE.findall(t):
        tags.add(f"time:{tm.replace(' ', '').lower()}")
    # Plain numbers, excluding ones already captured as money/time/days.
    for n in _NUM_RE.findall(t):
        tags.add(f"num:{n}")

    for canon, aliases in tracks.items():
        if any(_phrase_present(t, a) for a in aliases):
            tags.add(f"track:{canon}")
    for canon, aliases in sponsors.items():
        if any(_phrase_present(t, a) for a in aliases):
            tags.add(f"sponsor:{canon}")

    for focus in _extract_focus(t):
        tags.add(f"focus:{focus}")

    return sorted(tags)


def _by_category(tags: List[str]) -> Dict[str, Set[str]]:
    out: Dict[str, Set[str]] = {}
    for tag in tags:
        cat, _, val = tag.partition(":")
        out.setdefault(cat, set()).add(val)
    return out


def conflict(query_tags: List[str], candidate_tags: List[str]) -> Tuple[bool, List[str]]:
    """Return (is_conflict, conflicting_categories).

    A conflict exists when both sides name a value in the same category and those
    value-sets are disjoint. Categories present on only one side do not conflict.
    """
    q = _by_category(query_tags)
    c = _by_category(candidate_tags)
    conflicts: List[str] = []
    for cat in set(q) & set(c):
        if q[cat].isdisjoint(c[cat]):
            conflicts.append(cat)
    return (len(conflicts) > 0, sorted(conflicts))


def entity_match(query_tags: List[str], candidate_tags: List[str]) -> bool:
    """Safe to treat as the same question (entity-wise) iff no category conflicts."""
    is_conflict, _ = conflict(query_tags, candidate_tags)
    return not is_conflict
