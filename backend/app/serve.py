"""Process entry point: `python -m app.serve`.

Configures JSON logging before uvicorn starts so uvicorn's own lines are JSON.
"""

import os

import uvicorn

from app.logging import configure_logging


def main() -> None:
    """Run uvicorn with JSON logs. Set RELOAD=1 for development hot reload."""
    configure_logging(os.environ.get("LOG_LEVEL", "INFO"))
    reload = os.environ.get("RELOAD") == "1"
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="0.0.0.0",  # noqa: S104 - bound inside the container only
        port=8000,
        reload=reload,
        # Leave the loggers alone; app.logging already routes them to JSON.
        log_config=None,
        # Our middleware logs requests without client IPs (ADR 0002).
        access_log=False,
        proxy_headers=False,
        server_header=False,
    )


if __name__ == "__main__":
    main()
