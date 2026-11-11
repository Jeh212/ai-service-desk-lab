"""Shared test fixtures. Everything runs offline with the mock provider."""

from __future__ import annotations

import asyncio

import pytest

from app.ai.orchestrator import Orchestrator
from app.ai.providers.mock import MockLLMProvider
from app.ai.tools.registry import build_registry
from app.core.config import get_settings
from app.core.context import AuthContext, Role
from app.repositories.repos import Repositories
from app.repositories.store import Database
from app.seeds import (
    ORG_ACME,
    ORG_GLOBEX,
    USER_ALICE,
    USER_BOB,
    USER_CAROL,
    USER_DAVE,
    seed_all,
)
from app.services.container import Services


@pytest.fixture
async def repos() -> Repositories:
    r = Repositories(Database.in_memory())
    await seed_all(r)
    return r


@pytest.fixture
async def services(repos: Repositories) -> Services:
    return Services(repos)


@pytest.fixture
def orchestrator(services: Services) -> Orchestrator:
    return Orchestrator(MockLLMProvider(), build_registry(), services, get_settings())


@pytest.fixture
def alice() -> AuthContext:
    return AuthContext(org_id=ORG_ACME, user_id=USER_ALICE, roles=(Role.CUSTOMER,))


@pytest.fixture
def bob() -> AuthContext:
    return AuthContext(org_id=ORG_ACME, user_id=USER_BOB, roles=(Role.CUSTOMER,))


@pytest.fixture
def carol() -> AuthContext:
    return AuthContext(org_id=ORG_GLOBEX, user_id=USER_CAROL, roles=(Role.CUSTOMER,))


@pytest.fixture
def dave() -> AuthContext:
    return AuthContext(org_id=ORG_ACME, user_id=USER_DAVE, roles=(Role.CUSTOMER, Role.AGENT))


@pytest.fixture
def api_client():
    """FastAPI TestClient backed by a seeded in-memory database (no MongoDB)."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    db = Database.in_memory()
    asyncio.run(seed_all(Repositories(db)))
    app = create_app(db)
    with TestClient(app) as client:
        yield client
