"""Demo authentication routes.

POST /auth/login exchanges a seeded demo login code for a signed session token.
The token — not any client-sent id — is what later requests present, and the
backend re-derives org/user/roles from it on every call.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import AuthDep, ServicesDep
from app.core.context import AuthContext, Role
from app.core.errors import AppError, ErrorCode
from app.core.security import issue_token

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginInput(BaseModel):
    login_code: str


class LoginResponse(BaseModel):
    token: str
    user: dict


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginInput, services=ServicesDep) -> LoginResponse:
    user = await services.repos.users.by_login_code(body.login_code.strip())
    if user is None:
        raise AppError(ErrorCode.UNAUTHENTICATED, "Unknown login code. Try a seeded demo code.")
    roles = [Role(r) for r in user.roles]
    token = issue_token(user.org_id, user.user_id, roles)
    return LoginResponse(
        token=token,
        user={
            "user_id": user.user_id,
            "org_id": user.org_id,
            "name": user.name,
            "email": user.email,
            "roles": user.roles,
        },
    )


@router.get("/me")
async def me(auth: AuthContext = AuthDep, services=ServicesDep) -> dict:
    user = await services.repos.users.get(auth.org_id, auth.user_id)
    if user is None:
        raise AppError(ErrorCode.UNAUTHENTICATED, "User no longer exists.")
    return {
        "user_id": user.user_id,
        "org_id": user.org_id,
        "name": user.name,
        "email": user.email,
        "roles": user.roles,
        "correlation_id": auth.correlation_id,
    }
