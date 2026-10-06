"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

import structlog
from fastapi import APIRouter, FastAPI

from app.api.v1 import content, health, media, visits
from app.config import Settings, get_settings
from app.data.cache import RedisProbe, create_redis
from app.data.content_repo import ContentRepository
from app.data.db import PostgresProbe, create_engine, create_session_factory
from app.data.media_repo import MediaRepository
from app.data.rate_limit import WindowCounter
from app.data.storage import MinioProbe, create_s3_client
from app.data.visitor_salt import Clock, DailySaltStore, utc_now
from app.data.visits_repo import VisitRepository
from app.logging import configure_logging
from app.middleware import BodyLimitMiddleware, RequestIdMiddleware
from app.services.clients import ClientHasher
from app.services.content import ContentService
from app.services.health import HealthService, Probe
from app.services.media import MediaService
from app.services.visits import RateLimits, VisitService

logger = structlog.get_logger(__name__)

# Request bodies are tiny JSON objects; anything bigger is refused.
MAX_BODY_BYTES = 4096


def create_app(settings: Settings | None = None, clock: Clock = utc_now) -> FastAPI:
    """Build the application.

    Args:
        settings: Settings to use. Defaults to the environment's.
        clock: Source of the current time for Visits and the daily salt.

    Returns:
        The configured FastAPI app.
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        timeout = settings.health_check_timeout_seconds
        engine = create_engine(settings.database_url, timeout)
        redis = create_redis(settings.redis_url, timeout)
        s3 = create_s3_client(
            settings.minio_endpoint,
            settings.minio_access_key,
            settings.minio_secret_key,
            timeout,
        )
        probes: dict[str, Probe] = {
            "postgres": PostgresProbe(engine),
            "redis": RedisProbe(redis),
            "minio": MinioProbe(s3, settings.minio_bucket),
        }
        app.state.health_service = HealthService(probes, timeout)
        session_factory = create_session_factory(engine)
        app.state.content_service = ContentService(ContentRepository(session_factory))
        app.state.media_service = MediaService(MediaRepository(session_factory))
        app.state.visit_service = VisitService(
            VisitRepository(session_factory),
            ClientHasher(DailySaltStore(redis, clock)),
            WindowCounter(redis),
            RateLimits(
                start=settings.visit_start_limit_per_minute,
                event=settings.visit_event_limit_per_minute,
            ),
            timedelta(hours=settings.visit_max_age_hours),
            clock,
        )
        logger.info("startup_complete")
        yield
        await engine.dispose()
        await redis.aclose()
        s3.close()
        logger.info("shutdown_complete")

    app = FastAPI(title="Portfolio API", lifespan=lifespan)
    # Added first, so it sits inside the request ID middleware and its 413 is logged.
    app.add_middleware(BodyLimitMiddleware, max_bytes=MAX_BODY_BYTES)
    app.add_middleware(RequestIdMiddleware)

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(health.router)
    api_v1.include_router(content.router)
    api_v1.include_router(media.router)
    api_v1.include_router(visits.router)
    app.include_router(api_v1)
    return app
