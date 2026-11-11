"""Deterministic mock LLM provider.

It emulates two model behaviours the orchestrator relies on:

1. JSON classification (`json_object=True`): returns an IntentClassification-
   shaped dict using keyword heuristics.
2. Tool-calling agent loop: emits the next tool call for the detected intent
   based on which tools already produced results in the message history, then
   a final text answer when the plan is complete.

Because it is deterministic, tests assert exact behaviour without a network.
The crucial safety property is baked in: the mock NEVER has (and never emits)
an "execute cancellation" tool — it can only PREPARE one.
"""

from __future__ import annotations

import json
import uuid

from app.ai.intents.heuristics import classify
from app.ai.providers.base import (
    LLMMessage,
    LLMResponse,
    LLMToolCall,
    LLMUsage,
    ToolSpec,
)
from app.ai.tools import names
from app.contracts.intent import AssistantIntent

# Ordered tool plan per intent (what a well-behaved model would do).
_PLAN: dict[AssistantIntent, list[str]] = {
    AssistantIntent.GET_SUBSCRIPTION: [names.GET_SUBSCRIPTION],
    AssistantIntent.CANCELLATION_INFO: [names.GET_CANCELLATION_POLICY],
    AssistantIntent.CANCEL_SUBSCRIPTION: [
        names.GET_SUBSCRIPTION,
        names.PREPARE_CANCELLATION,
    ],
    AssistantIntent.BILLING_QUESTION: [names.GET_BILLING_HISTORY],
    AssistantIntent.REQUEST_REFUND: [names.REQUEST_HUMAN_REVIEW],
    AssistantIntent.GENERAL_SUPPORT: [names.SEARCH_KNOWLEDGE_BASE],
    AssistantIntent.OTHER: [],
}

_FINAL_TEXT: dict[AssistantIntent, str] = {
    AssistantIntent.GET_SUBSCRIPTION: "Here are the details of your subscription.",
    AssistantIntent.CANCELLATION_INFO: (
        "Here is how cancellation works under your plan's policy. "
        "Let me know if you'd like to go ahead and cancel."
    ),
    AssistantIntent.CANCEL_SUBSCRIPTION: (
        "I've prepared the cancellation with the exact terms. Please review and confirm to proceed."
    ),
    AssistantIntent.BILLING_QUESTION: "Here is your recent billing history.",
    AssistantIntent.REQUEST_REFUND: (
        "I've routed your refund request to a human specialist who will review it."
    ),
    AssistantIntent.GENERAL_SUPPORT: "Here's what I found that should help.",
    AssistantIntent.OTHER: (
        "I'm not sure I can help with that. Could you rephrase, or I can connect "
        "you with a human agent?"
    ),
}


class MockLLMProvider:
    name = "mock"

    def __init__(self, model: str = "mock-rules-v1") -> None:
        self.model = model

    # -- helpers --------------------------------------------------------------

    @staticmethod
    def _last_user_text(messages: list[LLMMessage]) -> str:
        # The *last* user message is the real query. Earlier user messages may be
        # few-shot examples (classification) or prior turns (agent loop).
        for m in reversed(messages):
            if m.role == "user" and m.content:
                return m.content
        return ""

    @staticmethod
    def _executed_tools(messages: list[LLMMessage]) -> list[str]:
        executed = []
        for m in messages:
            if m.role == "tool" and m.name:
                executed.append(m.name)
        return executed

    @staticmethod
    def _find_subscription_id(messages: list[LLMMessage]) -> str | None:
        for m in messages:
            if m.role == "tool" and m.content:
                try:
                    payload = json.loads(m.content)
                except (json.JSONDecodeError, TypeError):
                    continue
                data = payload.get("data") if isinstance(payload, dict) else None
                if isinstance(data, dict) and data.get("subscription_id"):
                    return data["subscription_id"]
        return None

    # -- provider interface ---------------------------------------------------

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
        user_text = self._last_user_text(messages)
        intent, needs_clarification, rationale = classify(user_text)
        usage = LLMUsage(prompt_tokens=42, completion_tokens=16, total_tokens=58)

        # 1) Classification request.
        if json_object:
            payload = {
                "intent": intent.value,
                "needs_clarification": needs_clarification,
                "rationale": rationale,
                "confidence": 0.9 if not needs_clarification else 0.5,
            }
            return LLMResponse(
                text=json.dumps(payload),
                usage=usage,
                finish_reason="stop",
                model=self.model,
            )

        # 2) Agent loop with tools.
        if tools:
            plan = _PLAN.get(intent, [])
            available = {t.name for t in tools}
            executed = self._executed_tools(messages)
            for tool_name in plan:
                if tool_name in executed or tool_name not in available:
                    continue
                args = self._args_for(tool_name, intent, user_text, messages)
                return LLMResponse(
                    text=None,
                    tool_calls=[
                        LLMToolCall(
                            id=f"call_{uuid.uuid4().hex[:8]}",
                            name=tool_name,
                            arguments=args,
                        )
                    ],
                    usage=usage,
                    finish_reason="tool_calls",
                    model=self.model,
                )

        # 3) Final answer.
        return LLMResponse(
            text=_FINAL_TEXT.get(intent, _FINAL_TEXT[AssistantIntent.OTHER]),
            usage=usage,
            finish_reason="stop",
            model=self.model,
        )

    def _args_for(
        self,
        tool_name: str,
        intent: AssistantIntent,
        user_text: str,
        messages: list[LLMMessage],
    ) -> dict:
        if tool_name == names.PREPARE_CANCELLATION:
            sub_id = self._find_subscription_id(messages)
            return {"subscription_id": sub_id} if sub_id else {}
        if tool_name == names.REQUEST_HUMAN_REVIEW:
            return {
                "reason": "refund_request",
                "summary": f"Customer requested a refund: {user_text[:200]}",
            }
        if tool_name == names.GET_BILLING_HISTORY:
            return {"limit": 10}
        if tool_name == names.SEARCH_KNOWLEDGE_BASE:
            return {"query": user_text[:120]}
        return {}
