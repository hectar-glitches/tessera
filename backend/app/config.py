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

    # Label-aware cache TTL (seconds). Correctness is handled event-driven by the
    # reverse-index invalidation on source edits; these TTLs are a *risk ceiling*:
    # more sensitive answers expire sooner, bounding both staleness from out-of-band
    # drift and the blast radius of any mislabel. 0 disables expiry for that tier.
    cache_ttl_public: int = 604800     # 7 days  — cheap, low-risk, maximize hit rate
    cache_ttl_employee: int = 86400    # 24 hours
    cache_ttl_manager: int = 3600      # 1 hour
    cache_ttl_exec: int = 900          # 15 minutes — tightest window for top secrecy

    # Auth / trust boundary. Identity claims (clearance level + team) are issued
    # server-side as HMAC-signed tokens by the simulated IdP (/api/auth/login) and
    # verified on /query — so a client can never assert its own clearance in the
    # request body. ``require_auth`` (set REQUIRE_AUTH=1) rejects any /query without a
    # valid token; left off by default so the dev/mock flow keeps working.
    auth_secret: str = "tessera-dev-secret-change-me-in-production"
    auth_token_ttl_seconds: int = 28800  # 8h — a demo/work session
    require_auth: bool = False

    # Arize observability (optional). Without keys, decisions are logged to stdout.
    arize_api_key: str = ""
    arize_space_key: str = ""
    arize_model_id: str = "orgcache-decisions"

    # Sentry — observability for the cognition pipeline + AI-governance events.
    # Leave SENTRY_DSN empty to disable: all telemetry calls become no-ops.
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 1.0
    sentry_profiles_sample_rate: float = 0.0
    # Boundary-probe alerting: N attempts on gated content within the window -> issue.
    probe_window_seconds: int = 120
    probe_threshold: int = 3

    # CORS — comma-separated list of allowed origins. Defaults to "*" (open) for local
    # dev; set CORS_ORIGINS in production to lock down to the dashboard URL(s).
    cors_origins: str = "*"

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if not raw or raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    def cache_ttl_for(self, level: str) -> int:
        """TTL (seconds) for a cache entry given its ACL sensitivity level.

        Returns 0 (no expiry) for unknown levels and any tier explicitly set to 0.
        """
        return {
            "public": self.cache_ttl_public,
            "employee": self.cache_ttl_employee,
            "manager": self.cache_ttl_manager,
            "exec": self.cache_ttl_exec,
        }.get((level or "public").lower(), self.cache_ttl_public)


@lru_cache
def get_settings() -> Settings:
    return Settings()
