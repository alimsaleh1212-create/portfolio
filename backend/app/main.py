"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

import structlog
from fastapi import APIRouter, FastAPI
from fastapi.exceptions import RequestValidationError
from opentelemetry.sdk.trace import TracerProvider
from prometheus_client import CollectorRegistry

from app.api.v1 import contact, content, health, media, visits
from app.api.v1.errors import CONTACT_PATH, validation_error_handler
from app.config import Settings, get_settings
from app.data.cache import RedisProbe, create_cache_redis, create_redis
from app.data.contact_repo import ContactRepository
from app.data.content_repo import ContentRepository
from app.data.db import (
    MAX_OVERFLOW,
    POOL_SIZE,
    PostgresProbe,
    create_engine,
    create_session_factory,
)
from app.data.media_repo import MediaRepository
from app.data.rate_limit import WindowCounter
from app.data.response_cache import ResponseCache
from app.data.storage import MinioProbe, create_s3_client
from app.data.visitor_salt import Clock, DailySaltStore, utc_now
from app.data.visits_repo import VisitRepository
from app.logging import configure_logging
from app.metrics import (
    KNOWN_METHODS,
    CacheMetrics,
    HttpMetrics,
    PoolMetrics,
    serve_metrics,
)
from app.middleware import BodyLimitMiddleware, NoStoreMiddleware, RequestIdMiddleware
from app.services.clients import ClientHasher
from app.services.contact import ContactService
from app.services.content import ContentService
from app.services.health import HealthService, Probe
from app.services.mailer import MailDelivery, MailSettings
from app.services.media import MediaService
from app.services.visits import RateLimits, VisitService
from app.telemetry import (
    SERVICE_NAME,
    TelemetryMiddleware,
    create_tracer_provider,
    trace_database,
)

logger = structlog.get_logger(__name__)

# Request bodies are tiny JSON objects; anything bigger is refused.
MAX_BODY_BYTES = 4096
# A message of 4000 characters can be 16 KB in UTF-8 and more when JSON escapes it.
CONTACT_MAX_BODY_BYTES = 32768


def mail_settings(settings: Settings) -> MailSettings | None:
    """Return the mail settings, or None unless all the needed ones are set."""
    if not (settings.smtp_host and settings.mail_sender and settings.mail_recipient):
        return None
    return MailSettings(
        host=settings.smtp_host,
        port=settings.smtp_port,
        security=settings.smtp_security,
        sender=settings.mail_sender,
        recipient=settings.mail_recipient,
        timeout_seconds=settings.smtp_timeout_seconds,
        username=settings.smtp_username,
        password=settings.smtp_password,
    )


def documented_routes(app: FastAPI) -> dict[str, list[str]]:
    """Return each route template with its HTTP methods, from the OpenAPI schema.

    The schema has the full templates (`/api/v1/projects/{slug}`), which the
    router itself keeps relative to the router that holds them.
    """
    paths: dict[str, dict[str, object]] = app.openapi().get("paths", {})
    return {
        path: [
            method.upper() for method in operations if method.upper() in KNOWN_METHODS
        ]
        for path, operations in paths.items()
    }


def create_app(
    settings: Settings | None = None,
    clock: Clock = utc_now,
    tracer_provider: TracerProvider | None = None,
) -> FastAPI:
    """Build the application.

    Args:
        settings: Settings to use. Defaults to the environment's.
        clock: Source of the current time for Visits and the daily salt.
        tracer_provider: Where spans go. Defaults to one that exports to the
            configured OTLP endpoint, or nowhere when there is none.

    Returns:
        The configured FastAPI app.
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    mail_enabled = mail_settings(settings) is not None
    # Counters live in one registry per app; the metrics endpoint serves it.
    registry = CollectorRegistry()
    owns_provider = tracer_provider is None
    provider = tracer_provider or create_tracer_provider(
        settings.otel_exporter_otlp_endpoint
    )
    tracer = provider.get_tracer(SERVICE_NAME)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        timeout = settings.health_check_timeout_seconds
        engine = create_engine(settings.database_url, timeout)
        trace_database(engine, tracer)
        pool_metrics = PoolMetrics(engine, POOL_SIZE + MAX_OVERFLOW)
        registry.register(pool_metrics)
        redis = create_redis(settings.redis_url, timeout, tracer)
        cache_redis = create_cache_redis(
            settings.redis_url, settings.cache_timeout_seconds, tracer
        )
        cache = ResponseCache(
            cache_redis,
            CacheMetrics(registry),
            ttl_seconds=settings.cache_ttl_seconds,
            timeout_seconds=settings.cache_timeout_seconds,
            retry_seconds=settings.cache_retry_seconds,
        )
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
        app.state.content_service = ContentService(
            ContentRepository(session_factory), cache
        )
        app.state.media_service = MediaService(MediaRepository(session_factory), cache)
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
        app.state.contact_service = ContactService(
            ContactRepository(session_factory),
            ClientHasher(DailySaltStore(redis, clock)),
            WindowCounter(redis),
            settings.contact_limit_per_hour,
            MailDelivery(mail_settings(settings)),
        )
        logger.info("startup_complete", contact_delivery=mail_enabled)
        async with serve_metrics(registry, settings.metrics_port):
            yield
        registry.unregister(pool_metrics)
        await engine.dispose()
        await redis.aclose()
        await cache_redis.aclose()
        s3.close()
        if owns_provider:
            provider.shutdown()
        logger.info("shutdown_complete")

    # FastAPI 0.142 has its own OpenTelemetry support. With an OTLP endpoint in
    # the environment it would add exporters for traces, metrics and logs, and its
    # records can carry validation input values and exception messages, which
    # hold what a Visitor typed. Everything is off: app/telemetry.py makes the
    # spans, with a fixed attribute list.
    http_metrics = HttpMetrics(registry)
    app = FastAPI(
        title="Portfolio API",
        lifespan=lifespan,
        telemetry={
            "auto_configure": False,
            "tracing": False,
            "metrics": False,
            "logs": False,
            "operation_spans": False,
        },
    )
    # Added first, so it sits inside the request ID middleware and its 413 is logged.
    app.add_middleware(
        BodyLimitMiddleware,
        max_bytes=MAX_BODY_BYTES,
        path_limits={CONTACT_PATH: CONTACT_MAX_BODY_BYTES},
    )
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_middleware(RequestIdMiddleware)
    # Outermost, so even an answer made by the layers above gets its header.
    app.add_middleware(NoStoreMiddleware)
    # Outermost of all: its span is current for the request's log lines.
    app.add_middleware(TelemetryMiddleware, tracer=tracer, metrics=http_metrics)

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(health.router)
    api_v1.include_router(content.router)
    api_v1.include_router(media.router)
    api_v1.include_router(visits.router)
    api_v1.include_router(contact.router)
    app.include_router(api_v1)
    app.state.metrics_registry = registry
    http_metrics.prime(documented_routes(app))
    return app
