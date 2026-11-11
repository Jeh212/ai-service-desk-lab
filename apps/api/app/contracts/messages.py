"""Chat input/output message contracts (the customer-facing surface)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import Field

from app.contracts.common import Contract


class ChatRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatMessageInput(Contract):
    """What the frontend sends to start/continue a conversation."""

    conversation_id: str | None = Field(
        default=None,
        description="Omit to start a new conversation; provide to continue one.",
    )
    message: str = Field(min_length=1, max_length=4000)


class StoredMessage(Contract):
    """A persisted message in a conversation."""

    role: ChatRole
    content: str
    created_at: datetime
    intent: str | None = None
    correlation_id: str | None = None


class ConfirmActionInput(Contract):
    """Explicit confirmation of a previously proposed, sensitive operation."""

    conversation_id: str
    proposal_id: str
    confirm: bool = Field(description="True to execute, false to abandon the proposal.")
