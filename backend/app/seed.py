"""Seed command: `python -m app.seed [--strict]`.

Validates the content files and loads them into Postgres. Safe to run any
number of times: it updates changed rows and removes rows whose content was
deleted, so the result depends only on the files.
"""

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path

import structlog

from app.config import Settings, get_settings
from app.content.loader import (
    ContentError,
    PlaceholdersRemainError,
    find_placeholders,
    load_content,
)
from app.data.content_repo import ContentRepository
from app.data.db import create_engine, create_session_factory
from app.logging import configure_logging

logger = structlog.get_logger(__name__)

CONNECT_TIMEOUT_SECONDS = 10.0


async def seed_content(content_dir: Path, database_url: str, *, strict: bool) -> None:
    """Validate the content files and load them into Postgres.

    Args:
        content_dir: Folder holding the content files.
        database_url: SQLAlchemy URL of the database to load into.
        strict: Fail, loading nothing, if any placeholder text remains.

    Raises:
        PlaceholdersRemainError: In strict mode, if placeholders remain.
        ContentError: If a content file is missing or invalid.
    """
    content = load_content(content_dir)
    if strict:
        remaining = find_placeholders(content)
        if remaining:
            listing = "\n".join(f"  {entry}" for entry in remaining)
            raise PlaceholdersRemainError(
                f"{len(remaining)} placeholder(s) remain:\n{listing}"
            )
    engine = create_engine(database_url, CONNECT_TIMEOUT_SECONDS)
    try:
        await ContentRepository(create_session_factory(engine)).sync(content)
    finally:
        await engine.dispose()
    logger.info(
        "seed_complete",
        stages=len(content.stages),
        projects=len(content.projects),
        strict=strict,
    )


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    """Run the seed from the command line.

    Args:
        argv: Arguments; defaults to `sys.argv[1:]`.
        settings: Settings to use; defaults to the environment's.

    Returns:
        The process exit code: 0 on success, 1 on any content problem.
    """
    parser = argparse.ArgumentParser(
        prog="python -m app.seed", description="Load the content files into Postgres."
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero, loading nothing, while any placeholder remains",
    )
    args = parser.parse_args(argv)
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    try:
        asyncio.run(
            seed_content(
                Path(settings.content_dir), settings.database_url, strict=args.strict
            )
        )
    except ContentError as exc:
        sys.stderr.write(f"seed failed:\n{exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
