"""Domain entities — the *source of truth* persisted in MongoDB.

These are distinct from AI contracts: the AI contracts describe what crosses the
model boundary, while these describe what the business owns. Keeping them
separate stops the LLM's shape from leaking into persistence (and vice versa).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Entity(BaseModel):
    model_config = ConfigDict(use_enum_values=False, extra="ignore")


# --- Tenancy & identity ------------------------------------------------------


class Organization(Entity):
    org_id: str
    name: str
    created_at: datetime


class User(Entity):
    user_id: str
    org_id: str
    email: str
    name: str
    roles: list[str] = Field(default_factory=lambda: ["customer"])
    # Demo-only password-less login secret (a phrase), never a real credential.
    demo_login_code: str


# --- Catalog -----------------------------------------------------------------


class Plan(Entity):
    plan_id: str
    org_id: str
    code: str  # e.g. "BASIC", "PRO"
    name: str
    price_cents: int
    currency: str = "USD"
    billing_period: str = "monthly"
    features: list[str] = Field(default_factory=list)


# --- Subscriptions -----------------------------------------------------------


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    PAST_DUE = "past_due"


class Subscription(Entity):
    subscription_id: str
    org_id: str
    user_id: str
    plan_code: str
    status: SubscriptionStatus
    started_at: datetime
    current_period_end: datetime
    cancelled_at: datetime | None = None
    cancel_effective_at: datetime | None = None


# --- Policies (deterministic rules source) -----------------------------------


class Policy(Entity):
    policy_id: str
    org_id: str
    kind: str  # "cancellation" | "refund"
    version: int
    # Deterministic parameters the domain service reads.
    notice_days: int = 0
    refund_window_days: int = 0
    prorate_refund: bool = False
    cancellation_fee_cents: int = 0
    summary: str = ""


# --- Billing -----------------------------------------------------------------


class BillingRecord(Entity):
    charge_id: str
    org_id: str
    user_id: str
    subscription_id: str
    amount_cents: int
    currency: str = "USD"
    description: str
    status: str = "paid"  # paid | refunded | failed
    created_at: datetime


# --- Knowledge base ----------------------------------------------------------


class KnowledgeDoc(Entity):
    doc_id: str
    org_id: str
    title: str
    category: str
    content: str
    version: int = 1
    published: bool = True
    created_at: datetime
    updated_at: datetime


# --- Conversations -----------------------------------------------------------


class Message(Entity):
    role: str  # user | assistant | system | tool
    content: str
    created_at: datetime
    intent: str | None = None
    correlation_id: str | None = None


class Conversation(Entity):
    conversation_id: str
    org_id: str
    user_id: str
    messages: list[Message] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# --- Audit -------------------------------------------------------------------


class AuditLog(Entity):
    audit_id: str
    org_id: str
    user_id: str
    action: str
    target_id: str | None = None
    actor: str  # user_id or "system"/"agent:<id>"
    metadata: dict = Field(default_factory=dict)
    created_at: datetime
