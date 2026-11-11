"""Async MongoDB connection and index management (PyMongo AsyncMongoClient)."""

from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger("db.mongo")

# Indexes that enforce tenant-scoped, efficient access patterns.
INDEXES: dict[str, list[tuple[list[tuple[str, int]], dict]]] = {
    "users": [([("user_id", 1)], {"unique": True}), ([("demo_login_code", 1)], {"unique": True})],
    "organizations": [([("org_id", 1)], {"unique": True})],
    "plans": [([("org_id", 1), ("code", 1)], {})],
    "subscriptions": [
        ([("subscription_id", 1)], {"unique": True}),
        ([("org_id", 1), ("user_id", 1)], {}),
    ],
    "policies": [([("org_id", 1), ("kind", 1), ("version", -1)], {})],
    "billing": [([("org_id", 1), ("user_id", 1), ("created_at", -1)], {})],
    "knowledge": [([("org_id", 1), ("category", 1)], {}), ([("org_id", 1), ("published", 1)], {})],
    "conversations": [
        ([("conversation_id", 1)], {"unique": True}),
        ([("org_id", 1), ("user_id", 1), ("updated_at", -1)], {}),
    ],
    "proposals": [([("proposal_id", 1)], {"unique": True}), ([("org_id", 1), ("user_id", 1)], {})],
    "reviews": [([("review_id", 1)], {"unique": True}), ([("org_id", 1), ("status", 1)], {})],
    "traces": [([("correlation_id", 1)], {}), ([("org_id", 1), ("created_at", -1)], {})],
    "eval_runs": [([("run_id", 1)], {"unique": True}), ([("created_at", -1)], {})],
}


class MongoConnection:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Any = None
        self.db: Any = None

    async def connect(self) -> None:
        from pymongo import AsyncMongoClient

        self._client = AsyncMongoClient(self._settings.mongo_uri, serverSelectionTimeoutMS=5000)
        self.db = self._client[self._settings.mongo_db]
        await self._client.admin.command("ping")
        logger.info("Connected to MongoDB db=%s", self._settings.mongo_db)

    async def ensure_indexes(self) -> None:
        for collection, specs in INDEXES.items():
            for keys, opts in specs:
                await self.db[collection].create_index(keys, **opts)
        logger.info("Ensured indexes on %d collections", len(INDEXES))

    async def ping(self) -> bool:
        try:
            await self._client.admin.command("ping")
            return True
        except Exception:  # noqa: BLE001
            return False

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
