"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import APIRouter, FastAPI

from app.api.v1 import health
from app.config import Settings, get_settings
from app.data.cache import RedisProbe, create_redis
from app.data.db import PostgresProbe, create_engine
from app.data.storage import MinioProbe, create_s3_client
from app.logging import configure_logging
from app.middleware import RequestIdMiddleware
from app.services.health import HealthService, Probe

logger = structlog.get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application.

    Args:
        settings: Settings to use. Defaults to the environment's.

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
        logger.info("startup_complete")
        yield
        await engine.dispose()
        await redis.aclose()
        s3.close()
        logger.info("shutdown_complete")

    app = FastAPI(title="Portfolio API", lifespan=lifespan)
    app.add_middleware(RequestIdMiddleware)

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(health.router)
    app.include_router(api_v1)
    return app
