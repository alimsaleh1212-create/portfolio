"""Data access for Visits and their events."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.data.models import ProjectRow, VisitEventRow, VisitRow


@dataclass(frozen=True)
class NewVisit:
    """What is stored when a Visit starts."""

    started_at: datetime
    referrer_host: str | None
    device_class: str
    tier: str | None
    visitor_hash: str | None


@dataclass(frozen=True)
class NewEvent:
    """One event to add to a Visit. Unused fields are None."""

    type: str
    created_at: datetime
    stage_key: str | None = None
    project_slug: str | None = None


class VisitRepository:
    """Reads and writes the visits and visit_events tables."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        """Store the session factory; each call opens its own session."""
        self._session_factory = session_factory

    async def create(self, visit: NewVisit) -> uuid.UUID:
        """Insert a Visit and return its ID."""
        async with self._session_factory() as session, session.begin():
            row = VisitRow(
                started_at=visit.started_at,
                referrer_host=visit.referrer_host,
                device_class=visit.device_class,
                tier=visit.tier,
                visitor_hash=visit.visitor_hash,
            )
            session.add(row)
            await session.flush()
            return row.id

    async def started_at(self, visit_id: uuid.UUID) -> datetime | None:
        """Return when a Visit started, or None if there is no such Visit."""
        async with self._session_factory() as session:
            return await session.scalar(
                select(VisitRow.started_at).where(VisitRow.id == visit_id)
            )

    async def project_exists(self, slug: str) -> bool:
        """Return whether a Project with this slug is known."""
        async with self._session_factory() as session:
            found = await session.scalar(
                select(ProjectRow.id).where(ProjectRow.slug == slug)
            )
        return found is not None

    async def add_event(self, visit_id: uuid.UUID, event: NewEvent) -> None:
        """Insert an event. A Stage already reached by the Visit is left alone."""
        statement = (
            insert(VisitEventRow)
            .values(
                visit_id=visit_id,
                type=event.type,
                stage_key=event.stage_key,
                project_slug=event.project_slug,
                created_at=event.created_at,
            )
            .on_conflict_do_nothing()
        )
        async with self._session_factory() as session, session.begin():
            await session.execute(statement)
