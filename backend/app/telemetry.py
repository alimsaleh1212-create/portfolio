"""OpenTelemetry tracing that is built to leave Visitors out.

The stock instrumentation libraries record the client address, the user agent,
forwarded-for headers and the text of database and Redis statements. ADR 0002
forbids all of that, and filtering it afterwards would mean it was captured
first. So this module does not use them. It creates the few spans the site
needs by hand and gives each one a fixed, short list of attributes:

- request span: HTTP method, route template and status code;
- database span: the system and the statement's verb (SELECT, INSERT, ...);
- Redis span: the system and the command name (GET, SET, ...), never a key.

Nothing is read from request headers, the ASGI client, the query string or the
raw path. Exceptions are never recorded on a span, only their class name,
because an exception's text can carry a statement's parameters.

Spans are exported only when an OTLP endpoint is configured. Without one they
are created (so log lines still get a trace ID) and dropped when they end.
"""

import contextlib
import re
import time
from collections.abc import Iterator
from typing import Any, cast

import structlog
from opentelemetry import context, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, SpanKind, Status, StatusCode, Tracer
from redis.asyncio import Redis
from redis.asyncio.client import Pipeline
from sqlalchemy import event
from sqlalchemy.engine import Connection
from sqlalchemy.engine.interfaces import ExceptionContext
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.metrics import UNMATCHED, HttpMetrics, clean_method

logger = structlog.get_logger(__name__)

SERVICE_NAME = "portfolio-api"
# The container healthcheck calls this every few seconds; tracing it is noise.
UNTRACED_PATHS = frozenset({"/api/v1/health/live"})
_SQL_VERBS = frozenset({"SELECT", "INSERT", "UPDATE", "DELETE"})
_SPANS_KEY = "telemetry_spans"


def create_tracer_provider(endpoint: str | None) -> TracerProvider:
    """Build the tracer provider, exporting only when an endpoint is set.

    Args:
        endpoint: Base URL of an OTLP/HTTP receiver, or None to export nothing.

    Returns:
        A provider whose resource names this service and nothing else.
    """
    provider = TracerProvider(resource=Resource.create({"service.name": SERVICE_NAME}))
    if endpoint:
        exporter = OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
    return provider


def add_trace_ids(
    _logger: Any, _method: str, event_dict: structlog.typing.EventDict
) -> structlog.typing.EventDict:
    """Structlog processor: add the current trace and span IDs, when in a span."""
    span_context = trace.get_current_span().get_span_context()
    if span_context.is_valid:
        event_dict["trace_id"] = format(span_context.trace_id, "032x")
        event_dict["span_id"] = format(span_context.span_id, "016x")
    return event_dict


@contextlib.contextmanager
def child_span(tracer: Tracer, name: str, attributes: dict[str, str]) -> Iterator[None]:
    """Run a block in a child span, only when a request span is active.

    Work outside a request (startup, the seed) is not traced, so it cannot
    become a stream of one-span traces.
    """
    if not trace.get_current_span().get_span_context().is_valid:
        yield
        return
    with tracer.start_as_current_span(
        name,
        kind=SpanKind.CLIENT,
        attributes=attributes,
        record_exception=False,
        set_status_on_exception=False,
    ) as span:
        try:
            yield
        except BaseException as exc:
            mark_failed(span, exc)
            raise


def mark_failed(span: Span, exc: BaseException) -> None:
    """Flag a span as failed, recording the exception's class and nothing else."""
    span.set_attribute("error.type", type(exc).__name__)
    span.set_status(Status(StatusCode.ERROR))


# --- database ---------------------------------------------------------------


def trace_database(engine: AsyncEngine, tracer: Tracer) -> None:
    """Add a span for each statement the engine runs.

    The span carries the statement's verb only. The statement text and its
    parameters are never read.
    """
    sync_engine = engine.sync_engine

    @event.listens_for(sync_engine, "before_cursor_execute")
    def before(  # pyright: ignore[reportUnusedFunction]
        conn: Connection, _cursor: Any, statement: str, *_rest: Any
    ) -> None:
        if not trace.get_current_span().get_span_context().is_valid:
            return
        words = statement.split(None, 1)
        verb = words[0].upper() if words else ""
        verb = verb if verb in _SQL_VERBS else "QUERY"
        span = tracer.start_span(
            f"db {verb}",
            kind=SpanKind.CLIENT,
            attributes={"db.system": "postgresql", "db.operation": verb},
        )
        conn.info.setdefault(_SPANS_KEY, []).append(span)

    @event.listens_for(sync_engine, "after_cursor_execute")
    def after(  # pyright: ignore[reportUnusedFunction]
        conn: Connection, *_rest: Any
    ) -> None:
        spans = conn.info.get(_SPANS_KEY)
        if spans:
            spans.pop().end()

    @event.listens_for(sync_engine, "handle_error")
    def failed(ctx: ExceptionContext) -> None:  # pyright: ignore[reportUnusedFunction]
        spans = ctx.connection.info.get(_SPANS_KEY) if ctx.connection else None
        if spans:
            span = spans.pop()
            mark_failed(span, ctx.original_exception)
            span.end()


