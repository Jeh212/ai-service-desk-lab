"""`asdl-seed` / `make seed` — populate MongoDB with idempotent demo data."""

from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.mongo import MongoConnection
from app.repositories.repos import Repositories
from app.repositories.store import Database
from app.seeds import seed_all

logger = get_logger("cli.seed")


async def _run() -> None:
    settings = get_settings()
    mongo = MongoConnection(settings)
    await mongo.connect()
    await mongo.ensure_indexes()
    repos = Repositories(Database.from_mongo(mongo.db))
    counts = await seed_all(repos)
    await mongo.close()
    print("Seed complete:")
    for key, value in counts.items():
        print(f"  {key:>14}: {value}")
    print("\nDemo login codes: alice-acme, bob-acme, carol-globex, dave-acme (staff)")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
