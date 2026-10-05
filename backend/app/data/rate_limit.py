"""Fixed-window request counter kept in Redis."""

from redis.asyncio import Redis

RATE_LIMIT_KEY_PREFIX = "rate-limit:"


class WindowCounter:
    """Counts hits per key in a fixed window that expires by itself."""

    def __init__(self, redis: Redis) -> None:
        """Store the Redis client."""
        self._redis = redis

    async def hit(self, key: str, window_seconds: int) -> int:
        """Count one hit.

        Args:
            key: Counter name. Must not contain anything identifying (no IP).
            window_seconds: How long the counter lives from its first hit.

        Returns:
            The number of hits in the current window, this one included.

        Raises:
            redis.exceptions.RedisError: Redis cannot answer.
            OSError: The connection to Redis failed.
        """
        full_key = f"{RATE_LIMIT_KEY_PREFIX}{key}"
        pipe = self._redis.pipeline()
        pipe.incr(full_key)
        pipe.expire(full_key, window_seconds, nx=True)
        count, _ = await pipe.execute()
        return int(count)
