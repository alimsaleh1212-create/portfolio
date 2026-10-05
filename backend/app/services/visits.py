"""Visit service: start a Visit, add events, apply the rate limits.

Progress is not computed here. It is derived in the database by the
`visit_progress` view from the Stage reached events.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated, Literal

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.content.schema import Slug, StageKey
from app.data.rate_limit import WindowCounter
from app.data.visitor_salt import utc_now
from app.data.visits_repo import NewEvent, NewVisit, VisitRepository
from app.services.bots import is_bot
from app.services.clients import REDIS_FAILURES, ClientHasher, ClientInfo
from app.services.referrer import referring_host

logger = structlog.get_logger(__name__)

RATE_LIMIT_WINDOW_SECONDS = 60
MAX_REFERRER_LENGTH = 2048

DeviceClass = Literal["phone", "tablet", "desktop"]
Tier = Literal["full", "light", "still"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartVisit(_Strict):
    """The body of `POST /visits`."""

    referrer: Annotated[str, Field(max_length=MAX_REFERRER_LENGTH)] | None = None
    """The page's `document.referrer`; only its host is kept."""
    device: DeviceClass
    tier: Tier | None = None


class StageReached(_Strict):
    """A Stage reached by the Visit."""

    type: Literal["stage_reached"]
    stage: StageKey


class ProjectOpened(_Strict):
    """A Project page opened."""

    type: Literal["project_opened"]
    project: Slug = Field(max_length=64)


class CvDownloaded(_Strict):
    """The CV PDF downloaded."""

    type: Literal["cv_downloaded"]


class ContactMessageSent(_Strict):
    """A contact message sent."""

    type: Literal["contact_message_sent"]


VisitEvent = Annotated[
    StageReached | ProjectOpened | CvDownloaded | ContactMessageSent,
    Field(discriminator="type"),
]


class VisitNotFoundError(Exception):
    """No Visit has this ID."""


class VisitExpiredError(Exception):
    """The Visit is older than the age limit and takes no more events."""


class RateLimitedError(Exception):
    """The client is over its request limit."""


class UnknownProjectError(Exception):
    """The Project slug is not a known Project."""


@dataclass(frozen=True)
class RateLimits:
    """Requests allowed per client per minute."""

    start: int
    event: int


class VisitService:
    """Records Visits and their events."""

    def __init__(
        self,
        repository: VisitRepository,
        hasher: ClientHasher,
        counter: WindowCounter,
        limits: RateLimits,
        max_age: timedelta,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        """Wire the collaborators; `clock` is replaceable in tests."""
        self._repository = repository
        self._hasher = hasher
        self._counter = counter
        self._limits = limits
        self._max_age = max_age
        self._clock = clock

    async def _enforce_limit(
        self, endpoint: Literal["start", "event"], client: ClientInfo
    ) -> None:
        """Count a request against its limit.

        Raises:
            RateLimitedError: The client is over the limit. Redis being
                unavailable never raises this: requests are let through.
        """
        key = await self._hasher.rate_limit_key(client)
        if key is None:
            return
        limit = self._limits.start if endpoint == "start" else self._limits.event
        try:
            count = await self._counter.hit(
                f"{endpoint}:{key}", RATE_LIMIT_WINDOW_SECONDS
            )
        except REDIS_FAILURES as exc:
            logger.warning("rate_limit_unavailable", reason=type(exc).__name__)
            return
        if count > limit:
            raise RateLimitedError

    async def start(
        self, body: StartVisit, client: ClientInfo, own_host: str | None
    ) -> uuid.UUID | None:
        """Start a Visit.

        Returns:
            The Visit's ID, or None for a known bot, which gets no Visit.

        Raises:
            RateLimitedError: The client is over its request limit.
        """
        if is_bot(client.user_agent):
            return None
        await self._enforce_limit("start", client)
        visitor_hash = await self._hasher.visitor_hash(client)
        return await self._repository.create(
            NewVisit(
                started_at=self._clock(),
                referrer_host=referring_host(body.referrer, own_host),
                device_class=body.device,
                tier=body.tier,
                visitor_hash=visitor_hash,
            )
        )

    async def add_event(
        self, visit_id: uuid.UUID, event: VisitEvent, client: ClientInfo
    ) -> None:
        """Add an event to a Visit.

        Raises:
            RateLimitedError: The client is over its request limit.
            VisitNotFoundError: No Visit has this ID.
            VisitExpiredError: The Visit is older than the age limit.
            UnknownProjectError: A Project opened event names an unknown slug.
        """
        await self._enforce_limit("event", client)
        now = self._clock()
        started_at = await self._repository.started_at(visit_id)
        if started_at is None:
            raise VisitNotFoundError
        if now - started_at > self._max_age:
            raise VisitExpiredError
        match event:
            case StageReached(stage=stage):
                new = NewEvent(event.type, now, stage_key=stage)
            case ProjectOpened(project=slug):
                if not await self._repository.project_exists(slug):
                    raise UnknownProjectError
                new = NewEvent(event.type, now, project_slug=slug)
            case CvDownloaded() | ContactMessageSent():
                new = NewEvent(event.type, now)
        await self._repository.add_event(visit_id, new)
