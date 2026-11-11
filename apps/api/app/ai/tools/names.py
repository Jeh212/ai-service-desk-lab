"""Canonical tool names (avoid magic strings across registry, mock and evals)."""

GET_SUBSCRIPTION = "get_subscription"
GET_CANCELLATION_POLICY = "get_cancellation_policy"
GET_BILLING_HISTORY = "get_billing_history"
PREPARE_CANCELLATION = "prepare_cancellation"
REQUEST_HUMAN_REVIEW = "request_human_review"
SEARCH_KNOWLEDGE_BASE = "search_knowledge_base"

ALL = [
    GET_SUBSCRIPTION,
    GET_CANCELLATION_POLICY,
    GET_BILLING_HISTORY,
    PREPARE_CANCELLATION,
    REQUEST_HUMAN_REVIEW,
    SEARCH_KNOWLEDGE_BASE,
]
