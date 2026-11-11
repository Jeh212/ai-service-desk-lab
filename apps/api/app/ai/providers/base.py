"""Provider-agnostic LLM interface.

The business/orchestration code depends ONLY on these types, never on `groq`
or any vendor SDK. Swapping providers (mock <-> groq <-> future) changes one
factory function, nothing else.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class LLMMessage:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str | None = None
    # For assistant messages that requested tools:
    tool_calls: list[LLMToolCall] = field(default_factory=list)
    # For tool-result messages:
    tool_call_id: str | None = None
    name: str | None = None


@dataclass
class LLMToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolSpec:
    """A tool definition handed to the model as JSON Schema."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema object

    def to_openai_tool(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


@dataclass
class LLMUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class LLMResponse:
    text: str | None
    tool_calls: list[LLMToolCall] = field(default_factory=list)
    usage: LLMUsage = field(default_factory=LLMUsage)
    finish_reason: str = "stop"
    model: str = ""


class LLMError(Exception):
    """Raised by providers for transport/transient failures (mapped upstream)."""

    def __init__(
        self, message: str, *, kind: str = "provider_error", retry_after: float | None = None
    ):
        super().__init__(message)
        self.kind = kind  # "provider_error" | "timeout" | "rate_limited"
        self.retry_after = retry_after


@runtime_checkable
class LLMProvider(Protocol):
    name: str
    model: str

    async def chat(
        self,
        messages: list[LLMMessage],
        *,
        tools: list[ToolSpec] | None = None,
        json_object: bool = False,
        temperature: float | None = None,
        max_tokens: int | None = None,
        model: str | None = None,
    ) -> LLMResponse:
        """One chat turn. May return text and/or tool calls."""
        ...
