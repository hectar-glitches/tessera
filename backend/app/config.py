from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-3-5-sonnet-20241022"
    anthropic_model_small: str = "claude-3-5-haiku-20241022"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Embeddings
    embed_model: str = "all-MiniLM-L6-v2"
    embed_dim: int = 384

    # Decision thresholds (cosine similarity, 0..1). Tuned against the test suite for
    # the MiniLM embedder: >= sim_hit + entity/focus match -> instant hit; the
    # entity/focus conflict filter (not the threshold) is what keeps it safe.
    sim_hit: float = 0.55
    sim_suggest: float = 0.40

    # Pricing (USD per 1M tokens)
    price_input_per_m: float = 3.00
    price_output_per_m: float = 15.00

    # Default monthly budget per org (USD) used by the dashboard budget bar
    default_budget_usd: float = 50.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
