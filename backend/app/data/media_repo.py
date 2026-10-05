"""Data access for media items: reads for the API, writes for the seed."""

from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.data.models import MediaItemRow
from app.media.schema import Variant


@dataclass(frozen=True)
class MediaRecord:
    """A stored media item."""

    role: str
    source_sha256: str
    settings_hash: str
    alt: str | None
    download_name: str | None
    duration_seconds: float | None
    variants: list[Variant]


def _record(row: MediaItemRow) -> MediaRecord:
    return MediaRecord(
        role=row.role,
        source_sha256=row.source_sha256,
        settings_hash=row.settings_hash,
        alt=row.alt,
        download_name=row.download_name,
        duration_seconds=row.duration_seconds,
        variants=[Variant.model_validate(item) for item in row.variants],
    )


class MediaRepository:
    """Reads and writes the media_items table."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        """Store the session factory; each call opens its own session."""
        self._session_factory = session_factory

    async def list_items(self) -> list[MediaRecord]:
        """Return every stored item, ordered by role name."""
        async with self._session_factory() as session:
            rows = await session.scalars(
                select(MediaItemRow).order_by(MediaItemRow.role)
            )
            return [_record(row) for row in rows]

    async def get(self, role: str) -> MediaRecord | None:
        """Return one item, or None."""
        async with self._session_factory() as session:
            row = await session.get(MediaItemRow, role)
        return _record(row) if row else None

    async def upsert(self, record: MediaRecord) -> None:
        """Insert or replace the item for its role."""
        values = {
            "source_sha256": record.source_sha256,
            "settings_hash": record.settings_hash,
            "alt": record.alt,
            "download_name": record.download_name,
            "duration_seconds": record.duration_seconds,
            "variants": [variant.model_dump() for variant in record.variants],
        }
        async with self._session_factory() as session, session.begin():
            await session.execute(
                insert(MediaItemRow)
                .values(role=record.role, **values)
                .on_conflict_do_update(index_elements=["role"], set_=values)
            )

    async def remove(self, role: str) -> None:
        """Delete the item for a role, if any."""
        async with self._session_factory() as session, session.begin():
            await session.execute(delete(MediaItemRow).where(MediaItemRow.role == role))
