"""Redis access: client factory and the readiness probe."""

from redis.asyncio import Redis


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
