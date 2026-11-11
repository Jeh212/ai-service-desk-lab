"""Versioned prompt library.

Prompts are data, not strings scattered through the code. Each prompt has a
version so traces/eval reports can record exactly which text produced a result,
and the Prompt Playground can compare two versions on the same cases.
"""

from __future__ import annotations

from app.ai.intents.definitions import definitions_for_prompt
from app.ai.providers.base import LLMMessage

DEFAULT_SYSTEM_VERSION = "system-v2"
DEFAULT_CLASSIFIER_VERSION = "classify-v2"

_SYSTEM_PROMPTS: dict[str, str] = {
    "system-v1": (
        "You are the AI assistant for a SaaS service desk. Help customers with "
        "subscriptions, billing and cancellations. Use the provided tools to fetch "
        "data. Never make up account details."
    ),
    "system-v2": (
        "You are the AI assistant for a SaaS company's service desk.\n"
        "Rules you must always follow:\n"
        "1. Only use the provided tools to read or change account data. Never invent "
        "subscription, billing or policy details.\n"
        "2. To cancel a subscription you may only PREPARE a cancellation "
        "(prepare_cancellation). You must NOT and CANNOT execute the final "
        "cancellation yourself — the customer confirms it and the backend performs it.\n"
        "3. Answering a question about how cancellation works is NOT a request to "
        "cancel. Do not prepare a cancellation for an informational question.\n"
        "4. Refund requests and anything you are unsure is eligible must be routed to a "
        "human with request_human_review. Never promise a refund yourself.\n"
        "5. Be concise, accurate and explain the terms you retrieved.\n"
        "6. If a tool returns an error, explain it plainly and never pretend the action "
        "succeeded."
    ),
}

_CLASSIFIER_PROMPTS: dict[str, str] = {
    "classify-v1": (
        "Classify the user's latest message into one intent. Respond with JSON "
        '{{"intent": ..., "needs_clarification": bool, "rationale": str}}.\n'
        "Intents:\n{definitions}"
    ),
    "classify-v2": (
        "You are an intent classifier for a SaaS service desk.\n"
        "Classify ONLY the user's latest message into exactly one intent.\n\n"
        "Intents:\n{definitions}\n\n"
        "Critical distinction: an informational QUESTION about cancellation "
        "(cancellation_info) is different from an explicit REQUEST to cancel now "
        "(cancel_subscription). When unsure, prefer the informational intent and set "
        "needs_clarification=true.\n\n"
        "Respond with ONLY a JSON object with keys: intent (one of the values above), "
        "needs_clarification (boolean), rationale (short string), confidence (0..1)."
    ),
}

# Few-shot examples steer the classifier on the hardest boundary.
_CLASSIFIER_FEWSHOT: list[tuple[str, str]] = [
    ("How does cancellation work?", "cancellation_info"),
    ("What happens if I cancel my plan?", "cancellation_info"),
    ("I want to cancel my subscription now", "cancel_subscription"),
    ("Please cancel my plan today", "cancel_subscription"),
    ("I'd like a refund for last month", "request_refund"),
    ("What plan am I on?", "get_subscription"),
    ("Why was I charged twice?", "billing_question"),
]


def system_prompt(version: str = DEFAULT_SYSTEM_VERSION) -> str:
    return _SYSTEM_PROMPTS.get(version, _SYSTEM_PROMPTS[DEFAULT_SYSTEM_VERSION])


def available_system_versions() -> list[str]:
    return list(_SYSTEM_PROMPTS.keys())


def available_classifier_versions() -> list[str]:
    return list(_CLASSIFIER_PROMPTS.keys())


def build_classification_messages(
    user_text: str, version: str = DEFAULT_CLASSIFIER_VERSION
) -> list[LLMMessage]:
    template = _CLASSIFIER_PROMPTS.get(version, _CLASSIFIER_PROMPTS[DEFAULT_CLASSIFIER_VERSION])
    system = template.format(definitions=definitions_for_prompt())
    messages = [LLMMessage(role="system", content=system)]
    for example_in, example_out in _CLASSIFIER_FEWSHOT:
        messages.append(LLMMessage(role="user", content=example_in))
        messages.append(
            LLMMessage(
                role="assistant",
                content=(
                    f'{{"intent": "{example_out}", "needs_clarification": false, '
                    f'"rationale": "example", "confidence": 0.95}}'
                ),
            )
        )
    messages.append(LLMMessage(role="user", content=user_text))
    return messages
