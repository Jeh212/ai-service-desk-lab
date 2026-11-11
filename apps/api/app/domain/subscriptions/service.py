"""Subscription + cancellation domain logic.

This is the deterministic core the brief cares most about: the LLM may ASK for
these operations, but every rule, every number and the final cancellation are
computed and enforced here, in plain Python, scoped to the authenticated tenant.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from app.contracts.cancellation import (
    CancellationProposal,
    CancellationResult,
    CancellationTerms,
    ProposalStatus,
)
from app.core.clock import utcnow
from app.core.context import AuthContext
from app.core.errors import AppError, ErrorCode
from app.domain.models import AuditLog, Subscription, SubscriptionStatus
from app.repositories.repos import Repositories

PROPOSAL_TTL_MINUTES = 15


class SubscriptionService:
    def __init__(self, repos: Repositories) -> None:
        self._repos = repos

    async def get_for_user(self, auth: AuthContext, subscription_id: str | None) -> Subscription:
        """Return a subscription owned by the authenticated user, or raise."""
        if subscription_id:
            sub = await self._repos.subscriptions.get(auth.org_id, subscription_id)
            if sub is None:
                raise AppError(
                    ErrorCode.SUBSCRIPTION_NOT_FOUND,
                    "That subscription was not found.",
                    detail={"subscription_id": subscription_id},
                )
            # Ownership check: even within the org, you only see your own.
            if sub.user_id != auth.user_id and not auth.is_staff:
                raise AppError(
                    ErrorCode.CROSS_TENANT_ACCESS,
                    "You are not allowed to access this subscription.",
                )
            return sub

        subs = await self._repos.subscriptions.for_user(auth.org_id, auth.user_id)
        active = [s for s in subs if s.status == SubscriptionStatus.ACTIVE]
        chosen = active[0] if active else (subs[0] if subs else None)
        if chosen is None:
            raise AppError(
                ErrorCode.SUBSCRIPTION_NOT_FOUND,
                "You don't have a subscription on file.",
            )
        return chosen


class CancellationService:
    def __init__(self, repos: Repositories) -> None:
        self._repos = repos
        self._subs = SubscriptionService(repos)

    async def compute_terms(
        self, auth: AuthContext, subscription: Subscription, now: datetime
    ) -> CancellationTerms:
        policy = await self._repos.policies.latest(auth.org_id, "cancellation")
        if policy is None:
            raise AppError(ErrorCode.POLICY_NOT_FOUND, "No cancellation policy is configured.")

        # Effective date: immediate if no notice period, else at period end.
        if policy.notice_days <= 0:
            effective = now
            retains_until = now
        else:
            effective = subscription.current_period_end
            retains_until = subscription.current_period_end

        # Refund: prorated remaining value of the most recent charge, within window.
        refund = 0
        history = await self._repos.billing.history(auth.org_id, auth.user_id, limit=1)
        if policy.prorate_refund and history:
            last = history[0]
            if last.status == "paid":
                days_elapsed = max(0, (now - last.created_at).days)
                if days_elapsed <= policy.refund_window_days:
                    period_days = max(
                        1, (subscription.current_period_end - subscription.started_at).days or 30
                    )
                    remaining_fraction = max(0.0, (period_days - days_elapsed) / period_days)
                    refund = int(round(last.amount_cents * remaining_fraction))

        penalty = max(0, policy.cancellation_fee_cents)
        net_refund = max(0, refund - penalty)

        summary = (
            f"Cancellation effective {effective.date().isoformat()}. "
            f"Refund: {net_refund / 100:.2f} {subscription_currency(history)}. "
            f"Fee: {penalty / 100:.2f}. Policy v{policy.version}."
        )
        return CancellationTerms(
            effective_date=effective,
            refund_amount_cents=net_refund,
            retains_access_until=retains_until,
            penalty_cents=penalty,
            policy_id=policy.policy_id,
            policy_version=policy.version,
            summary=summary,
        )

    async def prepare(
        self, auth: AuthContext, subscription_id: str | None, now: datetime | None = None
    ) -> CancellationProposal:
        now = now or utcnow()
        subscription = await self._subs.get_for_user(auth, subscription_id)
        if subscription.status != SubscriptionStatus.ACTIVE:
            raise AppError(
                ErrorCode.OPERATION_NOT_ALLOWED,
                "This subscription is not active, so it cannot be cancelled.",
                detail={"status": subscription.status.value},
            )
        terms = await self.compute_terms(auth, subscription, now)
        proposal = CancellationProposal(
            proposal_id=f"prop_{uuid.uuid4().hex[:16]}",
            org_id=auth.org_id,
            user_id=auth.user_id,
            subscription_id=subscription.subscription_id,
            status=ProposalStatus.PENDING,
            terms=terms,
            created_at=now,
            expires_at=now + timedelta(minutes=PROPOSAL_TTL_MINUTES),
        )
        await self._repos.proposals.create(proposal.model_dump(mode="json"))
        return proposal

    async def execute(
        self, auth: AuthContext, proposal_id: str, now: datetime | None = None
    ) -> CancellationResult:
        """Deterministic, idempotent final cancellation. The LLM cannot call this."""
        now = now or utcnow()
        raw = await self._repos.proposals.get(auth.org_id, proposal_id)
        if raw is None:
            raise AppError(ErrorCode.PROPOSAL_NOT_FOUND, "Cancellation proposal not found.")
        proposal = CancellationProposal(**raw)

        # Re-validate identity binding.
        if proposal.user_id != auth.user_id:
            raise AppError(
                ErrorCode.PROPOSAL_MISMATCH,
                "This proposal does not belong to you.",
            )
        # Single-use / duplicate protection.
        if proposal.status == ProposalStatus.EXECUTED:
            raise AppError(
                ErrorCode.DUPLICATE_OPERATION,
                "This cancellation was already completed.",
            )
        if proposal.status in {ProposalStatus.EXPIRED, ProposalStatus.ABANDONED}:
            raise AppError(ErrorCode.PROPOSAL_EXPIRED, "This proposal is no longer valid.")
        if proposal.is_expired(now):
            await self._repos.proposals.set_status(proposal_id, ProposalStatus.EXPIRED.value)
            raise AppError(
                ErrorCode.PROPOSAL_EXPIRED, "This proposal has expired. Please start again."
            )

        # Re-validate the subscription still exists and is active.
        subscription = await self._repos.subscriptions.get(auth.org_id, proposal.subscription_id)
        if subscription is None:
            raise AppError(ErrorCode.SUBSCRIPTION_NOT_FOUND, "Subscription no longer exists.")
        if subscription.status != SubscriptionStatus.ACTIVE:
            raise AppError(
                ErrorCode.OPERATION_NOT_ALLOWED,
                "Subscription is not active; nothing to cancel.",
            )

        # Perform the state change.
        await self._repos.subscriptions.set_fields(
            subscription.subscription_id,
            {
                "status": SubscriptionStatus.CANCELLED.value,
                "cancelled_at": now.isoformat(),
                "cancel_effective_at": proposal.terms.effective_date.isoformat(),
            },
        )
        await self._repos.proposals.set_status(proposal_id, ProposalStatus.EXECUTED.value)

        audit_id = f"aud_{uuid.uuid4().hex[:16]}"
        await self._repos.audit.record(
            AuditLog(
                audit_id=audit_id,
                org_id=auth.org_id,
                user_id=auth.user_id,
                action="subscription.cancelled",
                target_id=subscription.subscription_id,
                actor=auth.user_id,
                metadata={
                    "proposal_id": proposal_id,
                    "refund_cents": proposal.terms.refund_amount_cents,
                    "policy_version": proposal.terms.policy_version,
                },
                created_at=now,
            )
        )
        return CancellationResult(
            proposal_id=proposal_id,
            subscription_id=subscription.subscription_id,
            status=SubscriptionStatus.CANCELLED.value,
            effective_date=proposal.terms.effective_date,
            refund_amount_cents=proposal.terms.refund_amount_cents,
            audit_id=audit_id,
            executed_at=now,
        )


def subscription_currency(history) -> str:
    return history[0].currency if history else "USD"
