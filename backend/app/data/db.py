"""Postgres access: async engine, session factory and the readiness probe."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

# The pool's limits are set, not defaulted, so metrics can report the ceiling.
POOL_SIZE = 5
MAX_OVERFLOW = 10


class Base(DeclarativeBase):
    """Declarative base for every ORM model. Alembic reads its metadata."""


def create_engine(database_url: str, connect_timeout: float) -> AsyncEngine:
    """Build the async engine.

    Args:
        database_url: SQLAlchemy URL using the asyncpg driver.
        connect_timeout: Seconds to wait when opening a connection.

    Returns:
        An engine that checks connections before handing them out.
    """
    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=POOL_SIZE,
        max_overflow=MAX_OVERFLOW,
        connect_args={"timeout": connect_timeout},
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Return a session factory bound to the engine."""
    return async_sessionmaker(engine, expire_on_commit=False)


class PostgresProbe:
    """Readiness probe for Postgres."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Store the engine to probe."""
        self._engine = engine

    async def ping(self) -> None:
        """Run `SELECT 1`; raises if Postgres cannot answer."""
        async with self._engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
