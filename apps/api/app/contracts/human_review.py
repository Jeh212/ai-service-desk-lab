"""Human-in-the-loop review contracts."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from app.contracts.common import Contract


class ReviewReason(str, Enum):
    REFUND_REQUEST = "refund_request"
    POLICY_EXCEPTION = "policy_exception"
    INCONSISTENT_DATA = "inconsistent_data"
    APPROVAL_REQUIRED = "approval_required"
    ELIGIBILITY_UNCERTAIN = "eligibility_uncertain"


class ReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class HumanReviewRequest(Contract):
    """A case routed to the human queue."""

    review_id: str
    org_id: str
    user_id: str
    conversation_id: str | None = None
    reason: ReviewReason
    summary: str = Field(max_length=1000)
    context: dict = Field(default_factory=dict)
    status: ReviewStatus = ReviewStatus.PENDING
    created_at: datetime
    decided_at: datetime | None = None
    decided_by: str | None = None
    decision_note: str | None = None


class ReviewDecisionInput(Contract):
    """What a staff member submits to resolve a review."""

    approve: bool
    note: str = Field(default="", max_length=1000)
