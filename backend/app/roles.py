"""Role / seniority / tenure vocabulary and the hierarchy rule.

Single source of truth for the OrgCache segmentation layer. Kept tiny and dependency
free so it can be imported anywhere (engine, stores, seed loader, tests).

Hierarchy rule: a user at ``user_level = L`` may see any cache entry whose
``min_seniority_level <= L``. junior=1 ... principal=5.
"""
from __future__ import annotations

from typing import Optional

ROLES = ("engineer", "designer", "pm", "devops", "manager")
SENIORITIES = ("junior", "mid", "senior", "staff", "principal")
TENURES = ("onboarding", "experienced")

SENIORITY_LEVEL = {
    "junior": 1,
    "mid": 2,
    "senior": 3,
    "staff": 4,
    "principal": 5,
}

# Tenure -> the entry tenures that should be boosted for that user. onboarding users
# get a soft boost toward onboarding content; experienced users toward experienced.
_TENURE_BOOST = 0.05


def level_for(seniority: Optional[str]) -> Optional[int]:
    """Map a seniority string to its 1..5 level. Returns None if unknown/None."""
    if not seniority:
        return None
    return SENIORITY_LEVEL.get(seniority.lower())


def is_valid_role(role: Optional[str]) -> bool:
    return role is None or role.lower() in ROLES


def is_valid_seniority(seniority: Optional[str]) -> bool:
    return seniority is None or seniority.lower() in SENIORITIES


def is_valid_tenure(tenure: Optional[str]) -> bool:
    return tenure is None or tenure.lower() in TENURES


def can_view(user_level: Optional[int], min_seniority_level: int) -> bool:
    """Hierarchy check. If user_level is None (legacy call), everything is visible."""
    if user_level is None:
        return True
    return min_seniority_level <= user_level


def tenure_boost(user_tenure: Optional[str], entry_tenure: Optional[str]) -> float:
    """Soft re-rank boost (added to cosine score) when tenures align."""
    if user_tenure and entry_tenure and user_tenure.lower() == entry_tenure.lower():
        return _TENURE_BOOST
    return 0.0


def normalize_level(seniority: Optional[str], user_level: Optional[int]) -> Optional[int]:
    """Prefer an explicit user_level; otherwise derive from seniority."""
    if user_level is not None:
        return int(user_level)
    return level_for(seniority)
