"""Intent heuristics: the critical info-vs-action distinction."""

from __future__ import annotations

import pytest

from app.ai.intents.heuristics import classify
from app.contracts.intent import AssistantIntent


@pytest.mark.parametrize(
    "text,expected",
    [
        ("How do I cancel my plan?", AssistantIntent.CANCELLATION_INFO),
        ("What happens if I cancel?", AssistantIntent.CANCELLATION_INFO),
        ("Como funciona o cancelamento?", AssistantIntent.CANCELLATION_INFO),
        ("I want to cancel my subscription now", AssistantIntent.CANCEL_SUBSCRIPTION),
        ("Please cancel my plan today", AssistantIntent.CANCEL_SUBSCRIPTION),
        ("Quero cancelar minha assinatura agora", AssistantIntent.CANCEL_SUBSCRIPTION),
        ("I'd like a refund", AssistantIntent.REQUEST_REFUND),
        ("Quero um reembolso", AssistantIntent.REQUEST_REFUND),
        ("What plan am I on?", AssistantIntent.GET_SUBSCRIPTION),
        ("Why was I charged twice?", AssistantIntent.BILLING_QUESTION),
        ("Hello", AssistantIntent.OTHER),
    ],
)
def test_classification(text, expected):
    intent, _, _ = classify(text)
    assert intent == expected


def test_bare_cancel_is_ambiguous():
    intent, needs_clarification, _ = classify("cancel")
    assert intent == AssistantIntent.CANCELLATION_INFO
    assert needs_clarification is True


def test_mixed_question_and_action_prefers_info():
    # "cancel now but how does it work" must NOT be treated as an action.
    intent, _, _ = classify("I want to cancel now but first, how does it work?")
    assert intent == AssistantIntent.CANCELLATION_INFO
