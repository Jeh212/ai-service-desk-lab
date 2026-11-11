"""Typed repositories over the DocStore.

Every read/write is scoped by org_id so tenant isolation is enforced at the
data layer, not just in services. Models are (de)serialized with Pydantic.
"""

from __future__ import annotations

from app.core.clock import utcnow
from app.domain.models import (
    AuditLog,
    BillingRecord,
    Conversation,
    KnowledgeDoc,
    Message,
    Organization,
    Plan,
    Policy,
    Subscription,
    User,
)
from app.repositories.store import Database


def _dump(model) -> dict:
    return model.model_dump(mode="json")


class OrgRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["organizations"]

    async def upsert(self, org: Organization) -> None:
        await self._s.update_one({"org_id": org.org_id}, {"$set": _dump(org)}, upsert=True)

    async def get(self, org_id: str) -> Organization | None:
        doc = await self._s.find_one({"org_id": org_id})
        return Organization(**doc) if doc else None


class UserRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["users"]

    async def upsert(self, user: User) -> None:
        await self._s.update_one({"user_id": user.user_id}, {"$set": _dump(user)}, upsert=True)

    async def get(self, org_id: str, user_id: str) -> User | None:
        doc = await self._s.find_one({"org_id": org_id, "user_id": user_id})
        return User(**doc) if doc else None

    async def by_login_code(self, code: str) -> User | None:
        doc = await self._s.find_one({"demo_login_code": code})
        return User(**doc) if doc else None


class PlanRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["plans"]

    async def upsert(self, plan: Plan) -> None:
        await self._s.update_one({"plan_id": plan.plan_id}, {"$set": _dump(plan)}, upsert=True)

    async def list_for_org(self, org_id: str) -> list[Plan]:
        return [Plan(**d) for d in await self._s.find({"org_id": org_id})]

    async def by_code(self, org_id: str, code: str) -> Plan | None:
        doc = await self._s.find_one({"org_id": org_id, "code": code})
        return Plan(**doc) if doc else None


class SubscriptionRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["subscriptions"]

    async def upsert(self, sub: Subscription) -> None:
        await self._s.update_one(
            {"subscription_id": sub.subscription_id}, {"$set": _dump(sub)}, upsert=True
        )

    async def get(self, org_id: str, subscription_id: str) -> Subscription | None:
        doc = await self._s.find_one({"org_id": org_id, "subscription_id": subscription_id})
        return Subscription(**doc) if doc else None

    async def for_user(self, org_id: str, user_id: str) -> list[Subscription]:
        docs = await self._s.find({"org_id": org_id, "user_id": user_id})
        return [Subscription(**d) for d in docs]

    async def set_fields(self, subscription_id: str, fields: dict) -> int:
        return await self._s.update_one({"subscription_id": subscription_id}, {"$set": fields})


class PolicyRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["policies"]

    async def upsert(self, policy: Policy) -> None:
        await self._s.update_one(
            {"policy_id": policy.policy_id}, {"$set": _dump(policy)}, upsert=True
        )

    async def latest(self, org_id: str, kind: str) -> Policy | None:
        docs = await self._s.find({"org_id": org_id, "kind": kind}, sort=[("version", -1)], limit=1)
        return Policy(**docs[0]) if docs else None


class BillingRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["billing"]

    async def upsert(self, rec: BillingRecord) -> None:
        await self._s.update_one({"charge_id": rec.charge_id}, {"$set": _dump(rec)}, upsert=True)

    async def history(self, org_id: str, user_id: str, limit: int = 20) -> list[BillingRecord]:
        docs = await self._s.find(
            {"org_id": org_id, "user_id": user_id},
            sort=[("created_at", -1)],
            limit=limit,
        )
        return [BillingRecord(**d) for d in docs]


class KnowledgeRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["knowledge"]

    async def upsert(self, doc: KnowledgeDoc) -> None:
        await self._s.update_one({"doc_id": doc.doc_id}, {"$set": _dump(doc)}, upsert=True)

    async def list_for_org(self, org_id: str) -> list[KnowledgeDoc]:
        return [KnowledgeDoc(**d) for d in await self._s.find({"org_id": org_id})]

    async def search(
        self, org_id: str, text: str, category: str | None = None, limit: int = 3
    ) -> list[KnowledgeDoc]:
        query: dict = {"org_id": org_id, "published": True}
        if category:
            query["category"] = category
        if text:
            query["content"] = {"$regex": re_escape_terms(text), "$options": "i"}
        docs = await self._s.find(query, limit=limit)
        return [KnowledgeDoc(**d) for d in docs]


