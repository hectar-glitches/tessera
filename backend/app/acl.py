"""IAM access labels — the governance core.

Two axes:
- **level**: an ordered clearance tier (public < employee < manager < exec).
- **team**:  an unordered group; the *cache-sharing boundary* (teammates share).

Every source section carries a label. A cached answer **inherits the most-restrictive
label of the source chunks it was generated from**. A requester (Identity) may see an
entry iff:

    identity.level >= entry.level
    AND (entry has no team restriction
         OR identity.team in entry.teams
         OR identity is exec)            # exec sees across teams

Enforced on BOTH cache hits and suggestions, so a low-clearance user can never be
served — or even *see the existence of* — a higher-clearance answer.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

# Ordered clearance tiers.
LEVELS = {"public": 0, "employee": 1, "manager": 2, "exec": 3}
_RANK_TO_NAME = {v: k for k, v in LEVELS.items()}
EXEC = "exec"
NO_TEAM = "__none__"  # sentinel: restricted to no team (only exec can see)

_DIRECTIVE_RE = re.compile(r"<!--\s*acl:(.*?)-->", re.I)


def level_rank(level: str) -> int:
    return LEVELS.get((level or "public").lower(), 0)


def rank_to_name(rank: int) -> str:
    return _RANK_TO_NAME.get(max(0, min(3, rank)), "public")


@dataclass
class Identity:
    user: str = "anon"
    team: str = "all"
    level: str = "employee"

    @property
    def rank(self) -> int:
        return level_rank(self.level)

    @property
    def is_exec(self) -> bool:
        return self.level.lower() == EXEC

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "Identity":
        d = d or {}
        lvl = (d.get("level") or "employee").lower()
        if lvl not in LEVELS:
            lvl = "employee"
        return cls(
            user=d.get("user") or "anon",
            team=(d.get("team") or "all").lower(),
            level=lvl,
        )


@dataclass
class Label:
    level: str = "public"
    teams: List[str] = field(default_factory=list)  # empty = all teams

    @property
    def rank(self) -> int:
        return level_rank(self.level)


def parse_directive(text: str) -> Optional[Label]:
    """Parse an inline ``<!-- acl: level=manager team=finance -->`` directive."""
    m = _DIRECTIVE_RE.search(text)
    if not m:
        return None
    body = m.group(1)
    level = "public"
    teams: List[str] = []
    for key, val in re.findall(r"(\w+)\s*=\s*([\w,\-]+)", body):
        key = key.lower()
        if key == "level" and val.lower() in LEVELS:
            level = val.lower()
        elif key in ("team", "teams"):
            teams = [t.strip().lower() for t in val.split(",") if t.strip()
                     and t.strip().lower() != "all"]
    return Label(level=level, teams=teams)


def strip_directive(text: str) -> str:
    return _DIRECTIVE_RE.sub("", text).strip()


def combine(labels: List[Label]) -> Label:
    """Most-restrictive combination of the labels of the chunks an answer used.

    level = max; teams = intersection of each *restricted* chunk's team set
    (an unrestricted chunk imposes no team constraint).
    """
    if not labels:
        return Label()
    rank = max(l.rank for l in labels)
    acc: Optional[set] = None
    for l in labels:
        if l.teams:
            s = set(l.teams)
            acc = s if acc is None else (acc & s)
    if acc is None:
        teams: List[str] = []
    elif len(acc) == 0:
        teams = [NO_TEAM]
    else:
        teams = sorted(acc)
    return Label(level=rank_to_name(rank), teams=teams)


def can_access(identity: Identity, level: str, teams: List[str]) -> bool:
    if identity.rank < level_rank(level):
        return False
    if identity.is_exec:
        return True
    if not teams:
        return True
    return identity.team in teams
