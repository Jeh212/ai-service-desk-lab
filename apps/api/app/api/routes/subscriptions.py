"""Customer self-service: subscription + billing (read-only, tenant-scoped)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import AuthDep, ServicesDep
from app.core.context import AuthContext

router = APIRouter(prefix="/me", tags=["customer"])


@router.get("/subscription")
async def my_subscription(auth: AuthContext = AuthDep, services=ServicesDep) -> dict:
    sub = await services.subscriptions.get_for_user(auth, None)
    plan = await services.repos.plans.by_code(auth.org_id, sub.plan_code)
    return {
        "subscription": sub.model_dump(mode="json"),
        "plan": plan.model_dump(mode="json") if plan else None,
    }


@router.get("/billing")
async def my_billing(limit: int = 20, auth: AuthContext = AuthDep, services=ServicesDep) -> dict:
    records = await services.billing.history(auth, limit=limit)
    return {"charges": [r.model_dump(mode="json") for r in records]}
