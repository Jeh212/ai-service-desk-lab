"""Deterministic cancellation: prepare, execute, idempotency, expiry, binding."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.errors import AppError, ErrorCode
from app.domain.models import SubscriptionStatus
from app.domain.subscriptions.service import CancellationService
from app.seeds import SUB_ALICE


async def test_prepare_then_execute(services, alice):
    svc = CancellationService(services.repos)
    proposal = await svc.prepare(alice, SUB_ALICE)
    assert proposal.status.value == "pending"
    assert proposal.subscription_id == SUB_ALICE

    result = await svc.execute(alice, proposal.proposal_id)
    assert result.status == SubscriptionStatus.CANCELLED.value
    assert result.audit_id

    sub = await services.repos.subscriptions.get(alice.org_id, SUB_ALICE)
    assert sub.status == SubscriptionStatus.CANCELLED


async def test_duplicate_execution_blocked(services, alice):
    svc = CancellationService(services.repos)
    proposal = await svc.prepare(alice, SUB_ALICE)
    await svc.execute(alice, proposal.proposal_id)
    with pytest.raises(AppError) as exc:
        await svc.execute(alice, proposal.proposal_id)
    assert exc.value.code == ErrorCode.DUPLICATE_OPERATION


async def test_expired_proposal_rejected(services, alice):
    svc = CancellationService(services.repos)
    proposal = await svc.prepare(alice, SUB_ALICE)
    later = proposal.expires_at + timedelta(minutes=1)
    with pytest.raises(AppError) as exc:
        await svc.execute(alice, proposal.proposal_id, now=later)
    assert exc.value.code == ErrorCode.PROPOSAL_EXPIRED


async def test_proposal_bound_to_user(services, alice, bob):
    svc = CancellationService(services.repos)
    proposal = await svc.prepare(alice, SUB_ALICE)
    # Bob (same org) cannot execute Alice's proposal.
    with pytest.raises(AppError) as exc:
        await svc.execute(bob, proposal.proposal_id)
    assert exc.value.code in {ErrorCode.PROPOSAL_MISMATCH, ErrorCode.PROPOSAL_NOT_FOUND}


async def test_cannot_prepare_inactive_subscription(services, bob):
    svc = CancellationService(services.repos)
    # Bob's subscription is already cancelled.
    with pytest.raises(AppError) as exc:
        await svc.prepare(bob, None)
    assert exc.value.code == ErrorCode.OPERATION_NOT_ALLOWED
