"""Knowledge base retrieval + human-in-the-loop review queue."""

from __future__ import annotations

import uuid
from datetime import datetime

from app.contracts.human_review import (
    HumanReviewRequest,
    ReviewReason,
    ReviewStatus,
)
from app.core.clock import utcnow
from app.core.context import AuthContext, Role
from app.core.errors import AppError, ErrorCode
from app.domain.models import AuditLog, KnowledgeDoc
from app.repositories.repos import Repositories


class KnowledgeService:
    def __init__(self, repos: Repositories) -> None:
        self._repos = repos

    async def search(
        self, auth: AuthContext, query: str, category: str | None = None, limit: int = 3
    ) -> list[KnowledgeDoc]:
        # Tenant isolation: only this org's published docs are ever returned.
        return await self._repos.knowledge.search(auth.org_id, query, category, limit)

    async def list(self, auth: AuthContext) -> list[KnowledgeDoc]:
        return await self._repos.knowledge.list_for_org(auth.org_id)


class HumanReviewService:
    def __init__(self, repos: Repositories) -> None:
        self._repos = repos

    async def create(
        self,
        auth: AuthContext,
        reason: ReviewReason,
        summary: str,
        conversation_id: str | None = None,
        context: dict | None = None,
        now: datetime | None = None,
    ) -> HumanReviewRequest:
        now = now or utcnow()
        review = HumanReviewRequest(
            review_id=f"rev_{uuid.uuid4().hex[:16]}",
            org_id=auth.org_id,
            user_id=auth.user_id,
            conversation_id=conversation_id,
            reason=reason,
            summary=summary,
            context=context or {},
            status=ReviewStatus.PENDING,
            created_at=now,
        )
        await self._repos.reviews.create(review.model_dump(mode="json"))
        return review

    async def list_pending(self, auth: AuthContext) -> list[HumanReviewRequest]:
        self._require_staff(auth)
        raw = await self._repos.reviews.list(auth.org_id, status=ReviewStatus.PENDING.value)
        return [HumanReviewRequest(**r) for r in raw]

    async def list_all(self, auth: AuthContext) -> list[HumanReviewRequest]:
        self._require_staff(auth)
        raw = await self._repos.reviews.list(auth.org_id)
        return [HumanReviewRequest(**r) for r in raw]

    async def decide(
        self,
        auth: AuthContext,
        review_id: str,
        approve: bool,
        note: str = "",
        now: datetime | None = None,
    ) -> HumanReviewRequest:
        self._require_staff(auth)
        now = now or utcnow()
        raw = await self._repos.reviews.get(auth.org_id, review_id)
        if raw is None:
            raise AppError(ErrorCode.PROPOSAL_NOT_FOUND, "Review request not found.")
        review = HumanReviewRequest(**raw)
        if review.status != ReviewStatus.PENDING:
            raise AppError(
                ErrorCode.DUPLICATE_OPERATION,
                "This review has already been decided.",
            )
        new_status = ReviewStatus.APPROVED if approve else ReviewStatus.REJECTED
        fields = {
            "status": new_status.value,
            "decided_at": now.isoformat(),
            "decided_by": auth.user_id,
            "decision_note": note,
        }
        await self._repos.reviews.update(review_id, fields)
        await self._repos.audit.record(
            AuditLog(
                audit_id=f"aud_{uuid.uuid4().hex[:16]}",
                org_id=auth.org_id,
                user_id=review.user_id,
                action=f"review.{new_status.value}",
                target_id=review_id,
                actor=f"agent:{auth.user_id}",
                metadata={"note": note, "reason": review.reason.value},
                created_at=now,
            )
        )
        return review.model_copy(update=fields)

    @staticmethod
    def _require_staff(auth: AuthContext) -> None:
        if not auth.is_staff:
            raise AppError(
                ErrorCode.FORBIDDEN,
                "Only support staff can access the review queue.",
                detail={"required_role": Role.AGENT.value},
            )
