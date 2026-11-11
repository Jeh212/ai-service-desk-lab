"""A tiny async document-store abstraction.

Two backends implement the same interface:

* MemoryStore — pure-Python dict store used by unit tests and the mock flow.
  The whole system runs offline with it (no Mongo, no API key).
* MongoStore — thin wrapper over PyMongo's AsyncMongoClient collection.

Repositories (repos.py) depend only on this interface, so the exact same
service/business code is exercised by tests and by the real database.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Protocol


def _matches(doc: dict, query: dict) -> bool:
    """Minimal MongoDB-style matcher supporting the operators we actually use."""
    for key, cond in query.items():
        value = doc.get(key)
        if isinstance(cond, dict):
            for op, operand in cond.items():
                if op == "$in":
                    if value not in operand:
                        return False
                elif op == "$ne":
                    if value == operand:
                        return False
                elif op == "$regex":
                    flags = re.IGNORECASE if cond.get("$options", "").find("i") >= 0 else 0
                    if value is None or re.search(operand, str(value), flags) is None:
                        return False
                elif op == "$options":
                    continue
                else:  # pragma: no cover - guard for unsupported operators
                    raise ValueError(f"MemoryStore: unsupported operator {op!r}")
        else:
            if value != cond:
                return False
    return True


class DocStore(Protocol):
    async def insert_one(self, doc: dict) -> None: ...
    async def find_one(self, query: dict) -> dict | None: ...
    async def find(
        self, query: dict, *, sort: list[tuple[str, int]] | None = None, limit: int = 0
    ) -> list[dict]: ...
    async def update_one(self, query: dict, update: dict, *, upsert: bool = False) -> int: ...
    async def delete_many(self, query: dict) -> int: ...
    async def count(self, query: dict) -> int: ...


class MemoryStore:
    """In-memory DocStore. Not concurrency-safe; fine for tests and seeds."""

    def __init__(self) -> None:
        self._docs: list[dict] = []

    async def insert_one(self, doc: dict) -> None:
        self._docs.append(copy.deepcopy(doc))

    async def find_one(self, query: dict) -> dict | None:
        for doc in self._docs:
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    async def find(
        self, query: dict, *, sort: list[tuple[str, int]] | None = None, limit: int = 0
    ) -> list[dict]:
        out = [copy.deepcopy(d) for d in self._docs if _matches(d, query)]
        if sort:
            for field, direction in reversed(sort):
                out.sort(key=lambda d, f=field: (d.get(f) is None, d.get(f)), reverse=direction < 0)
        if limit:
            out = out[:limit]
        return out

    async def update_one(self, query: dict, update: dict, *, upsert: bool = False) -> int:
        set_fields = update.get("$set", {})
        for doc in self._docs:
            if _matches(doc, query):
                doc.update(copy.deepcopy(set_fields))
                return 1
        if upsert:
            new_doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            new_doc.update(copy.deepcopy(set_fields))
            self._docs.append(new_doc)
            return 1
        return 0

    async def delete_many(self, query: dict) -> int:
        before = len(self._docs)
        self._docs = [d for d in self._docs if not _matches(d, query)]
        return before - len(self._docs)

    async def count(self, query: dict) -> int:
        return sum(1 for d in self._docs if _matches(d, query))


class MongoStore:
    """DocStore backed by a PyMongo AsyncMongoClient collection."""

    def __init__(self, collection: Any) -> None:
        self._c = collection

    @staticmethod
    def _clean(doc: dict | None) -> dict | None:
        if doc is None:
            return None
        doc.pop("_id", None)
        return doc

    async def insert_one(self, doc: dict) -> None:
        await self._c.insert_one(copy.deepcopy(doc))

    async def find_one(self, query: dict) -> dict | None:
        return self._clean(await self._c.find_one(query))

    async def find(
        self, query: dict, *, sort: list[tuple[str, int]] | None = None, limit: int = 0
    ) -> list[dict]:
        cursor = self._c.find(query)
        if sort:
            cursor = cursor.sort(sort)
        if limit:
            cursor = cursor.limit(limit)
        return [self._clean(d) async for d in cursor]

    async def update_one(self, query: dict, update: dict, *, upsert: bool = False) -> int:
        res = await self._c.update_one(query, update, upsert=upsert)
        return res.modified_count + (1 if res.upserted_id else 0)

    async def delete_many(self, query: dict) -> int:
        res = await self._c.delete_many(query)
        return res.deleted_count

    async def count(self, query: dict) -> int:
        return await self._c.count_documents(query)


class Database:
    """Maps collection names to DocStore instances for the active backend."""

    COLLECTIONS = (
        "organizations",
        "users",
        "plans",
        "subscriptions",
        "policies",
        "billing",
        "knowledge",
        "conversations",
        "proposals",
        "reviews",
        "audit",
        "traces",
        "eval_runs",
        "eval_cases",
    )

    def __init__(self, stores: dict[str, DocStore]) -> None:
        self._stores = stores

    def __getitem__(self, name: str) -> DocStore:
        return self._stores[name]

    @classmethod
    def in_memory(cls) -> Database:
        return cls({name: MemoryStore() for name in cls.COLLECTIONS})

    @classmethod
    def from_mongo(cls, mongo_db: Any) -> Database:
        return cls({name: MongoStore(mongo_db[name]) for name in cls.COLLECTIONS})
