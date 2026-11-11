"""The assistant's final response contract returned to the frontend."""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from app.contracts.cancellation import CancellationProposal, CancellationResult
from app.contracts.common import CONTRACT_VERSION, Contract
from app.contracts.intent import IntentClassification


class AssistantState(str, Enum):
    ANSWERED = "answered"  # normal informational answer
    NEEDS_CLARIFICATION = "needs_clarification"
    AWAITING_CONFIRMATION = "awaiting_confirmation"  # a proposal is pending
    ACTION_COMPLETED = "action_completed"
    HUMAN_REVIEW = "human_review"  # routed to a person
    ERROR = "error"  # safe, explained failure


class TraceStepView(Contract):
    """A compact view of one pipeline step, surfaced to the lab UI."""

    step: str
    status: str
    duration_ms: float
    detail: str | None = None


class AssistantResponse(Contract):
    """Everything the chat UI needs to render one assistant turn."""

    conversation_id: str
    correlation_id: str
    state: AssistantState
    message: str = Field(description="Natural-language reply shown to the customer.")
    intent: IntentClassification | None = None
    proposal: CancellationProposal | None = None
    cancellation_result: CancellationResult | None = None
    review_id: str | None = None
    error_code: str | None = None
    trace: list[TraceStepView] = Field(default_factory=list)
    contract_version: str = CONTRACT_VERSION
