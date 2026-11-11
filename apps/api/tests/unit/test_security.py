"""Demo session token issuing and verification."""

from __future__ import annotations

import pytest

from app.core.context import Role
from app.core.errors import AppError, ErrorCode
from app.core.security import issue_token, verify_token


def test_roundtrip():
    token = issue_token("org_acme", "user_alice", [Role.CUSTOMER, Role.AGENT])
    ctx = verify_token(token)
    assert ctx.org_id == "org_acme"
    assert ctx.user_id == "user_alice"
    assert ctx.has_role(Role.AGENT)


def test_tampered_token_rejected():
    token = issue_token("org_acme", "user_alice", [Role.CUSTOMER])
    payload, sig = token.split(".", 1)
    # Flip the payload (claim a different org) while keeping the old signature.
    forged = payload[:-2] + ("AA" if payload[-2:] != "AA" else "BB") + "." + sig
    with pytest.raises(AppError) as exc:
        verify_token(forged)
    assert exc.value.code == ErrorCode.UNAUTHENTICATED


def test_malformed_token_rejected():
    with pytest.raises(AppError):
        verify_token("not-a-token")


def test_roles_cannot_be_escalated_by_client():
    # A client editing the role list breaks the signature -> rejected.
    token = issue_token("org_acme", "user_alice", [Role.CUSTOMER])
    payload, sig = token.split(".", 1)
    with pytest.raises(AppError):
        verify_token(payload + "." + sig[:-1] + ("x" if sig[-1] != "x" else "y"))
