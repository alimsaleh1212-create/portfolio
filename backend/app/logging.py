"""Structured JSON logging with a per-request ID.

Both structlog loggers and standard-library loggers (uvicorn, SQLAlchemy,
Alembic) are rendered as one JSON object per line on stdout.
"""

import logging
import sys
from typing import TextIO

import structlog

from app.telemetry import add_trace_ids

_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


class _StdoutHandler(logging.StreamHandler):
    """Write to whatever `sys.stdout` is at emit time (keeps tests' capture working)."""

    def __init__(self) -> None:
        super().__init__(sys.stdout)

    @property
    def stream(self) -> TextIO:  # pyright: ignore[reportIncompatibleVariableOverride]
        return sys.stdout

    @stream.setter
    def stream(self, _value: TextIO) -> None:
        return


def configure_logging(level: str = "INFO") -> None:
    """Route every log record through structlog's JSON renderer.

    Args:
        level: Root log level name, for example "INFO".
    """
    shared_processors: list[structlog.typing.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        add_trace_ids,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    handler = _StdoutHandler()
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared_processors,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                structlog.processors.format_exc_info,
                structlog.processors.JSONRenderer(),
            ],
        )
    )

    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())

    # Uvicorn installs its own plain-text handlers; hand its records to root.
    for name in _UVICORN_LOGGERS:
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

    # Uvicorn's access line contains the client IP, which ADR 0002 keeps out of
    # the logs. RequestIdMiddleware logs each request without it. Uvicorn skips
    # access logging when this logger has no handlers to reach.
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.propagate = False