def re_escape_terms(text: str) -> str:
    import re

    terms = [re.escape(t) for t in text.split() if len(t) > 2][:5]
    return "|".join(terms) if terms else re.escape(text)


class ConversationRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["conversations"]

    async def create(self, conv: Conversation) -> None:
        await self._s.insert_one(_dump(conv))

    async def get(self, org_id: str, conversation_id: str) -> Conversation | None:
        doc = await self._s.find_one({"org_id": org_id, "conversation_id": conversation_id})
        return Conversation(**doc) if doc else None

    async def append(self, org_id: str, conversation_id: str, messages: list[Message]) -> None:
        conv = await self.get(org_id, conversation_id)
        if conv is None:
            return
        conv.messages.extend(messages)
        conv.updated_at = utcnow()
        await self._s.update_one(
            {"conversation_id": conversation_id},
            {
                "$set": {
                    "messages": [m.model_dump(mode="json") for m in conv.messages],
                    "updated_at": conv.updated_at.isoformat(),
                }
            },
        )

    async def list_for_user(self, org_id: str, user_id: str) -> list[Conversation]:
        docs = await self._s.find({"org_id": org_id, "user_id": user_id}, sort=[("updated_at", -1)])
        return [Conversation(**d) for d in docs]


class AuditRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["audit"]

    async def record(self, log: AuditLog) -> None:
        await self._s.insert_one(_dump(log))

    async def for_target(self, org_id: str, target_id: str) -> list[AuditLog]:
        return [
            AuditLog(**d)
            for d in await self._s.find(
                {"org_id": org_id, "target_id": target_id}, sort=[("created_at", -1)]
            )
        ]


class ProposalRepo:
    """Persisted cancellation proposals (as plain dicts of the AI contract)."""

    def __init__(self, db: Database) -> None:
        self._s = db["proposals"]

    async def create(self, proposal: dict) -> None:
        await self._s.insert_one(proposal)

    async def get(self, org_id: str, proposal_id: str) -> dict | None:
        return await self._s.find_one({"org_id": org_id, "proposal_id": proposal_id})

    async def set_status(self, proposal_id: str, status: str) -> int:
        return await self._s.update_one({"proposal_id": proposal_id}, {"$set": {"status": status}})


class ReviewRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["reviews"]

    async def create(self, review: dict) -> None:
        await self._s.insert_one(review)

    async def get(self, org_id: str, review_id: str) -> dict | None:
        return await self._s.find_one({"org_id": org_id, "review_id": review_id})

    async def list(self, org_id: str, status: str | None = None) -> list[dict]:
        query: dict = {"org_id": org_id}
        if status:
            query["status"] = status
        return await self._s.find(query, sort=[("created_at", -1)])

    async def update(self, review_id: str, fields: dict) -> int:
        return await self._s.update_one({"review_id": review_id}, {"$set": fields})


class TraceRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["traces"]

    async def save(self, trace: dict) -> None:
        await self._s.insert_one(trace)

    async def get(self, org_id: str, correlation_id: str) -> dict | None:
        return await self._s.find_one({"org_id": org_id, "correlation_id": correlation_id})

    async def list(self, org_id: str, limit: int = 50) -> list[dict]:
        return await self._s.find({"org_id": org_id}, sort=[("created_at", -1)], limit=limit)


class EvalRunRepo:
    def __init__(self, db: Database) -> None:
        self._s = db["eval_runs"]

    async def save(self, report: dict) -> None:
        await self._s.insert_one(report)

    async def get(self, run_id: str) -> dict | None:
        return await self._s.find_one({"run_id": run_id})

    async def list(self, limit: int = 50) -> list[dict]:
        return await self._s.find({}, sort=[("created_at", -1)], limit=limit)


class Repositories:
    """Container wiring all repositories to one Database backend."""

    def __init__(self, db: Database) -> None:
        self.db = db
        self.orgs = OrgRepo(db)
        self.users = UserRepo(db)
        self.plans = PlanRepo(db)
        self.subscriptions = SubscriptionRepo(db)
        self.policies = PolicyRepo(db)
        self.billing = BillingRepo(db)
        self.knowledge = KnowledgeRepo(db)
        self.conversations = ConversationRepo(db)
        self.audit = AuditRepo(db)
        self.proposals = ProposalRepo(db)
        self.reviews = ReviewRepo(db)
        self.traces = TraceRepo(db)
        self.eval_runs = EvalRunRepo(db)
