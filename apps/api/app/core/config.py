"""Central application settings.

All configuration is read from environment variables (or a .env file) via
pydantic-settings. No model identifiers, URLs or credentials are hardcoded in
the business code — they flow through this single object.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),  # api-local .env, then repo-root .env
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Runtime
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_json: bool = False

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:3000"

    # MongoDB
    mongo_uri: str = "mongodb://root:example@localhost:27017/?authSource=admin"
    mongo_db: str = "ai_service_desk"

    # LLM provider selection
    llm_provider: Literal["mock", "groq"] = "mock"

    # Groq
    groq_api_key: str | None = None
    groq_model: str = "llama-3.1-8b-instant"
    groq_structured_model: str = "openai/gpt-oss-20b"

    # Shared LLM tuning
    llm_temperature: float = 0.1
    llm_max_tokens: int = 1024
    llm_timeout_seconds: float = 30.0
    llm_max_tool_iterations: int = 5
    llm_history_window: int = 10
    llm_max_retries: int = 2

    # Evaluation
    eval_concurrency: int = 2

    # Demo auth
    demo_auth_secret: str = "change-me-dev-only-secret"
    demo_session_ttl_minutes: int = 720

    @field_validator("cors_origins")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    def require_groq_key(self) -> str:
        if not self.groq_api_key:
            raise RuntimeError(
                "LLM_PROVIDER=groq but GROQ_API_KEY is not set. "
                "Add it to .env or switch LLM_PROVIDER=mock."
            )
        return self.groq_api_key


@lru_cache
def get_settings() -> Settings:
    """Cached singleton. Tests can clear it with get_settings.cache_clear()."""
    return Settings()
