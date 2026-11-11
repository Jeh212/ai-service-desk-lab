"""FastAPI dependencies: shared singletons + verified auth context."""

from __future__ import annotations

from dataclasses import replace

from fastapi import Depends, Header, Request

from app.ai.providers.base import LLMProvider
from app.ai.tools.registry import ToolRegistry
from app.core.config import Settings
from app.core.context import AuthContext, new_correlation_id
from app.core.errors import AppError, ErrorCode
from app.core.security import verify_token
from app.services.container import Services


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_registry(request: Request) -> ToolRegistry:
    return request.app.state.registry


def get_provider(request: Request) -> LLMProvider:
    return request.app.state.provider


async def get_auth(authorization: str | None = Header(default=None)) -> AuthContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError(ErrorCode.UNAUTHENTICATED, "Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    auth = verify_token(token)
    # Fresh correlation id per request for tracing.
    return replace(auth, correlation_id=new_correlation_id())


def build_orchestrator(
    request: Request,
    system_version: str | None = None,
    classifier_version: str | None = None,
):
    from app.ai.orchestrator import Orchestrator
    from app.ai.prompts import library

    st = request.app.state
    return Orchestrator(
        st.provider,
        st.registry,
        st.services,
        st.settings,
        system_version=system_version or library.DEFAULT_SYSTEM_VERSION,
        classifier_version=classifier_version or library.DEFAULT_CLASSIFIER_VERSION,
    )


def get_orchestrator(request: Request):
    return build_orchestrator(request)


AuthDep = Depends(get_auth)
SettingsDep = Depends(get_settings)
ServicesDep = Depends(get_services)
RegistryDep = Depends(get_registry)
ProviderDep = Depends(get_provider)
