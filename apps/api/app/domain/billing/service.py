"""Billing read operations (tenant-scoped, read-only)."""

from __future__ import annotations

from app.core.context import AuthContext
from app.domain.models import BillingRecord
from app.repositories.repos import Repositories


class BillingService:
    def __init__(self, repos: Repositories) -> None:
        self._repos = repos

    async def history(self, auth: AuthContext, limit: int = 20) -> list[BillingRecord]:
        return await self._repos.billing.history(auth.org_id, auth.user_id, limit=limit)
