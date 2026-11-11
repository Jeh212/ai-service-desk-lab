"""Service container — wires repositories into domain services.

A single object passed to the orchestrator and tool handlers, so dependencies
are explicit and easy to swap in tests.
"""

from __future__ import annotations

from app.domain.billing.service import BillingService
from app.domain.subscriptions.service import CancellationService, SubscriptionService
from app.domain.support.service import HumanReviewService, KnowledgeService
from app.repositories.repos import Repositories


class Services:
    def __init__(self, repos: Repositories) -> None:
        self.repos = repos
        self.subscriptions = SubscriptionService(repos)
        self.cancellations = CancellationService(repos)
        self.billing = BillingService(repos)
        self.knowledge = KnowledgeService(repos)
        self.reviews = HumanReviewService(repos)
