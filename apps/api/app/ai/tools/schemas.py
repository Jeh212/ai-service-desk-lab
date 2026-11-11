"""Per-tool argument schemas (Pydantic) + JSON Schema generation for the model.

The same Pydantic model does double duty: it generates the JSON Schema we send
to the LLM AND it validates the arguments the LLM returns, in the backend,
before any handler runs. JSON that parses is not the same as arguments that are
valid — validation happens here regardless of what the provider claims.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @classmethod
    def json_schema(cls) -> dict[str, Any]:
        schema = cls.model_json_schema()
        schema.setdefault("type", "object")
        schema["additionalProperties"] = False
        schema.pop("title", None)
        return schema


class GetSubscriptionArgs(ToolArgs):
    subscription_id: str | None = Field(
        default=None,
        description="Optional subscription id. If omitted, the caller's active one is used.",
    )


class EmptyArgs(ToolArgs):
    pass


class GetBillingHistoryArgs(ToolArgs):
    limit: int = Field(default=10, ge=1, le=50, description="Max number of charges to return.")


class PrepareCancellationArgs(ToolArgs):
    subscription_id: str | None = Field(
        default=None,
        description="Subscription to cancel. If omitted, the caller's active one is used.",
    )


class RequestHumanReviewArgs(ToolArgs):
    reason: str = Field(
        description="One of: refund_request, policy_exception, inconsistent_data, "
        "approval_required, eligibility_uncertain.",
    )
    summary: str = Field(max_length=1000, description="Why this needs a human.")


class SearchKnowledgeArgs(ToolArgs):
    query: str = Field(min_length=2, max_length=300)
    category: str | None = Field(default=None, description="Optional category filter.")
