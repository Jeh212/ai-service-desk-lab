"""Human-in-the-loop review queue routes (staff only)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import AuthDep, ServicesDep
from app.contracts.human_review import ReviewDecisionInput
from app.core.context import AuthContext

router = APIRouter(prefix="/lab/reviews", tags=["human-review"])


@router.get("")
async def list_reviews(
    status: str | None = None, auth: AuthContext = AuthDep, services=ServicesDep
) -> dict:
    if status == "pending":
        reviews = await services.reviews.list_pending(auth)
    else:
        reviews = await services.reviews.list_all(auth)
    return {"reviews": [r.model_dump(mode="json") for r in reviews]}


@router.post("/{review_id}/decide")
async def decide_review(
    review_id: str,
    body: ReviewDecisionInput,
    auth: AuthContext = AuthDep,
    services=ServicesDep,
) -> dict:
    review = await services.reviews.decide(auth, review_id, body.approve, body.note)
    return review.model_dump(mode="json")
