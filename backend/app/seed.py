"""Seed command: `python -m app.seed [--strict]`.

Validates the content files and loads them into Postgres, then prepares the
media files and stores them in MinIO. Safe to run any number of times: it
updates changed rows, removes rows whose content was deleted, and leaves media
whose source file and processing settings are unchanged untouched, so the
result depends only on the files.
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
from app.data.media_repo import MediaRepository
from app.data.storage import MediaStore, create_s3_client
from app.logging import configure_logging
from app.media.manifest import load_manifest
from app.media.pipeline import MediaPipeline, find_missing

logger = structlog.get_logger(__name__)

CONNECT_TIMEOUT_SECONDS = 10.0
S3_TIMEOUT_SECONDS = 300.0


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


async def seed_media(settings: Settings, *, strict: bool) -> None:
    """Prepare the media files and store them, skipping what is unchanged.

    Args:
        settings: Provides the content folder, source folder, database and MinIO.
        strict: Fail if any file named in the manifest is missing.

    Raises:
        MediaMissingError: In strict mode, if a file is missing.
        ContentError: If the manifest is missing or invalid.
    """
    manifest = load_manifest(Path(settings.content_dir))
    engine = create_engine(settings.database_url, CONNECT_TIMEOUT_SECONDS)
    # Uploads of a large video need far more than the API's short timeouts.
    s3 = create_s3_client(
        settings.minio_endpoint,
        settings.minio_access_key,
        settings.minio_secret_key,
        S3_TIMEOUT_SECONDS,
    )
    try:
        pipeline = MediaPipeline(
            MediaStore(s3, settings.minio_bucket),
            MediaRepository(create_session_factory(engine)),
            Path(settings.media_source_dir),
        )
        await pipeline.sync(manifest, strict=strict)
    finally:
        await engine.dispose()
        s3.close()


def strict_problems(settings: Settings) -> list[str]:
    """List what strict mode refuses: remaining placeholders and missing media."""
    problems: list[str] = []
    content = load_content(Path(settings.content_dir))
    remaining = find_placeholders(content)
    if remaining:
        listing = "\n".join(f"  {entry}" for entry in remaining)
        problems.append(f"{len(remaining)} placeholder(s) remain:\n{listing}")
    manifest = load_manifest(Path(settings.content_dir))
    missing = find_missing(manifest, Path(settings.media_source_dir))
    if missing:
        listing = "\n".join(f"  {line}" for line in missing)
        problems.append(f"{len(missing)} media file(s) missing:\n{listing}")
    return problems


async def run_seed(settings: Settings, *, strict: bool) -> None:
    """Load the text content, then the media.

    In strict mode both are checked, and every problem listed, before anything
    is loaded.
    """
    if strict:
        problems = strict_problems(settings)
        if problems:
            raise ContentError("\n".join(problems))
    await seed_content(Path(settings.content_dir), settings.database_url, strict=strict)
    await seed_media(settings, strict=strict)


def main(argv: Sequence[str] | None = None, settings: Settings | None = None) -> int:
    """Run the seed from the command line.

    Args:
        argv: Arguments; defaults to `sys.argv[1:]`.
        settings: Settings to use; defaults to the environment's.

    Returns:
        The process exit code: 0 on success, 1 on any content problem.
    """
    parser = argparse.ArgumentParser(
        prog="python -m app.seed",
        description="Load the content files into Postgres and the media into MinIO.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero, loading nothing, if a placeholder remains "
        "or a media file is missing",
    )
    args = parser.parse_args(argv)
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    try:
        asyncio.run(run_seed(settings, strict=args.strict))
    except ContentError as exc:
        sys.stderr.write(f"seed failed:\n{exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
