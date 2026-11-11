"""Real GroqCloud provider using the official async `groq` SDK.

Implements the pieces the brief requires: timeout, limited exponential backoff
on HTTP 429 (honouring Retry-After), token accounting, and normalization of the
response into the provider-agnostic LLMResponse. Structured JSON and tool
calling are issued as *separate* requests by the orchestrator — we never assume
strict structured outputs and tool calling combine in one call.
"""

from __future__ import annotations

import asyncio
import json

from app.ai.providers.base import (
    LLMError,
    LLMMessage,
    LLMResponse,
    LLMToolCall,
    LLMUsage,
    ToolSpec,
)
from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger("ai.groq")


class GroqLLMProvider:
    name = "groq"

    def __init__(self, settings: Settings) -> None:
        # Imported lazily so the package is only needed when actually using Groq.
        from groq import AsyncGroq

        self._settings = settings
        self.model = settings.groq_model
        self._client = AsyncGroq(
            api_key=settings.require_groq_key(),
            timeout=settings.llm_timeout_seconds,
            max_retries=0,  # we implement our own bounded retry policy
        )

    @staticmethod
    def _to_provider_messages(messages: list[LLMMessage]) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            if m.role == "tool":
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": m.tool_call_id,
                        "name": m.name,
                        "content": m.content or "",
                    }
                )
            elif m.role == "assistant" and m.tool_calls:
                out.append(
                    {
                        "role": "assistant",
                        "content": m.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": json.dumps(tc.arguments),
                                },
                            }
                            for tc in m.tool_calls
                        ],
                    }
                )
            else:
                out.append({"role": m.role, "content": m.content or ""})
        return out

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
        kwargs: dict = {
            "model": model or self.model,
            "messages": self._to_provider_messages(messages),
            "temperature": (self._settings.llm_temperature if temperature is None else temperature),
            "max_tokens": max_tokens or self._settings.llm_max_tokens,
        }
        if json_object:
            kwargs["response_format"] = {"type": "json_object"}
        if tools:
            kwargs["tools"] = [t.to_openai_tool() for t in tools]
            kwargs["tool_choice"] = "auto"

        completion = await self._call_with_retry(kwargs)
        return self._normalize(completion, kwargs["model"])

    async def _call_with_retry(self, kwargs: dict):
        from groq import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

        attempt = 0
        max_retries = self._settings.llm_max_retries
        while True:
            try:
                return await self._client.chat.completions.create(**kwargs)
            except RateLimitError as exc:
                retry_after = _retry_after_seconds(exc) or (2**attempt)
                if attempt >= max_retries:
                    raise LLMError(
                        "Groq rate limit exceeded.", kind="rate_limited", retry_after=retry_after
                    ) from exc
                logger.warning("Groq 429; backing off %.1fs (attempt %d)", retry_after, attempt + 1)
                await asyncio.sleep(min(retry_after, 10))
                attempt += 1
            except APITimeoutError as exc:
                raise LLMError("Groq request timed out.", kind="timeout") from exc
            except (APIConnectionError, APIStatusError) as exc:
                if attempt >= max_retries:
                    raise LLMError(f"Groq provider error: {exc}", kind="provider_error") from exc
                await asyncio.sleep(2**attempt)
                attempt += 1

    @staticmethod
    def _normalize(completion, model: str) -> LLMResponse:
        choice = completion.choices[0]
        msg = choice.message
        tool_calls: list[LLMToolCall] = []
        for tc in getattr(msg, "tool_calls", None) or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"__raw__": tc.function.arguments}
            tool_calls.append(LLMToolCall(id=tc.id, name=tc.function.name, arguments=args))

        usage = LLMUsage()
        if completion.usage:
            usage = LLMUsage(
                prompt_tokens=completion.usage.prompt_tokens or 0,
                completion_tokens=completion.usage.completion_tokens or 0,
                total_tokens=completion.usage.total_tokens or 0,
            )
        return LLMResponse(
            text=msg.content,
            tool_calls=tool_calls,
            usage=usage,
            finish_reason=choice.finish_reason or "stop",
            model=model,
        )


def _retry_after_seconds(exc) -> float | None:
    try:
        resp = getattr(exc, "response", None)
        if resp is not None:
            val = resp.headers.get("retry-after")
            if val:
                return float(val)
    except (ValueError, AttributeError):
        pass
    return None
