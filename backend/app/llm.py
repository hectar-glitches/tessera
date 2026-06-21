"""Claude wrapper with an offline fallback.

If ``ANTHROPIC_API_KEY`` is set, generation calls Claude. Otherwise it falls back to
a deterministic answer composed from the retrieved chunks so the whole flow stays
demoable with no network/key. Either way we return the answer plus token counts so
the savings accounting downstream is consistent.

Model cascading (stretch goal 3) is supported via ``simple``: simple lookups route to
the small/cheap model, everything else to the larger model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from .config import get_settings

SYSTEM_PROMPT = (
    "You are a helpful FAQ assistant for an organization. Answer ONLY from the "
    "provided context. If the context does not contain the answer, say you don't "
    "have that information. Be concise and specific. Never invent dates, prices, "
    "names, or times that are not in the context."
)


@dataclass
class Generation:
    answer: str
    tokens_in: int
    tokens_out: int
    model: str
    via: str  # "claude" | "stub"


def _approx_tokens(text: str) -> int:
    return max(1, round(len(text) / 4))


def _build_prompt(question: str, contexts: List[str]) -> str:
    ctx = "\n\n".join(f"[chunk {i + 1}]\n{c}" for i, c in enumerate(contexts))
    return f"Context:\n{ctx}\n\nQuestion: {question}\n\nAnswer:"


def _stub_answer(question: str, contexts: List[str]) -> str:
    if not contexts:
        return "I don't have that information in the current guide."
    # Pick the sentences from the top chunks most lexically relevant to the question.
    q_words = set(re.findall(r"[a-z0-9]+", question.lower()))
    scored = []
    for ctx in contexts[:3]:
        for sent in re.split(r"(?<=[.!?])\s+", ctx.strip()):
            sw = set(re.findall(r"[a-z0-9]+", sent.lower()))
            overlap = len(q_words & sw)
            if sent.strip():
                scored.append((overlap, sent.strip()))
    scored.sort(key=lambda x: x[0], reverse=True)
    best = [s for ov, s in scored[:2] if ov > 0] or [scored[0][1]] if scored else []
    return " ".join(best) if best else contexts[0].strip()[:400]


class LLM:
    def __init__(self):
        self.settings = get_settings()
        self._client = None
        if self.settings.anthropic_api_key:
            try:
                import anthropic

                self._client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
            except Exception:
                self._client = None

    @property
    def available(self) -> bool:
        return self._client is not None

    def generate(self, question: str, contexts: List[str], simple: bool = False) -> Generation:
        model = self.settings.anthropic_model_small if simple else self.settings.anthropic_model
        prompt = _build_prompt(question, contexts)

        if self._client is None:
            answer = _stub_answer(question, contexts)
            return Generation(
                answer=answer,
                tokens_in=_approx_tokens(SYSTEM_PROMPT + prompt),
                tokens_out=_approx_tokens(answer),
                model=f"{model} (stub)",
                via="stub",
            )

        resp = self._client.messages.create(
            model=model,
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = "".join(
            block.text for block in resp.content if getattr(block, "type", "") == "text"
        )
        return Generation(
            answer=answer.strip(),
            tokens_in=resp.usage.input_tokens,
            tokens_out=resp.usage.output_tokens,
            model=model,
            via="claude",
        )


_llm: Optional[LLM] = None


def get_llm() -> LLM:
    global _llm
    if _llm is None:
        _llm = LLM()
    return _llm
