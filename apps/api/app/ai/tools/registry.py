"""Tool catalog: definitions, handlers, permissions, and the registry.

Each tool is a *narrow, specific* capability — never a generic "run SQL" or
"run Python" escape hatch. A tool declares: name, model-facing description,
argument schema, required roles, the handler, and the error codes it may raise.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime

from app.ai.providers.base import ToolSpec
from app.ai.tools import names
from app.ai.tools.schemas import (
    EmptyArgs,
    GetBillingHistoryArgs,
    GetSubscriptionArgs,
    PrepareCancellationArgs,
    RequestHumanReviewArgs,
    SearchKnowledgeArgs,
    ToolArgs,
)
from app.contracts.human_review import ReviewReason
from app.core.context import AuthContext, Role
from app.core.errors import AppError, ErrorCode
from app.services.container import Services


@dataclass
class ToolContext:
    auth: AuthContext
    services: Services
    conversation_id: str | None = None
    now: datetime | None = None


Handler = Callable[[ToolContext, ToolArgs], Awaitable[dict]]


@dataclass
class ToolDefinition:
    name: str
    description: str
    args_model: type[ToolArgs]
    handler: Handler
    allowed_roles: tuple[Role, ...] = (Role.CUSTOMER, Role.AGENT, Role.ADMIN)
    possible_errors: tuple[ErrorCode, ...] = ()
    # Whether this tool is exposed to the model by default (vs. backend-only).
    model_facing: bool = True

    def to_spec(self) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            description=self.description,
            parameters=self.args_model.json_schema(),
        )

    def authorize(self, auth: AuthContext) -> None:
        if not any(auth.has_role(r) for r in self.allowed_roles):
            raise AppError(
                ErrorCode.TOOL_NOT_AUTHORIZED,
                f"You are not allowed to use the '{self.name}' tool.",
                detail={"tool": self.name},
            )


# --- Handlers ----------------------------------------------------------------


async def _get_subscription(ctx: ToolContext, args: GetSubscriptionArgs) -> dict:
    sub = await ctx.services.subscriptions.get_for_user(ctx.auth, args.subscription_id)
    plan = await ctx.services.repos.plans.by_code(ctx.auth.org_id, sub.plan_code)
    return {
        "subscription_id": sub.subscription_id,
        "plan_code": sub.plan_code,
        "plan_name": plan.name if plan else sub.plan_code,
        "price_cents": plan.price_cents if plan else None,
        "currency": plan.currency if plan else "USD",
        "status": sub.status.value,
        "started_at": sub.started_at.isoformat(),
        "current_period_end": sub.current_period_end.isoformat(),
        "cancel_effective_at": sub.cancel_effective_at.isoformat()
        if sub.cancel_effective_at
        else None,
    }


async def _get_cancellation_policy(ctx: ToolContext, args: EmptyArgs) -> dict:
    policy = await ctx.services.repos.policies.latest(ctx.auth.org_id, "cancellation")
    if policy is None:
        raise AppError(ErrorCode.POLICY_NOT_FOUND, "No cancellation policy configured.")
    return {
        "policy_id": policy.policy_id,
        "version": policy.version,
        "notice_days": policy.notice_days,
        "refund_window_days": policy.refund_window_days,
        "prorate_refund": policy.prorate_refund,
        "cancellation_fee_cents": policy.cancellation_fee_cents,
        "summary": policy.summary,
    }


async def _get_billing_history(ctx: ToolContext, args: GetBillingHistoryArgs) -> dict:
    records = await ctx.services.billing.history(ctx.auth, limit=args.limit)
    return {
        "charges": [
            {
                "charge_id": r.charge_id,
                "amount_cents": r.amount_cents,
                "currency": r.currency,
                "description": r.description,
                "status": r.status,
                "created_at": r.created_at.isoformat(),
            }
            for r in records
        ]
    }


async def _prepare_cancellation(ctx: ToolContext, args: PrepareCancellationArgs) -> dict:
    proposal = await ctx.services.cancellations.prepare(ctx.auth, args.subscription_id, now=ctx.now)
    return {
        "proposal_id": proposal.proposal_id,
        "subscription_id": proposal.subscription_id,
        "expires_at": proposal.expires_at.isoformat(),
        "terms": {
            "effective_date": proposal.terms.effective_date.isoformat(),
            "refund_amount_cents": proposal.terms.refund_amount_cents,
            "penalty_cents": proposal.terms.penalty_cents,
            "currency": proposal.terms.currency,
            "summary": proposal.terms.summary,
            "policy_version": proposal.terms.policy_version,
        },
    }


async def _request_human_review(ctx: ToolContext, args: RequestHumanReviewArgs) -> dict:
    try:
        reason = ReviewReason(args.reason)
    except ValueError:
        reason = ReviewReason.APPROVAL_REQUIRED
    review = await ctx.services.reviews.create(
        ctx.auth,
        reason=reason,
        summary=args.summary,
        conversation_id=ctx.conversation_id,
        now=ctx.now,
    )
    return {"review_id": review.review_id, "status": review.status.value, "reason": reason.value}


async def _search_knowledge_base(ctx: ToolContext, args: SearchKnowledgeArgs) -> dict:
    docs = await ctx.services.knowledge.search(ctx.auth, args.query, args.category, limit=3)
    return {
        "results": [
            {
                "doc_id": d.doc_id,
                "title": d.title,
                "category": d.category,
                "content": d.content[:800],
                "version": d.version,
            }
            for d in docs
        ]
    }


# --- Registry ----------------------------------------------------------------


@dataclass
class ToolRegistry:
    _tools: dict[str, ToolDefinition] = field(default_factory=dict)

    def register(self, definition: ToolDefinition) -> None:
        self._tools[definition.name] = definition

    def get(self, name: str) -> ToolDefinition:
        if name not in self._tools:
            raise AppError(
                ErrorCode.TOOL_NOT_FOUND,
                f"Unknown tool '{name}'.",
                detail={"tool": name},
            )
        return self._tools[name]

    def all(self) -> list[ToolDefinition]:
        return list(self._tools.values())

    def specs(self, allowed: set[str] | None = None) -> list[ToolSpec]:
        return [
            d.to_spec()
            for d in self._tools.values()
            if d.model_facing and (allowed is None or d.name in allowed)
        ]


def build_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(
        ToolDefinition(
            name=names.GET_SUBSCRIPTION,
            description="Fetch details of the authenticated customer's subscription.",
            args_model=GetSubscriptionArgs,
            handler=_get_subscription,  # type: ignore[arg-type]
            possible_errors=(ErrorCode.SUBSCRIPTION_NOT_FOUND, ErrorCode.CROSS_TENANT_ACCESS),
        )
    )
    reg.register(
        ToolDefinition(
            name=names.GET_CANCELLATION_POLICY,
            description="Fetch the organization's current cancellation policy and terms.",
            args_model=EmptyArgs,
            handler=_get_cancellation_policy,  # type: ignore[arg-type]
            possible_errors=(ErrorCode.POLICY_NOT_FOUND,),
        )
    )
    reg.register(
        ToolDefinition(
            name=names.GET_BILLING_HISTORY,
            description="List the authenticated customer's recent charges.",
            args_model=GetBillingHistoryArgs,
            handler=_get_billing_history,  # type: ignore[arg-type]
        )
    )
    reg.register(
        ToolDefinition(
            name=names.PREPARE_CANCELLATION,
            description=(
                "Prepare (NOT execute) a cancellation: computes deterministic terms and "
                "returns a proposal the customer must explicitly confirm."
            ),
            args_model=PrepareCancellationArgs,
            handler=_prepare_cancellation,  # type: ignore[arg-type]
            possible_errors=(
                ErrorCode.SUBSCRIPTION_NOT_FOUND,
                ErrorCode.OPERATION_NOT_ALLOWED,
                ErrorCode.POLICY_NOT_FOUND,
            ),
        )
    )
    reg.register(
        ToolDefinition(
            name=names.REQUEST_HUMAN_REVIEW,
            description="Route the case to a human specialist (refunds, exceptions, uncertainty).",
            args_model=RequestHumanReviewArgs,
            handler=_request_human_review,  # type: ignore[arg-type]
        )
    )
    reg.register(
        ToolDefinition(
            name=names.SEARCH_KNOWLEDGE_BASE,
            description="Search the organization's knowledge base for relevant articles.",
            args_model=SearchKnowledgeArgs,
            handler=_search_knowledge_base,  # type: ignore[arg-type]
        )
    )
    return reg
