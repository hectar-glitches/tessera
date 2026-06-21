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

from . import embeddings, entities
from .config import get_settings
from .llm import get_llm
from .store import BaseStore, LogEntry

TOP_K = 5
RAG_K = 4


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
    role: str = ""
    seniority: str = ""
    min_seniority_level: int = 1


def normalize_question(q: str) -> str:
    return re.sub(r"\s+", " ", q.strip().lower())


def query_hash(q: str) -> str:
    return hashlib.sha256(normalize_question(q).encode()).hexdigest()[:16]


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
    def query(self, org: str, question: str, role: Optional[str] = None,
              seniority: Optional[str] = None, **kwargs) -> QueryResult:
        """Public entrypoint: runs the decision and logs it to Arize (single site)."""
        from . import arize_logger

        t0 = time.perf_counter()
        result = self._query_impl(org, question, role=role, seniority=seniority,
                                  **kwargs)
        arize_logger.log_decision(
            question=question,
            cache_hit=result.decision == "hit",
            similarity_score=result.similarity,
            role=role or "",
            seniority=seniority or "",
            tokens_saved=result.tokens_saved,
            response_time_ms=(time.perf_counter() - t0) * 1000,
            decision=result.decision,
        )
        return result

    def _query_impl(
        self,
        org: str,
        question: str,
        accept_hash: Optional[str] = None,
        force_generate: bool = False,
        compress: bool = True,
        role: Optional[str] = None,
        seniority: Optional[str] = None,
        tenure: Optional[str] = None,
        user_level: Optional[int] = None,
    ) -> QueryResult:
        from .roles import normalize_level

        level = normalize_level(seniority, user_level)
        qvec = embeddings.embed(question)
        qents = entities.extract(question)

        # User accepted a suggested prior answer -> serve it as an instant hit.
        if accept_hash:
            entry = self.store.get_cache_entry(org, accept_hash)
            if entry:
                return self._serve_hit(org, question, entry, similarity=1.0,
                                       note="user-selected suggestion")

        candidates = self.store.search_cache(
            org, qvec, TOP_K, user_level=level, role=role, tenure=tenure)
        best = candidates[0] if candidates else None

        if not force_generate and best is not None:
            match = entities.entity_match(qents, best.entities)
            if best.score >= self.settings.sim_hit and match:
                return self._serve_hit(org, question, best, similarity=best.score)

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
                          note="surfaced close matches")
                return QueryResult(
                    decision="suggest",
                    cached=False,
                    answer=None,
                    similarity=round(best.score, 4),
                    matched_question=best.question,
                    suggestions=sugg,
                    entities=qents,
                )

        # Cache miss -> generate.
        return self._generate(org, question, qvec, qents, compress=compress,
                              similarity=best.score if best else 0.0)

    # -------------------------------------------------------------- helpers
    def _serve_hit(self, org, question, entry, similarity, note="") -> QueryResult:
        saved_tokens = entry.tokens_in + entry.tokens_out
        saved_usd = _dollars(entry.tokens_in, entry.tokens_out)
        self.store.bump_stats(org, hits=1, tokens_saved=saved_tokens, saved_usd=saved_usd)
        self.store.bump_hit(org, entry.hash)
        self._log(org, question, "hit", similarity, entry.question, saved_tokens,
                  saved_usd, note=note)
        return QueryResult(
            decision="hit",
            cached=True,
            answer=entry.answer,
            # Clamp: the tenure re-rank boost can push a raw match score above 1.0,
            # but the reported similarity should stay a clean 0..1 value.
            similarity=round(min(1.0, similarity), 4),
            matched_question=entry.question,
            tokens_saved=saved_tokens,
            dollars_saved=round(saved_usd, 6),
            via="cache",
            model="cache",
            role=entry.role,
            seniority=entry.seniority,
            min_seniority_level=entry.min_seniority_level,
        )

    def _generate(self, org, question, qvec, qents, compress, similarity) -> QueryResult:
        hkey = f"{org}:{query_hash(question)}"
        got_lock = self.store.try_lock(hkey, ttl=20)
        if not got_lock:
            # Another identical request is in flight; coalesce by waiting for it.
            for _ in range(40):
                time.sleep(0.25)
                entry = self.store.get_cache_entry(org, query_hash(question))
                if entry:
                    return self._serve_hit(org, question, entry, similarity=1.0,
                                           note="coalesced with in-flight request")
        try:
            chunk_hits = self.store.search_chunks(org, qvec, RAG_K)
            contexts = [h.text for h in chunk_hits]
            if compress:
                contexts = _compress(question, contexts)
            llm = get_llm()
            gen = llm.generate(question, contexts, simple=_is_simple(question))

            spent_usd = _dollars(gen.tokens_in, gen.tokens_out)
            chunk_ids = [h.chunk_id for h in chunk_hits]
            self.store.write_cache_entry(
                org=org,
                hash_=query_hash(question),
                question=question,
                answer=gen.answer,
                vector=qvec,
                entities=qents,
                chunk_ids=chunk_ids,
                tokens_in=gen.tokens_in,
                tokens_out=gen.tokens_out,
            )
            self.store.bump_stats(org, misses=1, spend_usd=spent_usd,
                                  tokens_spent=gen.tokens_in + gen.tokens_out)
            self._log(org, question, "miss", similarity, None, 0, 0.0,
                      note=f"generated via {gen.via} ({gen.model})")
            return QueryResult(
                decision="miss",
                cached=False,
                answer=gen.answer,
                similarity=round(similarity, 4),
                matched_question=None,
                via=gen.via,
                model=gen.model,
                entities=qents,
            )
        finally:
            self.store.release_lock(hkey)

    def _log(self, org, question, decision, similarity, matched, tokens_saved,
             dollars_saved, note=""):
        self.store.append_log(org, LogEntry(
            ts=time.time(),
            question=question,
            decision=decision,
            similarity=round(float(similarity), 4),
            matched_question=matched,
            tokens_saved=int(tokens_saved),
            dollars_saved=round(float(dollars_saved), 6),
            note=note,
        ))
