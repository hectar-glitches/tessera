"""The decision engine.

Query path:
  embed -> extract entities -> hybrid cache search -> decide:
    HIGH sim + entity match     -> CACHE HIT   (instant, $ saved)
    HIGH sim + entity mismatch  -> SUGGEST      (popup; never auto-serve a near-miss)
    MID sim                      -> SUGGEST      (popup of close prior answers)
    LOW sim / nothing            -> CACHE MISS   (RAG + Claude, store entry)

The SUGGEST path is the safety mechanism: instead of silently serving a confident
wrong answer on a near-miss, we surface the close matches and let the user pick.
"""
from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import List, Optional

from . import acl, embeddings, entities
from .acl import Identity, Label
from .config import get_settings
from .llm import get_llm
from .store import BaseStore, LogEntry

TOP_K = 5
RAG_K = 4
RAG_FLOOR = 0.25  # below this, no retrieved chunk is relevant enough to ground on
NO_SOURCE_ANSWER = (
    "I couldn't find anything about that in the resources available to your access "
    "level. If you believe you should have access, contact an administrator."
)


@dataclass
class Suggestion:
    hash: str
    question: str
    similarity: float
    entity_conflict: bool
    conflict_categories: List[str]


@dataclass
class QueryResult:
    decision: str  # hit | suggest | miss
    cached: bool
    answer: Optional[str]
    similarity: float
    matched_question: Optional[str]
    suggestions: List[Suggestion] = field(default_factory=list)
    tokens_saved: int = 0
    dollars_saved: float = 0.0
    via: str = ""
    model: str = ""
    entities: List[str] = field(default_factory=list)
    access_level: str = "public"
    access_teams: List[str] = field(default_factory=list)
    sources: List[str] = field(default_factory=list)


def normalize_question(q: str) -> str:
    return re.sub(r"\s+", " ", q.strip().lower())


def query_hash(q: str) -> str:
    return hashlib.sha256(normalize_question(q).encode()).hexdigest()[:16]


def scoped_key(question: str, label: Label) -> str:
    """Cache key partitioned by access scope: identical questions are shared within a
    scope (teammates at the same clearance) but never across scopes."""
    tag = f"{label.level}|{','.join(sorted(label.teams))}"
    return hashlib.sha256((normalize_question(question) + "||" + tag).encode()).hexdigest()[:16]


def _dollars(tokens_in: int, tokens_out: int) -> float:
    s = get_settings()
    return tokens_in / 1e6 * s.price_input_per_m + tokens_out / 1e6 * s.price_output_per_m


def _is_simple(question: str) -> bool:
    q = question.lower()
    words = re.findall(r"[a-z0-9]+", q)
    if any(t in q for t in ("why", "how do", "how can", "explain", "difference",
                            "compare", "walk me through", "step by step")):
        return False
    return len(words) <= 12


def _compress(question: str, contexts: List[str], max_sentences: int = 4) -> List[str]:
    """Stretch goal 4: trim retrieved chunks to the sentences most relevant to the
    query before sending to the model."""
    q_words = set(re.findall(r"[a-z0-9]+", question.lower()))
    out = []
    for ctx in contexts:
        sents = re.split(r"(?<=[.!?])\s+", ctx.strip())
        scored = sorted(
            sents,
            key=lambda s: len(q_words & set(re.findall(r"[a-z0-9]+", s.lower()))),
            reverse=True,
        )
        kept = [s for s in scored[:max_sentences] if s.strip()]
        out.append(" ".join(kept) if kept else ctx[:300])
    return out


