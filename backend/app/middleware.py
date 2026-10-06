"""ASGI middleware: request ID binding and one access-style log line."""

import re
import time
import uuid

import structlog
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
# Inbound IDs end up in logs, so only accept a short, harmless alphabet.
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

BODY_TOO_LARGE = "Request body too large."

logger = structlog.get_logger(__name__)


def resolve_request_id(inbound: str | None) -> str:
    """Return the inbound request ID if it is acceptable, else a new one.

    Args:
        inbound: Value of the incoming X-Request-ID header, if any.

    Returns:
        A request ID safe to log and echo back.
    """
    if inbound and _VALID_REQUEST_ID.fullmatch(inbound):
        return inbound
    return uuid.uuid4().hex


class RequestIdMiddleware:
    """Bind a request ID to every log line and return it as a header.

    Logging one line per request here, rather than relying on uvicorn's access
    log, keeps client IP addresses out of the logs (ADR 0002) and puts the
    request ID on the line.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap an ASGI app."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI connection."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        inbound = headers.get(REQUEST_ID_HEADER.lower().encode(), b"").decode("latin-1")
        request_id = resolve_request_id(inbound or None)

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        status_code = 500
        response_started = False
        started_at = time.perf_counter()

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            logger.exception(
                "request_failed", method=scope["method"], path=scope["path"]
            )
            if response_started:
                raise
            status_code = 500
            error_response = JSONResponse(
                {"detail": "Internal server error."},
                status_code=500,
                headers={REQUEST_ID_HEADER: request_id},
            )
            await error_response(scope, receive, send)
        finally:
            logger.info(
                "request",
                method=scope["method"],
                path=scope["path"],
                status=status_code,
                duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
            )
            structlog.contextvars.clear_contextvars()


class NoStoreMiddleware:
    """Mark every `/api/` response `Cache-Control: no-store` unless it says otherwise.

    The cached read endpoints set their own `Cache-Control`. Everything else the
    API answers (Visits, contact, health, errors, unknown paths) must never be
    stored by a browser or a proxy, so this is the default rather than a list
    to remember to extend. It also covers answers produced before a route runs,
    such as a 413 or a 422.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap an ASGI app."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI connection."""
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def send_with_default(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_default)


class BodyLimitMiddleware:
    """Refuse request bodies larger than a small limit with 413.

    The check uses `Content-Length` when present and counts streamed bytes
    otherwise, so chunked uploads cannot slip past it.
    """

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        path_limits: dict[str, int] | None = None,
    ) -> None:
        """Wrap an ASGI app; `path_limits` gives some paths a larger limit."""
        self.app = app
        self._max_bytes = max_bytes
        self._path_limits = path_limits or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Handle one ASGI connection."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = self._path_limits.get(scope["path"], self._max_bytes)
        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > max_bytes:
            await self._refuse(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    # An HTTPException passes through FastAPI's body parsing (any other
                    # exception there becomes a 400) and is answered as a 413.
                    raise HTTPException(status_code=413, detail=BODY_TOO_LARGE)
            return message

        await self.app(scope, counting_receive, send)

    @staticmethod
    async def _refuse(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse({"detail": BODY_TOO_LARGE}, status_code=413)
        await response(scope, receive, send)
