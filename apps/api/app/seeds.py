"""Idempotent demo seed data + the loader used by the CLI, evals and tests.

Two tenants (Acme, Globex) with *different* commercial policies let us study
multi-tenant isolation and policy-driven behaviour. All data is fictional — no
real personal data. Running the seed twice yields the same state (upserts).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.core.clock import utcnow
from app.domain.models import (
    BillingRecord,
    Conversation,
    KnowledgeDoc,
    Message,
    Organization,
    Plan,
    Policy,
    Subscription,
    SubscriptionStatus,
    User,
)
from app.repositories.repos import Repositories

# --- Stable identifiers (imported by evals/tests) ----------------------------

ORG_ACME = "org_acme"
ORG_GLOBEX = "org_globex"

# Demo login codes act as password-less credentials for local study only.
LOGIN_ALICE = "alice-acme"  # Acme customer, active PRO
LOGIN_BOB = "bob-acme"  # Acme customer, already cancelled BASIC
LOGIN_CAROL = "carol-globex"  # Globex customer, active BASIC
LOGIN_DAVE = "dave-acme"  # Acme support agent (staff)

USER_ALICE = "user_alice"
USER_BOB = "user_bob"
USER_CAROL = "user_carol"
USER_DAVE = "user_dave"

SUB_ALICE = "sub_alice_pro"
SUB_BOB = "sub_bob_basic"
SUB_CAROL = "sub_carol_basic"


async def seed_all(repos: Repositories, now: datetime | None = None) -> dict:
    now = now or utcnow()
    counts = {
        k: 0
        for k in (
            "orgs",
            "users",
            "plans",
            "policies",
            "subscriptions",
            "billing",
            "knowledge",
            "conversations",
            "reviews",
        )
    }

    # Organizations -----------------------------------------------------------
    for org_id, name in ((ORG_ACME, "Acme SaaS"), (ORG_GLOBEX, "Globex Cloud")):
        await repos.orgs.upsert(Organization(org_id=org_id, name=name, created_at=now))
        counts["orgs"] += 1

    # Plans -------------------------------------------------------------------
    plans = [
        Plan(
            plan_id=f"{ORG_ACME}_basic",
            org_id=ORG_ACME,
            code="BASIC",
            name="Acme Basic",
            price_cents=1900,
            features=["1 seat", "email support"],
        ),
        Plan(
            plan_id=f"{ORG_ACME}_pro",
            org_id=ORG_ACME,
            code="PRO",
            name="Acme Pro",
            price_cents=4900,
            features=["5 seats", "priority support", "analytics"],
        ),
        Plan(
            plan_id=f"{ORG_GLOBEX}_basic",
            org_id=ORG_GLOBEX,
            code="BASIC",
            name="Globex Basic",
            price_cents=2500,
            features=["1 seat"],
        ),
        Plan(
            plan_id=f"{ORG_GLOBEX}_pro",
            org_id=ORG_GLOBEX,
            code="PRO",
            name="Globex Pro",
            price_cents=5900,
            features=["10 seats", "SLA"],
        ),
    ]
    for p in plans:
        await repos.plans.upsert(p)
        counts["plans"] += 1

    # Policies (deliberately different between tenants) -----------------------
    policies = [
        Policy(
            policy_id=f"{ORG_ACME}_cancel_v2",
            org_id=ORG_ACME,
            kind="cancellation",
            version=2,
            notice_days=0,
            refund_window_days=14,
            prorate_refund=True,
            cancellation_fee_cents=0,
            summary="Cancel anytime, effective immediately. Prorated refund within 14 days.",
        ),
        Policy(
            policy_id=f"{ORG_ACME}_refund_v1",
            org_id=ORG_ACME,
            kind="refund",
            version=1,
            refund_window_days=14,
            summary="Refunds within 14 days are reviewed by a specialist.",
        ),
        Policy(
            policy_id=f"{ORG_GLOBEX}_cancel_v1",
            org_id=ORG_GLOBEX,
            kind="cancellation",
            version=1,
            notice_days=30,
            refund_window_days=0,
            prorate_refund=False,
            cancellation_fee_cents=500,
            summary="30-day notice; cancellation effective at period end. Early-exit fee applies.",
        ),
        Policy(
            policy_id=f"{ORG_GLOBEX}_refund_v1",
            org_id=ORG_GLOBEX,
            kind="refund",
            version=1,
            refund_window_days=0,
            summary="No self-serve refunds; every refund is handled by a human.",
        ),
    ]
    for pol in policies:
        await repos.policies.upsert(pol)
        counts["policies"] += 1

    # Users -------------------------------------------------------------------
    users = [
        User(
            user_id=USER_ALICE,
            org_id=ORG_ACME,
            email="alice@example.com",
            name="Alice Customer",
            roles=["customer"],
            demo_login_code=LOGIN_ALICE,
        ),
        User(
            user_id=USER_BOB,
            org_id=ORG_ACME,
            email="bob@example.com",
            name="Bob Customer",
            roles=["customer"],
            demo_login_code=LOGIN_BOB,
        ),
        User(
            user_id=USER_CAROL,
            org_id=ORG_GLOBEX,
            email="carol@example.com",
            name="Carol Customer",
            roles=["customer"],
            demo_login_code=LOGIN_CAROL,
        ),
        User(
            user_id=USER_DAVE,
            org_id=ORG_ACME,
            email="dave@example.com",
            name="Dave Agent",
            roles=["customer", "agent"],
            demo_login_code=LOGIN_DAVE,
        ),
    ]
    for u in users:
        await repos.users.upsert(u)
        counts["users"] += 1

    # Subscriptions -----------------------------------------------------------
    subs = [
        Subscription(
            subscription_id=SUB_ALICE,
            org_id=ORG_ACME,
            user_id=USER_ALICE,
            plan_code="PRO",
            status=SubscriptionStatus.ACTIVE,
            started_at=now - timedelta(days=10),
            current_period_end=now + timedelta(days=20),
        ),
        Subscription(
            subscription_id=SUB_BOB,
            org_id=ORG_ACME,
            user_id=USER_BOB,
            plan_code="BASIC",
            status=SubscriptionStatus.CANCELLED,
            started_at=now - timedelta(days=120),
            current_period_end=now - timedelta(days=5),
            cancelled_at=now - timedelta(days=35),
        ),
        Subscription(
            subscription_id=SUB_CAROL,
            org_id=ORG_GLOBEX,
            user_id=USER_CAROL,
            plan_code="BASIC",
            status=SubscriptionStatus.ACTIVE,
            started_at=now - timedelta(days=40),
            current_period_end=now + timedelta(days=20),
        ),
    ]
    for s in subs:
        await repos.subscriptions.upsert(s)
        counts["subscriptions"] += 1

    # Billing -----------------------------------------------------------------
    charges = [
        BillingRecord(
            charge_id="chg_alice_1",
            org_id=ORG_ACME,
            user_id=USER_ALICE,
            subscription_id=SUB_ALICE,
            amount_cents=4900,
            description="Acme Pro — monthly",
            status="paid",
            created_at=now - timedelta(days=10),
        ),
        BillingRecord(
            charge_id="chg_alice_0",
            org_id=ORG_ACME,
            user_id=USER_ALICE,
            subscription_id=SUB_ALICE,
            amount_cents=4900,
            description="Acme Pro — monthly",
            status="paid",
            created_at=now - timedelta(days=40),
        ),
        BillingRecord(
            charge_id="chg_carol_1",
            org_id=ORG_GLOBEX,
            user_id=USER_CAROL,
            subscription_id=SUB_CAROL,
            amount_cents=2500,
            description="Globex Basic — monthly",
            status="paid",
            created_at=now - timedelta(days=10),
        ),
    ]
    for c in charges:
        await repos.billing.upsert(c)
        counts["billing"] += 1

    # Knowledge base ----------------------------------------------------------
    kb = [
        KnowledgeDoc(
            doc_id="kb_acme_cancel",
            org_id=ORG_ACME,
            title="How cancellation works",
            category="cancellation",
            content="You can cancel your Acme plan anytime. Cancellation is effective "
            "immediately and you may be eligible for a prorated refund if within "
            "14 days of your last charge.",
            created_at=now,
            updated_at=now,
        ),
        KnowledgeDoc(
            doc_id="kb_acme_refund",
            org_id=ORG_ACME,
            title="Refund policy",
            category="refund",
            content="Refund requests within 14 days are reviewed by a specialist before "
            "any money is returned.",
            created_at=now,
            updated_at=now,
        ),
        KnowledgeDoc(
            doc_id="kb_acme_plans",
            org_id=ORG_ACME,
            title="Plans and pricing",
            category="plans",
            content="Acme Basic is $19/mo (1 seat). Acme Pro is $49/mo (5 seats, analytics, "
            "priority support).",
            created_at=now,
            updated_at=now,
        ),
        KnowledgeDoc(
            doc_id="kb_globex_cancel",
            org_id=ORG_GLOBEX,
            title="Cancellation terms",
            category="cancellation",
            content="Globex requires 30 days notice. Cancellation takes effect at the end "
            "of the billing period and an early-exit fee may apply.",
            created_at=now,
            updated_at=now,
        ),
    ]
    for d in kb:
        await repos.knowledge.upsert(d)
        counts["knowledge"] += 1

    # One demo conversation + one pending review (idempotent-ish: fixed ids) ---
    conv_id = "conv_demo_alice"
    if await repos.conversations.get(ORG_ACME, conv_id) is None:
        await repos.conversations.create(
            Conversation(
                conversation_id=conv_id,
                org_id=ORG_ACME,
                user_id=USER_ALICE,
                messages=[
                    Message(role="user", content="What plan am I on?", created_at=now),
                    Message(
                        role="assistant", content="You're on Acme Pro ($49/mo).", created_at=now
                    ),
                ],
                created_at=now,
                updated_at=now,
            )
        )
    counts["conversations"] += 1

    review_id = "rev_demo_refund"
    if await repos.reviews.get(ORG_ACME, review_id) is None:
        await repos.reviews.create(
            {
                "review_id": review_id,
                "org_id": ORG_ACME,
                "user_id": USER_BOB,
                "conversation_id": None,
                "reason": "refund_request",
                "summary": "Customer Bob requested a refund for his final BASIC charge.",
                "context": {},
                "status": "pending",
                "created_at": now.isoformat(),
                "decided_at": None,
                "decided_by": None,
                "decision_note": None,
            }
        )
    counts["reviews"] += 1

    return counts