class Engine:
    def __init__(self, store: BaseStore):
        self.store = store
        self.settings = get_settings()

    # -------------------------------------------------------------- main query
    def query(
        self,
        org: str,
        question: str,
        identity: Optional[Identity] = None,
        accept_hash: Optional[str] = None,
        force_generate: bool = False,
        compress: bool = True,
    ) -> QueryResult:
        identity = identity or Identity()
        qvec = embeddings.embed(question)
        qents = entities.extract(question)

        # User accepted a suggested prior answer -> serve it (only if still authorized).
        if accept_hash:
            entry = self.store.get_cache_entry(org, accept_hash)
            if entry and acl.can_access(identity, entry.acl_level, entry.acl_teams):
                return self._serve_hit(org, question, entry, identity, similarity=1.0,
                                       note="user-selected suggestion")

        # Cache search is access-scoped: candidates the identity may not see never
        # appear here, so neither hits NOR suggestions can leak across boundaries.
        candidates = self.store.search_cache(org, qvec, TOP_K, identity)
        best = candidates[0] if candidates else None

        if not force_generate and best is not None:
            match = entities.entity_match(qents, best.entities)
            if best.score >= self.settings.sim_hit and match:
                return self._serve_hit(org, question, best, identity, similarity=best.score)

            # Gray zone (mid sim) OR high sim but entity conflict -> suggest popup.
            if best.score >= self.settings.sim_suggest:
                sugg = []
                for c in candidates:
                    if c.score < self.settings.sim_suggest:
                        continue
                    conflict, cats = entities.conflict(qents, c.entities)
                    sugg.append(Suggestion(c.hash, c.question, round(c.score, 4),
                                           conflict, cats))
                self.store.bump_stats(org, suggests=1)
                self._log(org, question, "suggest", best.score, None, 0, 0.0,
                          identity=identity, note="surfaced close matches")
                return QueryResult(
                    decision="suggest",
                    cached=False,
                    answer=None,
                    similarity=round(best.score, 4),
                    matched_question=best.question,
                    suggestions=sugg,
                    entities=qents,
                    access_level=identity.level,
                    access_teams=[identity.team] if identity.team != "all" else [],
                )

        # Cache miss -> generate.
        return self._generate(org, question, qvec, qents, identity, compress=compress,
                              similarity=best.score if best else 0.0)

    # -------------------------------------------------------------- helpers
    def _serve_hit(self, org, question, entry, identity, similarity, note="") -> QueryResult:
        saved_tokens = entry.tokens_in + entry.tokens_out
        saved_usd = _dollars(entry.tokens_in, entry.tokens_out)
        self.store.bump_stats(org, hits=1, tokens_saved=saved_tokens, saved_usd=saved_usd)
        self._log(org, question, "hit", similarity, entry.question, saved_tokens,
                  saved_usd, identity=identity, note=note)
        return QueryResult(
            decision="hit",
            cached=True,
            answer=entry.answer,
            similarity=round(similarity, 4),
            matched_question=entry.question,
            tokens_saved=saved_tokens,
            dollars_saved=round(saved_usd, 6),
            via="cache",
            model="cache",
            access_level=entry.acl_level,
            access_teams=entry.acl_teams,
            sources=entry.chunk_ids,
        )

    def _generate(self, org, question, qvec, qents, identity, compress, similarity) -> QueryResult:
        # RAG retrieval is itself access-scoped: a low-clearance user's answer can only
        # ever be grounded on chunks they're allowed to read.
        chunk_hits = self.store.search_chunks(org, qvec, RAG_K, identity)
        top = chunk_hits[0].score if chunk_hits else 0.0
        if not chunk_hits or top < RAG_FLOOR:
            self.store.bump_stats(org, misses=1)
            self._log(org, question, "miss", similarity, None, 0, 0.0, identity=identity,
                      note="no accessible source")
            return QueryResult(
                decision="miss", cached=False, answer=NO_SOURCE_ANSWER,
                similarity=round(similarity, 4), matched_question=None,
                via="policy", model="access", entities=qents,
                access_level=identity.level,
            )

        # Only the chunks actually relevant enough to ground the answer define its label.
        used = [h for h in chunk_hits if h.score >= max(RAG_FLOOR, 0.5 * top)] or chunk_hits[:1]
        label = acl.combine([Label(h.acl_level, h.acl_teams) for h in used])
        key = scoped_key(question, label)

        hkey = f"{org}:{key}"
        got_lock = self.store.try_lock(hkey, ttl=20)
        if not got_lock:
            # Another identical (same-scope) request is in flight; coalesce.
            for _ in range(40):
                time.sleep(0.25)
                entry = self.store.get_cache_entry(org, key)
                if entry:
                    return self._serve_hit(org, question, entry, identity, similarity=1.0,
                                           note="coalesced with in-flight request")
        try:
            contexts = [h.text for h in used]
            if compress:
                contexts = _compress(question, contexts)
            llm = get_llm()
            gen = llm.generate(question, contexts, simple=_is_simple(question))

            spent_usd = _dollars(gen.tokens_in, gen.tokens_out)
            chunk_ids = [h.chunk_id for h in used]
            self.store.write_cache_entry(
                org=org,
                hash_=key,
                question=question,
                answer=gen.answer,
                vector=qvec,
                entities=qents,
                chunk_ids=chunk_ids,
                tokens_in=gen.tokens_in,
                tokens_out=gen.tokens_out,
                acl_level=label.level,
                acl_teams=label.teams,
            )
            self.store.bump_stats(org, misses=1, spend_usd=spent_usd,
                                  tokens_spent=gen.tokens_in + gen.tokens_out)
            self._log(org, question, "miss", similarity, None, 0, 0.0, identity=identity,
                      note=f"generated via {gen.via} ({gen.model}) @ {label.level}")
            return QueryResult(
                decision="miss",
                cached=False,
                answer=gen.answer,
                similarity=round(similarity, 4),
                matched_question=None,
                via=gen.via,
                model=gen.model,
                entities=qents,
                access_level=label.level,
                access_teams=label.teams,
                sources=chunk_ids,
            )
        finally:
            self.store.release_lock(hkey)

    def _log(self, org, question, decision, similarity, matched, tokens_saved,
             dollars_saved, identity: Optional[Identity] = None, note=""):
        actor, access = "", ""
        if identity:
            actor = f"{identity.user} ({identity.team}/{identity.level})"
            access = identity.level
        self.store.append_log(org, LogEntry(
            ts=time.time(),
            question=question,
            decision=decision,
            similarity=round(float(similarity), 4),
            matched_question=matched,
            tokens_saved=int(tokens_saved),
            dollars_saved=round(float(dollars_saved), 6),
            note=note,
            actor=actor,
            access=access,
        ))
