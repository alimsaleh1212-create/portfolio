"""Content service: the profile, Stages and Projects as typed responses."""

import re

from pydantic import BaseModel, TypeAdapter

from app.content.schema import Profile, Project, StageKey
from app.data.content_repo import ContentRepository
from app.data.response_cache import ResponseCache

# The shape the content schema allows. A slug that does not match cannot name a
# Project, so it is refused before any cache or database is asked.
SLUG_SHAPE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_SLUG_LENGTH = 100


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


PROFILE_JSON = TypeAdapter(Profile)
STAGES_JSON = TypeAdapter(list[Stage])
PROJECTS_JSON = TypeAdapter(list[Project])


class ContentService:
    """Serves the seeded content as JSON bodies, through the response cache."""

    def __init__(self, repository: ContentRepository, cache: ResponseCache) -> None:
        """Store the repository to read from and the cache in front of it."""
        self._repository = repository
        self._cache = cache

    async def get_profile(self) -> bytes:
        """Return the profile as a JSON body.

        Raises:
            ContentNotSeededError: If the seed has not run. This is not cached.
        """

        async def load() -> bytes:
            profile = await self._repository.get_profile()
            if profile is None:
                raise ContentNotSeededError
            return PROFILE_JSON.dump_json(profile)

        return await self._cache.get_or_load("profile", "profile", load)

    async def list_stages(self) -> bytes:
        """Return the Stages in Climb order as a JSON body."""

        async def load() -> bytes:
            rows = await self._repository.list_stages()
            return STAGES_JSON.dump_json(
                [
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
            )

        return await self._cache.get_or_load("stages", "stages", load)

    async def list_projects(self) -> bytes:
        """Return the Projects in display order as a JSON body."""
        return await self._cache.get_or_load(
            "projects", "projects", self._load_projects
        )

    async def get_project(self, slug: str) -> bytes:
        """Return one Project as a JSON body.

        An entry is only ever made for a slug found in the Projects list, and
        the list is itself cached, so unknown slugs cost no database query and
        add nothing to Redis, however many are tried.

        Raises:
            ProjectNotFoundError: If no Project has this slug.
        """
        if len(slug) > MAX_SLUG_LENGTH or not SLUG_SHAPE.fullmatch(slug):
            raise ProjectNotFoundError(slug)

        async def load() -> bytes:
            projects = PROJECTS_JSON.validate_json(await self.list_projects())
            for project in projects:
                if project.slug == slug:
                    return project.model_dump_json().encode()
            raise ProjectNotFoundError(slug)

        return await self._cache.get_or_load("project", f"project:{slug}", load)

    async def _load_projects(self) -> bytes:
        rows = await self._repository.list_projects()
        return PROJECTS_JSON.dump_json(
            [Project.model_validate(row, from_attributes=True) for row in rows]
        )
