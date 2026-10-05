"""Small synchronous wrappers over the async engine, for test setup and checks."""

import asyncio
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine


async def recreate_database(admin_url: URL, name: str) -> None:
    """Drop `name` if it exists, then create it empty."""
    engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as connection:
        await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await connection.execute(text(f'CREATE DATABASE "{name}"'))
    await engine.dispose()


async def drop_database(admin_url: URL, name: str) -> None:
    """Drop `name` if it exists."""
    engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    async with engine.connect() as connection:
        await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    await engine.dispose()


async def _fetch_all(url: str, sql: str) -> list[dict[str, Any]]:
    engine = create_async_engine(url)
    async with engine.connect() as connection:
        result = await connection.execute(text(sql))
        rows = [dict(row._mapping) for row in result]
    await engine.dispose()
    return rows


def fetch_all(url: str, sql: str) -> list[dict[str, Any]]:
    """Run a query and return its rows as dicts."""
    return asyncio.run(_fetch_all(url, sql))


def execute(url: str, sql: str) -> None:
    """Run a statement and commit it."""

    async def run() -> None:
        engine = create_async_engine(url)
        async with engine.begin() as connection:
            await connection.execute(text(sql))
        await engine.dispose()

    asyncio.run(run())


def snapshot(url: str) -> dict[str, list[dict[str, Any]]]:
    """Return every content table's rows, ordered, for state comparisons."""
    return {
        table: fetch_all(url, f"SELECT * FROM {table} ORDER BY id")  # noqa: S608
        for table in ("profile", "stages", "projects")
    }
