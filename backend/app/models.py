from typing import List, Optional

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str
    accept_hash: Optional[str] = None
    force_generate: bool = False


class IngestRequest(BaseModel):
    document: str


class BudgetRequest(BaseModel):
    budget: float = Field(gt=0)


class SuggestionModel(BaseModel):
    hash: str
    question: str
    similarity: float
    entity_conflict: bool
    conflict_categories: List[str]


class QueryResponse(BaseModel):
    decision: str
    cached: bool
    answer: Optional[str]
    similarity: float
    matched_question: Optional[str]
    suggestions: List[SuggestionModel] = []
    tokens_saved: int = 0
    dollars_saved: float = 0.0
    via: str = ""
    model: str = ""
    entities: List[str] = []
