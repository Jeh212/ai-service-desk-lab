"""Demo session tokens (HMAC-signed, stateless).

This is DEMO authentication for local study only. The important property it
demonstrates: the backend issues a signed token at login and verifies it on
every request, so the client cannot simply assert an arbitrary org_id/user_id.
It is NOT a production identity provider — see docs/learning/Lab01.

Token format:  base64url(payload_json) + "." + base64url(hmac_sha256)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from app.core.config import get_settings
from app.core.context import AuthContext, Role
from app.core.errors import AppError, ErrorCode


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(payload_b64: str, secret: str) -> str:
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
    return _b64e(sig)


def issue_token(org_id: str, user_id: str, roles: list[Role]) -> str:
    settings = get_settings()
    now = int(time.time())
    payload = {
        "org_id": org_id,
        "user_id": user_id,
        "roles": [r.value for r in roles],
        "iat": now,
        "exp": now + settings.demo_session_ttl_minutes * 60,
    }
    payload_b64 = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    return f"{payload_b64}.{_sign(payload_b64, settings.demo_auth_secret)}"


def verify_token(token: str) -> AuthContext:
    settings = get_settings()
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError as exc:
        raise AppError(ErrorCode.UNAUTHENTICATED, "Malformed session token.") from exc

    expected = _sign(payload_b64, settings.demo_auth_secret)
    if not hmac.compare_digest(expected, sig):
        raise AppError(ErrorCode.UNAUTHENTICATED, "Invalid session signature.")

    try:
        payload = json.loads(_b64d(payload_b64))
    except Exception as exc:  # noqa: BLE001
        raise AppError(ErrorCode.UNAUTHENTICATED, "Corrupt session token.") from exc

    if int(payload.get("exp", 0)) < int(time.time()):
        raise AppError(ErrorCode.UNAUTHENTICATED, "Session has expired.")

    try:
        roles = tuple(Role(r) for r in payload["roles"])
        return AuthContext(
            org_id=payload["org_id"],
            user_id=payload["user_id"],
            roles=roles,
        )
    except (KeyError, ValueError) as exc:
        raise AppError(ErrorCode.UNAUTHENTICATED, "Invalid session claims.") from exc
