"""`asdl-reset` / `make reset` — clear all app collections, then re-seed."""

from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.db.mongo import MongoConnection
from app.repositories.repos import Repositories
from app.repositories.store import Database
from app.seeds import seed_all


async def _run() -> None:
    settings = get_settings()
    mongo = MongoConnection(settings)
    await mongo.connect()
    for collection in Database.COLLECTIONS:
        await mongo.db[collection].delete_many({})
    print("Cleared all collections.")
    await mongo.ensure_indexes()
    repos = Repositories(Database.from_mongo(mongo.db))
    counts = await seed_all(repos)
    await mongo.close()
    print(f"Re-seeded: {counts}")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
