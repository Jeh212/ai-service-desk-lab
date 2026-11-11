"""Single place that chooses the active LLM provider from configuration."""

from __future__ import annotations

from app.ai.providers.base import LLMProvider
from app.ai.providers.mock import MockLLMProvider
from app.core.config import Settings


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "groq":
        from app.ai.providers.groq_provider import GroqLLMProvider

        return GroqLLMProvider(settings)
    return MockLLMProvider()
