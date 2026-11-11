"""Cancellation proposal + confirmation contracts.

The proposal is created by the *backend* (deterministic rules), not the model.
It is short-lived, bound to one user + subscription, single-use, and must be
confirmed explicitly before the backend performs the cancellation.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from app.contracts.common import CONTRACT_VERSION, Contract


class ProposalStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    EXECUTED = "executed"
    EXPIRED = "expired"
    ABANDONED = "abandoned"


class CancellationTerms(Contract):
    """Deterministic terms computed by the domain from policy + subscription."""

    effective_date: datetime = Field(description="When the cancellation takes effect.")
    refund_amount_cents: int = Field(ge=0, default=0)
    currency: str = "USD"
    retains_access_until: datetime | None = None
    penalty_cents: int = Field(ge=0, default=0)
    policy_id: str
    policy_version: int
    summary: str = Field(description="Human-readable explanation of the terms.")


class CancellationProposal(Contract):
    """A pending, single-use proposal the customer must confirm."""

    proposal_id: str
    org_id: str
    user_id: str
    subscription_id: str
    status: ProposalStatus = ProposalStatus.PENDING
    terms: CancellationTerms
    created_at: datetime
    expires_at: datetime
    contract_version: str = CONTRACT_VERSION

    def is_expired(self, now: datetime) -> bool:
        return now >= self.expires_at


class CancellationResult(Contract):
    """The official outcome after the backend executes the cancellation."""

    proposal_id: str
    subscription_id: str
    status: str
    effective_date: datetime
    refund_amount_cents: int
    audit_id: str
    executed_at: datetime
