"""Contract validation: structural vs. semantic vs. business-rule layers."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.ai.tools.schemas import GetBillingHistoryArgs, RequestHumanReviewArgs
from app.contracts.intent import AssistantIntent, IntentClassification


def test_valid_intent_classification():
    c = IntentClassification(intent="cancel_subscription", needs_clarification=False)
    assert c.intent is AssistantIntent.CANCEL_SUBSCRIPTION
    assert c.is_mutating_intent is True
    assert c.contract_version


def test_invalid_intent_value_rejected():
    with pytest.raises(ValidationError):
        IntentClassification(intent="delete_everything")


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        IntentClassification(intent="other", surprise="x")


def test_confidence_bounds():
    with pytest.raises(ValidationError):
        IntentClassification(intent="other", confidence=1.5)


def test_tool_args_structural_validation():
    # limit out of allowed range -> structural/field validation fails.
    with pytest.raises(ValidationError):
        GetBillingHistoryArgs(limit=999)
    # extra field forbidden
    with pytest.raises(ValidationError):
        RequestHumanReviewArgs(reason="refund_request", summary="x", extra="y")


def test_tool_args_json_schema_is_closed():
    schema = GetBillingHistoryArgs.json_schema()
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
