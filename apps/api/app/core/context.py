"""Authenticated request context and correlation id.

The context carries *verified* identity (org + user + roles) resolved by the
backend from a demo session token — never raw ids trusted from the client body.
Domain services receive this object and enforce tenant isolation against it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import Enum


class Role(str, Enum):
    CUSTOMER = "customer"
    AGENT = "agent"  # human support agent (can access the review queue)
    ADMIN = "admin"


@dataclass(frozen=True)
class AuthContext:
    """Verified principal for the current request."""

    org_id: str
    user_id: str
    roles: tuple[Role, ...]
    correlation_id: str = field(default_factory=lambda: f"req_{uuid.uuid4().hex[:12]}")

    def has_role(self, role: Role) -> bool:
        return role in self.roles

    @property
    def is_staff(self) -> bool:
        return self.has_role(Role.AGENT) or self.has_role(Role.ADMIN)


def new_correlation_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"
