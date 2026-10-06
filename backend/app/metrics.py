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
    Histogram,
    disable_created_metrics,
)
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.exposition import generate_latest
from prometheus_client.registry import Collector
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.pool import QueuePool
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
# The methods the API can see. Anything else is one label value, so a client
# cannot create series by inventing methods.
KNOWN_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)


def clean_method(method: str) -> str:
    """Return the method if it is a standard one, else "OTHER"."""
    method = method.upper()
    return method if method in KNOWN_METHODS else "OTHER"


class HttpMetrics:
    """Request count and duration by method, route template and status.

    The route is the router's template (`/api/v1/projects/{slug}`), or
    "unmatched". It is never the raw path, so no Visit ID or slug is a label.
    """

    def __init__(self, registry: CollectorRegistry) -> None:
        """Register the request counter and the duration histogram."""
        self._requests = Counter(
            "portfolio_http_requests",
            "Requests answered, by method, route template and status code.",
            ["method", "route", "status"],
            registry=registry,
        )
        self._duration = Histogram(
            "portfolio_http_request_duration_seconds",
            "Time to answer a request, by method, route template and status code.",
            ["method", "route", "status"],
            buckets=LATENCY_BUCKETS,
            registry=registry,
        )

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        """Record one answered request."""
        labels = (method, route, str(status))
        self._requests.labels(*labels).inc()
        self._duration.labels(*labels).observe(seconds)


class PoolMetrics(Collector):
    """The database connection pool's state, read when Prometheus scrapes."""

    def __init__(self, engine: AsyncEngine, max_connections: int) -> None:
        """Remember the engine and the most connections it may open."""
        self._pool = engine.pool
        self._max_connections = max_connections

    def collect(self):  # noqa: ANN201
        """Yield connections in use and idle, and the limit."""
        pool = self._pool
        if not isinstance(pool, QueuePool):
            return
        connections = GaugeMetricFamily(
            "portfolio_db_pool_connections",
            "Database connections held by the API's pool, by state.",
            labels=["state"],
        )
        connections.add_metric(["in_use"], pool.checkedout())
        connections.add_metric(["idle"], pool.checkedin())
        yield connections
        limit = GaugeMetricFamily(
            "portfolio_db_pool_max_connections",
            "The most database connections the pool may open.",
        )
        limit.add_metric([], self._max_connections)
        yield limit


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
