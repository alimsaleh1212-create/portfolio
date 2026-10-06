"""Redis access: client factory and the readiness probe."""

from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff


def create_redis(redis_url: str, connect_timeout: float) -> Redis:
    """Build the Redis client.

    Args:
        redis_url: Redis connection URL.
        connect_timeout: Seconds to wait for a connection and for each reply.

    Returns:
        A lazily connecting async client.
    """
    return Redis.from_url(
        redis_url,
        socket_connect_timeout=connect_timeout,
        socket_timeout=connect_timeout,
    )


class RedisProbe:
    """Readiness probe for Redis."""

    def __init__(self, client: Redis) -> None:
        """Store the client to probe."""
        self._client = client

    async def ping(self) -> None:
        """Send PING; raises if Redis cannot answer."""
        await self._client.ping()  # pyright: ignore[reportGeneralTypeIssues]


def create_cache_redis(redis_url: str, timeout: float) -> Redis:
    """Build the client the response cache uses.

    It is separate from the shared one so its short timeouts and no-retry
    policy cannot slow the readiness probe or the Visit counters, and a stalled
    Redis cannot hold a page for longer than `timeout`.
    """
    return Redis.from_url(
        redis_url,
        socket_connect_timeout=timeout,
        socket_timeout=timeout,
        retry=Retry(NoBackoff(), 0),
    )
