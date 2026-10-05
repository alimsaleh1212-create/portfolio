"""Data access for the text content: reads for the API, a sync for the seed."""

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.content.loader import Content
from app.content.schema import PLACEHOLDER_MARKER, Profile, Project, StageContent
from app.data.models import ProfileRow, ProjectRow, StageRow


def split_challenge(text: str) -> tuple[str, bool]:
    """Split the placeholder marker off a Challenge.

    Args:
        text: The Challenge as written in the content file.

    Returns:
        The text without the marker, and whether the marker was present.
    """
    if text.startswith(PLACEHOLDER_MARKER):
        return text.removeprefix(PLACEHOLDER_MARKER).strip(), True
    return text, False


class ContentRepository:
    """Reads and writes the profile, Stage and Project tables."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        """Store the session factory; each call opens its own session."""
        self._session_factory = session_factory

    async def get_profile(self) -> Profile | None:
        """Return the profile, or None if nothing has been seeded."""
        async with self._session_factory() as session:
            row = await session.get(ProfileRow, 1)
        return Profile.model_validate(row.data) if row else None

    async def list_stages(self) -> list[StageRow]:
        """Return every Stage in Climb order."""
        async with self._session_factory() as session:
            result = await session.scalars(select(StageRow).order_by(StageRow.position))
            return list(result)

    async def list_projects(self) -> list[ProjectRow]:
        """Return every Project in display order."""
        async with self._session_factory() as session:
            result = await session.scalars(
                select(ProjectRow).order_by(ProjectRow.position)
            )
            return list(result)

    async def get_project(self, slug: str) -> ProjectRow | None:
        """Return one Project by slug, or None."""
        async with self._session_factory() as session:
            return await session.scalar(
                select(ProjectRow).where(ProjectRow.slug == slug)
            )

    async def sync(self, content: Content) -> None:
        """Make the tables hold exactly `content`, in one transaction.

        Rows are matched on Stage key and Project slug: existing ones are
        updated in place, new ones inserted, and rows missing from `content`
        deleted. Running it again with the same content changes nothing.
        """
        async with self._session_factory() as session, session.begin():
            profile_data = content.profile.model_dump()
            await session.execute(
                insert(ProfileRow)
                .values(id=1, data=profile_data)
                .on_conflict_do_update(
                    index_elements=["id"], set_={"data": profile_data}
                )
            )
            await _sync_stages(session, content.stages)
            await _sync_projects(session, content.projects)


async def _sync_stages(session: AsyncSession, stages: list[StageContent]) -> None:
    await session.execute(
        delete(StageRow).where(StageRow.key.not_in([stage.key for stage in stages]))
    )
    for position, stage in enumerate(stages):
        challenge, is_placeholder = split_challenge(stage.challenge)
        values: dict[str, Any] = {
            "position": position,
            "name": stage.name,
            "period": stage.period,
            "body": stage.body,
            "challenge": challenge,
            "challenge_is_placeholder": is_placeholder,
        }
        await session.execute(
            insert(StageRow)
            .values(key=stage.key, **values)
            .on_conflict_do_update(index_elements=["key"], set_=values)
        )


async def _sync_projects(session: AsyncSession, projects: list[Project]) -> None:
    await session.execute(
        delete(ProjectRow).where(
            ProjectRow.slug.not_in([project.slug for project in projects])
        )
    )
    for position, project in enumerate(projects):
        values: dict[str, Any] = {
            "position": position,
            "name": project.name,
            "tagline": project.tagline,
            "description": project.description,
            "stack": project.stack,
            "metrics": [metric.model_dump() for metric in project.metrics],
        }
        await session.execute(
            insert(ProjectRow)
            .values(slug=project.slug, **values)
            .on_conflict_do_update(index_elements=["slug"], set_=values)
        )
