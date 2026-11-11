"""Deterministic keyword heuristics for the MOCK provider.

This is intentionally simple and explainable. It is NOT used for the real Groq
path (the model classifies there). It lets the whole system — including the
critical "cancellation question vs. cancellation request" distinction — run
and be tested offline.

Supports English and Portuguese cues, matching the bilingual lab.
"""

from __future__ import annotations

import re

from app.contracts.intent import AssistantIntent

# Phrases that signal an explicit ACTION ("do it now").
_ACTION_CUES = [
    "quero cancelar",
    "cancele",
    "cancela minha",
    "cancelar minha assinatura agora",
    "cancelar agora",
    "cancel my",
    "cancel now",
    "please cancel",
    "i want to cancel",
    "want to cancel",
    "go ahead and cancel",
]

# Phrases that signal an INFORMATIONAL question.
_QUESTION_CUES = [
    "como",
    "how",
    "what",
    "qual",
    "por que",
    "why",
    "?",
    "funciona",
    "policy",
    "política",
]

_REFUND = ["reembolso", "refund", "money back", "estorno", "devolv"]
_BILLING = ["cobran", "fatura", "invoice", "charge", "billing", "cobrado", "pagamento", "payment"]
_SUBSCRIPTION = ["assinatura", "subscription", "plano", "plan", "renova", "renew"]
_CANCEL = ["cancel"]


def _has(text: str, needles: list[str]) -> bool:
    return any(n in text for n in needles)


def classify(text: str) -> tuple[AssistantIntent, bool, str]:
    """Return (intent, needs_clarification, rationale)."""
    t = text.lower().strip()

    if not t or len(t) < 2:
        return AssistantIntent.OTHER, True, "Empty or too short to classify."

    has_cancel = _has(t, _CANCEL) or "cancelar" in t
    has_action = _has(t, _ACTION_CUES)
    has_question = _has(t, _QUESTION_CUES)

    # Refund takes precedence — it has its own safety routing.
    if _has(t, _REFUND):
        return AssistantIntent.REQUEST_REFUND, False, "Mentions a refund/estorno."

    if has_cancel:
        if has_action and not re.search(r"\bhow\b|\bcomo\b", t):
            return (
                AssistantIntent.CANCEL_SUBSCRIPTION,
                False,
                "Explicit request to cancel now.",
            )
        if has_question:
            return (
                AssistantIntent.CANCELLATION_INFO,
                False,
                "Asking how cancellation works (informational).",
            )
        # Ambiguous: 'cancel' without a clear action or question cue.
        return (
            AssistantIntent.CANCELLATION_INFO,
            True,
            "Ambiguous cancellation mention; defaulting to info and flagging clarification.",
        )

    if _has(t, _BILLING):
        return AssistantIntent.BILLING_QUESTION, False, "Mentions billing/charges."

    if _has(t, _SUBSCRIPTION):
        return AssistantIntent.GET_SUBSCRIPTION, False, "Asks about subscription/plan."

    if has_question:
        return AssistantIntent.GENERAL_SUPPORT, False, "General support question."

    return AssistantIntent.OTHER, False, "No specific intent matched."
