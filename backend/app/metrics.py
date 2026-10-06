"""Prometheus metrics and the endpoint that serves them.

The endpoint is its own small ASGI app on its own port (`METRICS_PORT`), not a
route of the API. Caddy proxies only `/api/*` to the API's main port, so the
metrics cannot be reached from outside the Compose network. Labels carry an
endpoint name from a fixed list and nothing about a Visitor.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator

import structlog
import uvicorn
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    disable_created_metrics,
)
from prometheus_client.exposition import generate_latest
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.types import Receive, Scope, Send

logger = structlog.get_logger(__name__)

# The `_created` timestamp series double the output and tell Grafana nothing.
disable_created_metrics()

METRICS_PATH = "/metrics"
# The cached endpoints, as metric labels. A fixed list, never a request value.
CACHED_ENDPOINTS = ("profile", "stages", "projects", "project", "media")
ERROR_OPERATIONS = ("read", "write", "skipped")


class CacheMetrics:
    """Counters for the response cache, by endpoint."""

    def __init__(self, registry: CollectorRegistry) -> None:
        """Register the counters, with every series starting at zero."""
        self.hits = Counter(
            "portfolio_cache_hits",
            "Responses served from the Redis cache.",
            ["endpoint"],
            registry=registry,
        )
        self.misses = Counter(
            "portfolio_cache_misses",
            "Cache lookups that found nothing and read from Postgres.",
            ["endpoint"],
            registry=registry,
        )
        self.errors = Counter(
            "portfolio_cache_errors",
            "Cache operations that failed or were skipped while Redis is "
            "unavailable; the response came from Postgres.",
            ["endpoint", "operation"],
            registry=registry,
        )
        for endpoint in CACHED_ENDPOINTS:
            self.hits.labels(endpoint)
            self.misses.labels(endpoint)
            for operation in ERROR_OPERATIONS:
                self.errors.labels(endpoint, operation)


def create_metrics_app(registry: CollectorRegistry):  # noqa: ANN201
    """Build the ASGI app that serves `registry` at `/metrics` and 404s elsewhere."""

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return
        request = Request(scope, receive)
        response: Response
        if request.url.path == METRICS_PATH and request.method in ("GET", "HEAD"):
            response = Response(
                generate_latest(registry),
                media_type=CONTENT_TYPE_LATEST,
                headers={"Cache-Control": "no-store"},
            )
        else:
            response = PlainTextResponse("Not found", 404)
        await response(scope, receive, send)

    return app


@contextlib.asynccontextmanager
async def serve_metrics(
    registry: CollectorRegistry,
    port: int,
    host: str = "0.0.0.0",  # noqa: S104
) -> AsyncIterator[None]:
    """Serve the metrics on `port` for the length of the block; 0 disables it."""
    if port == 0:
        yield
        return
    server = uvicorn.Server(
        uvicorn.Config(
            create_metrics_app(registry),
            host=host,
            port=port,
            log_config=None,
            access_log=False,
            server_header=False,
            proxy_headers=False,
            lifespan="off",
        )
    )
    # Signal handlers belong to the main server, not to this one.
    server.install_signal_handlers = lambda: None  # type: ignore[method-assign]
    task = asyncio.create_task(server.serve())
    try:
        yield
    finally:
        server.should_exit = True
        await task
