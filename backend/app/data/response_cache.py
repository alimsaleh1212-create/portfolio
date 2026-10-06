"""The Redis response cache for the read endpoints.

Only the seed changes what these endpoints return, so a cached body is valid
until the next seed. The cache works like this:

* Every entry lives under the key ``api-cache:<generation>:<name>``. The
  generation is a random token stored at ``api-cache:generation``.
* A reader reads the generation first, then the entry. On a miss it loads from
  Postgres and stores the result under the generation it read *before* loading.
* The seed, after its transaction commits, stores a new generation. From then on
  every reader looks under the new token, so no old entry can be served, and a
  reader that was mid-load when the seed finished can only write into the old,
  abandoned namespace, where nothing reads it. No lock or version check is
  needed for that to hold. Old entries are removed by an expiry, which is a
  safety net only.
* Everything sits under the ``api-cache:`` prefix. Clearing the cache never
  touches ``visitor-salt:`` or ``rate-limit:`` keys, and never flushes a
  database.

Redis is optional. A failure or a stall (bounded by a short timeout) means the
request is answered from Postgres. After a failure the cache is skipped for a
short cool-down, so a dead Redis costs one timeout, not one per request, and the
log gets one warning, not one per request.
"""

import asyncio
import secrets
import time
from collections.abc import Awaitable, Callable

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.metrics import CacheMetrics

logger = structlog.get_logger(__name__)

CACHE_PREFIX = "api-cache:"
GENERATION_KEY = f"{CACHE_PREFIX}generation"
# The most often a persistent outage logs a warning again.
WARNING_INTERVAL_SECONDS = 60.0
PURGE_BATCH = 200


def new_generation() -> str:
    """Return a fresh, unguessable generation token."""
    return secrets.token_hex(8)


class ResponseCache:
    """Cached response bodies, invalidated all at once by a new generation."""

    def __init__(
        self,
        redis: Redis,
        metrics: CacheMetrics,
        *,
        ttl_seconds: int,
        timeout_seconds: float,
        retry_seconds: float,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        """Store the client, the metrics and the timing settings.

        Args:
            redis: A client with short socket timeouts.
            metrics: Where hits, misses and errors are counted.
            ttl_seconds: Expiry of each entry; a safety net, not the mechanism.
            timeout_seconds: Longest any one cache operation may take.
            retry_seconds: How long to skip the cache after a failure.
            monotonic: Clock for the cool-down and the warning interval.
        """
        self._redis = redis
        self._metrics = metrics
        self._ttl = ttl_seconds
        self._timeout = timeout_seconds
        self._retry = retry_seconds
        self._monotonic = monotonic
        self._skip_until = 0.0
        self._last_warning: float | None = None
        self._failing = False

    async def get_or_load(
        self, endpoint: str, name: str, load: Callable[[], Awaitable[bytes]]
    ) -> bytes:
        """Return the cached body for `name`, loading and storing it on a miss.

        Args:
            endpoint: Metric label, one of `CACHED_ENDPOINTS`.
            name: Entry name within the current generation.
            load: Reads Postgres and returns the serialised body. Whatever it
                raises is not a cache problem and propagates; nothing is stored.

        Returns:
            The body bytes, from Redis or from `load`.
        """
        generation: str | None = None
        cached: bytes | None = None
        raw: bytes | str | None = None
        if self._monotonic() < self._skip_until:
            self._metrics.errors.labels(endpoint, "skipped").inc()
        else:
            try:
                async with asyncio.timeout(self._timeout):
                    generation = await self._read_generation()
                    raw = await self._redis.get(self._entry_key(generation, name))
            except (RedisError, OSError, TimeoutError) as exc:
                generation = None
                self._record_failure(endpoint, "read", exc)
            else:
                self._record_success()
                cached = raw.encode() if isinstance(raw, str) else raw
        if cached is not None:
            self._metrics.hits.labels(endpoint).inc()
            return cached
        if generation is not None:
            self._metrics.misses.labels(endpoint).inc()
        # The generation above was read before this load starts, which is what
        # makes the store below safe: see the module docstring.
        body = await load()
        if generation is not None:
            try:
                async with asyncio.timeout(self._timeout):
                    await self._redis.set(
                        self._entry_key(generation, name), body, ex=self._ttl
                    )
            except (RedisError, OSError, TimeoutError) as exc:
                self._record_failure(endpoint, "write", exc)
        return body

    async def invalidate(self) -> None:
        """Start a new generation, then delete the old entries.

        Called by the seed after its transaction commits. Only keys under the
        cache prefix are deleted.

        Raises:
            redis.exceptions.RedisError: Redis cannot answer.
            OSError: The connection to Redis failed.
        """
        await self._redis.set(GENERATION_KEY, new_generation())
        await self.purge()

    async def purge(self) -> int:
        """Delete the cache's entries and keep the current generation token.

        Returns:
            How many entries were deleted.
        """
        deleted = 0
        batch: list[bytes] = []
        async for key in self._redis.scan_iter(
            match=f"{CACHE_PREFIX}*", count=PURGE_BATCH
        ):
            if key == GENERATION_KEY.encode():
                continue
            batch.append(key)
            if len(batch) >= PURGE_BATCH:
                deleted += await self._redis.unlink(*batch)
                batch = []
        if batch:
            deleted += await self._redis.unlink(*batch)
        return deleted

    async def _read_generation(self) -> str:
        value = await self._redis.get(GENERATION_KEY)
        if value is None:
            # First use, or the token was lost. NX: when requests race here, one
            # token wins and all of them read it back.
            await self._redis.set(GENERATION_KEY, new_generation(), nx=True)
            value = await self._redis.get(GENERATION_KEY)
        if value is None:
            raise LookupError("the cache generation vanished")
        return value.decode() if isinstance(value, bytes) else str(value)

    @staticmethod
    def _entry_key(generation: str, name: str) -> str:
        return f"{CACHE_PREFIX}{generation}:{name}"

    def _record_failure(self, endpoint: str, operation: str, exc: Exception) -> None:
        now = self._monotonic()
        self._skip_until = now + self._retry
        self._failing = True
        self._metrics.errors.labels(endpoint, operation).inc()
        if (
            self._last_warning is None
            or now - self._last_warning >= WARNING_INTERVAL_SECONDS
        ):
            self._last_warning = now
            # The class name only: a Redis error's text can carry the address.
            logger.warning(
                "cache_unavailable",
                operation=operation,
                error=type(exc).__name__,
                detail="answering from Postgres",
            )

    def _record_success(self) -> None:
        if self._failing:
            self._failing = False
            self._last_warning = None
            logger.info("cache_recovered")
