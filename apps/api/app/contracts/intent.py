"""Intent classification contracts.

The semantic *descriptions* of each intent live in a versioned file
(app/ai/intents/definitions.py) — not scattered as prompt strings. This keeps
the taxonomy reviewable and lets us evolve the prompt without touching code.
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from app.contracts.common import CONTRACT_VERSION, Contract


class AssistantIntent(str, Enum):
    GET_SUBSCRIPTION = "get_subscription"
    CANCELLATION_INFO = "cancellation_info"
    CANCEL_SUBSCRIPTION = "cancel_subscription"
    REQUEST_REFUND = "request_refund"
    BILLING_QUESTION = "billing_question"
    GENERAL_SUPPORT = "general_support"
    OTHER = "other"


class IntentClassification(Contract):
    """Structured output the model must produce for the classification step."""

    intent: AssistantIntent = Field(
        description="The single best-matching intent for the latest user message.",
    )
    needs_clarification: bool = Field(
        default=False,
        description="True when the message is too ambiguous to act on safely.",
    )
    rationale: str = Field(
        default="",
        max_length=400,
        description="One short sentence explaining the classification.",
    )
    confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Model-estimated confidence in [0,1]. Advisory only.",
    )
    contract_version: str = CONTRACT_VERSION

    @property
    def is_mutating_intent(self) -> bool:
        """Intents that could trigger a state change need extra guardrails."""
        return self.intent in {
            AssistantIntent.CANCEL_SUBSCRIPTION,
            AssistantIntent.REQUEST_REFUND,
        }
