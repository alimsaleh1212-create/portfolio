"""Clear the API's response cache: `python -m app.clear_cache`.

Starts a new cache generation and deletes the cache's own entries. Nothing else
in Redis is touched: the daily Visitor salt and the rate-limit counters stay.
"""

import asyncio
import sys

from prometheus_client import CollectorRegistry

from app.config import get_settings
from app.data.cache import create_redis
from app.data.response_cache import ResponseCache
from app.metrics import CacheMetrics


async def clear() -> None:
    """Invalidate the cache and report how many entries were removed."""
    settings = get_settings()
    redis = create_redis(settings.redis_url, 10.0)
    cache = ResponseCache(
        redis,
        CacheMetrics(CollectorRegistry()),
        ttl_seconds=settings.cache_ttl_seconds,
        timeout_seconds=10.0,
        retry_seconds=0,
    )
    try:
        await cache.invalidate()
    finally:
        await redis.aclose()
    sys.stdout.write("response cache cleared\n")


if __name__ == "__main__":
    asyncio.run(clear())