# --- redis ------------------------------------------------------------------


class TracedPipeline(Pipeline):
    """A Redis pipeline whose execution is one span with no commands in it."""

    _tracer: Tracer

    async def execute(self, raise_on_error: bool = True) -> list[Any]:
        """Run the queued commands inside one span."""
        with child_span(self._tracer, "redis PIPELINE", {"db.system": "redis"}):  # pyright: ignore[reportAttributeAccessIssue]
            return await super().execute(raise_on_error)


class TracedRedis(Redis):
    """A Redis client that traces each command by name, never by key or value."""

    _tracer: Tracer | None = None

    @classmethod
    def connect(cls, url: str, tracer: Tracer, **kwargs: Any) -> "TracedRedis":
        """Build a client from a URL that traces with `tracer`."""
        client = cast("TracedRedis", cls.from_url(url, **kwargs))
        client._tracer = tracer
        return client

    async def execute_command(self, *args: Any, **options: Any) -> Any:
        """Run one command inside a span named after the command."""
        if self._tracer is None:
            return await super().execute_command(*args, **options)
        name = str(args[0]).split(" ", 1)[0].upper()
        with child_span(
            self._tracer, f"redis {name}", {"db.system": "redis", "db.operation": name}
        ):
            return await super().execute_command(*args, **options)

    def pipeline(self, transaction: bool = True, shard_hint: Any = None) -> Pipeline:
        """Return a pipeline that is traced like the client."""
        pipe = TracedPipeline(
            self.connection_pool, self.response_callbacks, transaction, shard_hint
        )
        pipe._tracer = self._tracer or trace.NoOpTracer()
        return pipe


# --- requests ---------------------------------------------------------------


def route_template(scope: Scope) -> str:
    """Return the matched route's template with its router prefix, or "unmatched".

    The router keeps routes relative to the router that holds them
    (`/visits/{visit_id}/events`), so the prefix (`/api/v1`) is recovered from
    the request path: whatever precedes the part the route's pattern matched.
    A path parameter's value is inside that matched part and never appears.
    """
    route = scope.get("route")
    template: str | None = getattr(route, "path_format", None)
    if not template:
        return UNMATCHED
    pattern = getattr(getattr(route, "path_regex", None), "pattern", "")
    match = re.search(pattern.removeprefix("^"), scope["path"])
    return scope["path"][: match.start()] + template if match else template


class TelemetryMiddleware:
    """Time each request, count it, and give it a span.

    Outermost, so the span is current while the request ID middleware writes
    the request's log line and every line carries the trace ID. The route
    template comes from the router after it has matched; a raw path is never
    used, so an ID or a slug cannot become a span name or a label.
    """

    def __init__(self, app: ASGIApp, tracer: Tracer, metrics: HttpMetrics) -> None:
        """Wrap an ASGI app."""
        self.app = app
        self._tracer = tracer
        self._metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI connection."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = clean_method(scope["method"])
        span: Span | None = None
        token = None
        if scope["path"] not in UNTRACED_PATHS:
            span = self._tracer.start_span(f"{method} request", kind=SpanKind.SERVER)
            token = context.attach(trace.set_span_in_context(span))

        status = 500
        failure: BaseException | None = None
        started = time.perf_counter()

        async def send_and_note_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_note_status)
        except BaseException as exc:
            failure = exc
            raise
        finally:
            elapsed = time.perf_counter() - started
            route = route_template(scope)
            self._metrics.observe(method, route, status, elapsed)
            if span is not None and token is not None:
                span.update_name(f"{method} {route}")
                span.set_attribute("http.request.method", method)
                span.set_attribute("http.route", route)
                span.set_attribute("http.response.status_code", status)
                if failure is not None:
                    mark_failed(span, failure)
                elif status >= 500:
                    span.set_status(Status(StatusCode.ERROR))
                context.detach(token)
                span.end()
