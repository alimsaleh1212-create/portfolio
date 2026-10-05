"""Content service: the profile, Stages and Projects as typed responses."""

from pydantic import BaseModel

from app.content.schema import Profile, Project, StageKey
from app.data.content_repo import ContentRepository


class ContentNotSeededError(Exception):
    """The profile table is empty: the seed has not run."""


class ProjectNotFoundError(Exception):
    """No Project has the requested slug."""


class Stage(BaseModel):
    """One Stage of the Climb, as the API serves it."""

    key: StageKey
    name: str
    period: str | None
    body: str
    challenge: str
    """The Challenge text without the placeholder marker."""
    challenge_is_placeholder: bool
    """True while Ali has not yet written the Challenge."""


class ContentService:
    """Serves the seeded content."""

    def __init__(self, repository: ContentRepository) -> None:
        """Store the repository to read from."""
        self._repository = repository

    async def get_profile(self) -> Profile:
        """Return the profile.

        Raises:
            ContentNotSeededError: If the seed has not run.
        """
        profile = await self._repository.get_profile()
        if profile is None:
            raise ContentNotSeededError
        return profile

    async def list_stages(self) -> list[Stage]:
        """Return the Stages in Climb order."""
        rows = await self._repository.list_stages()
        return [
            Stage(
                key=row.key,  # pyright: ignore[reportArgumentType]
                name=row.name,
                period=row.period,
                body=row.body,
                challenge=row.challenge,
                challenge_is_placeholder=row.challenge_is_placeholder,
            )
            for row in rows
        ]

    async def list_projects(self) -> list[Project]:
        """Return the Projects in display order."""
        rows = await self._repository.list_projects()
        return [Project.model_validate(row, from_attributes=True) for row in rows]

    async def get_project(self, slug: str) -> Project:
        """Return one Project.

        Raises:
            ProjectNotFoundError: If no Project has this slug.
        """
        row = await self._repository.get_project(slug)
        if row is None:
            raise ProjectNotFoundError(slug)
        return Project.model_validate(row, from_attributes=True)
