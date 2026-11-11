"""Multi-tenant isolation: no org can read another org's data."""

from __future__ import annotations

import pytest

from app.core.errors import AppError, ErrorCode
from app.seeds import SUB_ALICE, SUB_CAROL


async def test_cannot_read_other_orgs_subscription(services, alice):
    # Alice (Acme) asking for Carol's (Globex) subscription id -> not found.
    with pytest.raises(AppError) as exc:
        await services.subscriptions.get_for_user(alice, SUB_CAROL)
    assert exc.value.code == ErrorCode.SUBSCRIPTION_NOT_FOUND


async def test_knowledge_is_tenant_scoped(services, alice, carol):
    acme_docs = await services.knowledge.search(alice, "cancellation")
    globex_docs = await services.knowledge.search(carol, "cancellation")
    assert acme_docs and all(d.org_id == alice.org_id for d in acme_docs)
    assert globex_docs and all(d.org_id == carol.org_id for d in globex_docs)
    acme_ids = {d.doc_id for d in acme_docs}
    globex_ids = {d.doc_id for d in globex_docs}
    assert acme_ids.isdisjoint(globex_ids)


async def test_proposal_not_visible_across_orgs(services, alice, carol):
    proposal = await services.cancellations.prepare(alice, SUB_ALICE)
    # Carol's org cannot load Alice's proposal.
    raw = await services.repos.proposals.get(carol.org_id, proposal.proposal_id)
    assert raw is None
