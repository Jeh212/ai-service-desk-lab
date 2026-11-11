"""FastAPI application factory, lifespan, and error handling."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.providers.factory import build_provider
from app.ai.tools.registry import build_registry
from app.api.routes import auth, chat, evals, lab, reviews, subscriptions
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import configure_logging, get_logger
from app.db.mongo import MongoConnection
from app.repositories.repos import Repositories
from app.repositories.store import Database
from app.services.container import Services

logger = get_logger("app")


def _wire_state(app: FastAPI, database: Database) -> None:
    settings = get_settings()
    repos = Repositories(database)
    app.state.settings = settings
    app.state.repos = repos
    app.state.services = Services(repos)
    app.state.provider = build_provider(settings)
    app.state.registry = build_registry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    mongo: MongoConnection | None = None

    if getattr(app.state, "database", None) is not None:
        # Tests / offline: use the injected (in-memory) database.
        _wire_state(app, app.state.database)
    else:
        mongo = MongoConnection(settings)
        await mongo.connect()
        await mongo.ensure_indexes()
        app.state.mongo = mongo
        _wire_state(app, Database.from_mongo(mongo.db))

    logger.info(
        "AI Service Desk API ready (provider=%s, model=%s)",
        app.state.provider.name,
        app.state.provider.model,
    )
    try:
        yield
    finally:
        if mongo is not None:
            await mongo.close()


def create_app(database: Database | None = None) -> FastAPI:
    app = FastAPI(
        title="AI Service Desk Lab API",
        version="0.1.0",
        description="Educational backend for reliable, safe LLM features.",
        lifespan=lifespan,
    )
    if database is not None:
        app.state.database = database

    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError):
        if exc.http_status >= 500:
            logger.error("AppError %s: %s | %s", exc.code.value, exc.message, exc.detail)
        return JSONResponse(status_code=exc.http_status, content=exc.to_public_dict())

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        logger.exception("Unhandled error")
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": ErrorCode.INTERNAL_ERROR.value,
                    "message": "An unexpected error occurred.",
                }
            },
        )

    @app.get("/health", tags=["system"])
    async def health():
        provider = app.state.provider
        mongo_ok = True
        if getattr(app.state, "mongo", None) is not None:
            mongo_ok = await app.state.mongo.ping()
        return {
            "status": "ok" if mongo_ok else "degraded",
            "provider": provider.name,
            "model": provider.model,
            "mongo": mongo_ok,
        }

    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(subscriptions.router)
    app.include_router(lab.router)
    app.include_router(evals.router)
    app.include_router(reviews.router)
    return app


app = create_app()
