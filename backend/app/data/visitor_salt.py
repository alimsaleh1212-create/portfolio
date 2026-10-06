"""The daily salt behind the Visitor hash. It lives in Redis only (ADR 0002).

A new random salt is made on the first use each UTC day and expires shortly
after that day ends. Once it has expired nobody, including us, can recompute or
link that day's hashes. It is never written to Postgres or to a log.
"""

import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis

SALT_KEY_PREFIX = "visitor-salt:"
# Kept a little past midnight so a request that straddles the day change finishes.
SALT_GRACE_SECONDS = 300

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    """Return the current time, timezone-aware, in UTC."""
    return datetime.now(UTC)


class DailySaltStore:
    """Hands out the salt for the current UTC day, creating it on first use."""

    def __init__(self, redis: Redis, clock: Clock = utc_now) -> None:
        """Store the Redis client and the clock (replaceable in tests)."""
        self._redis = redis
        self._clock = clock

    async def current(self) -> bytes:
        """Return today's salt.

        Raises:
            redis.exceptions.RedisError: Redis cannot answer.
            OSError: The connection to Redis failed.
        """
        now = self._clock().astimezone(UTC)
        key = f"{SALT_KEY_PREFIX}{now:%Y-%m-%d}"
        end_of_day = datetime.combine(
            now.date() + timedelta(days=1), datetime.min.time(), UTC
        )
        ttl = int((end_of_day - now).total_seconds()) + SALT_GRACE_SECONDS
        # NX: when two requests race on the first use, one salt wins and both read it.
        await self._redis.set(key, secrets.token_hex(32), ex=ttl, nx=True)
        value = await self._redis.get(key)
        if value is None:
            raise LookupError("the daily salt vanished")
        return value if isinstance(value, bytes) else str(value).encode()
