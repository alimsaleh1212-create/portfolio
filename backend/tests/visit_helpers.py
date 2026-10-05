"""Helpers for the Visit tests: a movable clock, Redis and database setup."""

from datetime import UTC, datetime, timedelta
from typing import Any

from redis import Redis
from sqlalchemy.engine import make_url

from tests.db_helpers import execute

CHROME_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
STAGE_KEYS = ["trailhead", "long-approach", "steep-switch", "ridge", "high-camp"]
PROJECT_SLUGS = ["alpha-agent", "beta-pipeline"]
# Documentation addresses (RFC 5737 and 3849): safe to grep for in output.
CLIENT_IP = "203.0.113.77"
OTHER_IP = "198.51.100.23"
IPV6 = "2001:db8::77"


class FakeClock:
    """A clock tests can move forwards."""

    def __init__(self) -> None:
        """Start at noon UTC on a fixed day."""
        self.now = datetime(2030, 3, 14, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        """Return the current fake time."""
        return self.now

    def advance(self, **kwargs: float) -> None:
        """Move the clock forwards."""
        self.now += timedelta(**kwargs)


def scratch_redis_url(redis_url: str) -> str:
    """Point the Redis URL at database 15, which only tests use."""
    return make_url(redis_url).set(database="15").render_as_string(hide_password=False)


def seed_content_rows(database_url: str) -> None:
    """Insert the five Stages and two Projects the Visit tests refer to."""
    execute(
        database_url,
        "TRUNCATE visits, stages, projects, media_items, profile "
        "RESTART IDENTITY CASCADE",
    )
    stages = ", ".join(
        f"('{key}', {i}, '{key}', 'b', 'c', false)" for i, key in enumerate(STAGE_KEYS)
    )
    execute(
        database_url,
        f"INSERT INTO stages (key, position, name, body, challenge, "  # noqa: S608
        f"challenge_is_placeholder) VALUES {stages}",
    )
    projects = ", ".join(
        f"('{slug}', {i}, 'n', 't', 'd', '{{}}', '[]'::jsonb)"
        for i, slug in enumerate(PROJECT_SLUGS)
    )
    execute(
        database_url,
        f"INSERT INTO projects (slug, position, name, tagline, description, "  # noqa: S608
        f"stack, metrics) VALUES {projects}",
    )


def as_text(value: Any) -> str:
    """Return a Redis reply as text."""
    return value.decode() if isinstance(value, bytes) else str(value)


def redis_dump(redis: Redis) -> str:
    """Return every key and value in the Redis database as one string."""
    parts: list[str] = []
    for key in redis.scan_iter("*"):
        parts.append(as_text(key))
        value = redis.get(key)
        if value is not None:
            parts.append(as_text(value))
    return "\n".join(parts)
