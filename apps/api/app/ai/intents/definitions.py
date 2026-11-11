"""Versioned, human-readable intent definitions.

These semantic descriptions are the single source of truth for the taxonomy.
They are injected into the classification prompt and shown in the lab's Intent
Explorer. Edit them here — never inline in a prompt string elsewhere.
"""

from __future__ import annotations

from app.contracts.intent import AssistantIntent

INTENT_DEFINITIONS_VERSION = "2024-11-a"

INTENT_DEFINITIONS: dict[AssistantIntent, str] = {
    AssistantIntent.GET_SUBSCRIPTION: (
        "The user wants to see details or status of their own subscription or plan "
        "(e.g. 'what plan am I on?', 'when does my subscription renew?')."
    ),
    AssistantIntent.CANCELLATION_INFO: (
        "The user is ASKING ABOUT how cancellation works, the policy, notice periods "
        "or consequences. This is a QUESTION, not a request to cancel now "
        "(e.g. 'how do I cancel?', 'what happens if I cancel?')."
    ),
    AssistantIntent.CANCEL_SUBSCRIPTION: (
        "The user is explicitly requesting to cancel their subscription NOW "
        "(e.g. 'cancel my plan', 'I want to cancel today'). This is an ACTION request."
    ),
    AssistantIntent.REQUEST_REFUND: (
        "The user wants money back for a past charge (e.g. 'I want a refund', "
        "'please refund my last payment'). Refunds always route to human review."
    ),
    AssistantIntent.BILLING_QUESTION: (
        "The user has a question about charges, invoices or payment history "
        "(e.g. 'why was I charged $x?', 'show my last invoices')."
    ),
    AssistantIntent.GENERAL_SUPPORT: (
        "A general product/support question answerable from the knowledge base "
        "that does not fit the more specific intents."
    ),
    AssistantIntent.OTHER: ("Out of scope, greetings, or anything that does not match the above."),
}


def definitions_for_prompt() -> str:
    lines = []
    for intent, desc in INTENT_DEFINITIONS.items():
        lines.append(f"- {intent.value}: {desc}")
    return "\n".join(lines)
