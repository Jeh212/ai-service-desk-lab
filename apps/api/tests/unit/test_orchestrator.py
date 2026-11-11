"""Orchestrator end-to-end behaviour with the mock provider."""

from __future__ import annotations

from app.ai.orchestrator import Orchestrator
from app.ai.providers.base import LLMError
from app.ai.tools.registry import build_registry
from app.contracts.assistant import AssistantState
from app.contracts.intent import AssistantIntent
from app.contracts.messages import ChatMessageInput
from app.core.config import get_settings
from app.domain.models import SubscriptionStatus
from app.seeds import SUB_ALICE


async def test_info_does_not_mutate(orchestrator: Orchestrator, alice):
    resp = await orchestrator.handle_message(alice, ChatMessageInput(message="How do I cancel?"))
    assert resp.intent.intent == AssistantIntent.CANCELLATION_INFO
    assert resp.state == AssistantState.ANSWERED
    assert resp.proposal is None


async def test_cancel_prepares_and_confirm_executes(orchestrator: Orchestrator, services, alice):
    resp = await orchestrator.handle_message(
        alice, ChatMessageInput(message="I want to cancel my subscription now")
    )
    assert resp.state == AssistantState.AWAITING_CONFIRMATION
    assert resp.proposal is not None

    confirmed = await orchestrator.confirm(
        alice, resp.conversation_id, resp.proposal.proposal_id, confirm=True
    )
    assert confirmed.state == AssistantState.ACTION_COMPLETED
    assert confirmed.cancellation_result is not None
    sub = await services.repos.subscriptions.get(alice.org_id, SUB_ALICE)
    assert sub.status == SubscriptionStatus.CANCELLED


async def test_decline_confirmation_keeps_subscription(orchestrator: Orchestrator, services, alice):
    resp = await orchestrator.handle_message(
        alice, ChatMessageInput(message="cancel my subscription now")
    )
    declined = await orchestrator.confirm(
        alice, resp.conversation_id, resp.proposal.proposal_id, confirm=False
    )
    assert declined.state == AssistantState.ANSWERED
    sub = await services.repos.subscriptions.get(alice.org_id, SUB_ALICE)
    assert sub.status == SubscriptionStatus.ACTIVE


async def test_refund_routes_to_human(orchestrator: Orchestrator, alice):
    resp = await orchestrator.handle_message(alice, ChatMessageInput(message="I want a refund"))
    assert resp.state == AssistantState.HUMAN_REVIEW
    assert resp.review_id is not None


async def test_provider_failure_is_safe(services, alice):
    class FailingProvider:
        name = "failing"
        model = "x"

        async def chat(self, *a, **k):
            raise LLMError("boom", kind="timeout")

    orch = Orchestrator(FailingProvider(), build_registry(), services, get_settings())
    resp = await orch.handle_message(alice, ChatMessageInput(message="I want to cancel now"))
    assert resp.state == AssistantState.ERROR
    assert resp.proposal is None
