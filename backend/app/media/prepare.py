"""Prepare each role's files: encode, name by content hash, describe.

Nothing here touches MinIO or Postgres; the output is files in a scratch
folder plus the `Variant` records that describe them.
"""

import hashlib
import json
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import structlog

from app.media import images, video
from app.media.schema import MediaRole, Variant

logger = structlog.get_logger(__name__)

VIDEO_SIZE_BUDGET_BYTES = 30 * 1000 * 1000
HASH_CHARS = 16
CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class PreparedFile:
    """A file ready to upload and the record that describes it."""

    path: Path
    variant: Variant
    content_disposition: str | None = None


@dataclass(frozen=True)
class Prepared:
    """Everything one role produced."""

    files: list[PreparedFile]
    duration_seconds: float | None = None


def sha256_of_file(path: Path) -> str:
    """Return the file's SHA-256 as hex, reading in chunks."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def settings_fingerprint(role: MediaRole, extra: str = "") -> str:
    """Hash the processing settings that shape a role's output.

    Changing a width, a quality or an ffmpeg argument changes the hash, so the
    seed rebuilds that role the next time it runs.

    Args:
        role: The role whose settings to hash.
        extra: Manifest values that end up inside the stored objects.
    """
    settings: dict[str, object]
    if role == "portrait":
        settings = {
            "widths": images.PORTRAIT_WIDTHS,
            "quality": [images.AVIF_QUALITY, images.WEBP_QUALITY, images.JPEG_QUALITY],
        }
    elif role == "video_cv":
        settings = {
            "heights": video.RENDITION_HEIGHTS,
            "rates": video.RENDITION_RATES,
            "preset": video.X264_PRESET,
            "audio": video.AUDIO_ARGS,
            "tonemap": video.TONEMAP_CHAIN,
            "poster": images.POSTER_WIDTHS,
            "quality": [images.AVIF_QUALITY, images.WEBP_QUALITY, images.JPEG_QUALITY],
        }
    else:
        settings = {"disposition": extra}
    payload = json.dumps([role, settings, extra], sort_keys=True, default=list)
    return hashlib.sha256(payload.encode()).hexdigest()


@contextmanager
def scratch_dir() -> Iterator[Path]:
    """A temporary folder, removed afterwards."""
    folder = Path(tempfile.mkdtemp(prefix="media-"))
    try:
        yield folder
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _store_bytes(folder: Path, data: bytes, suffix: str) -> tuple[Path, str]:
    """Write bytes under a temporary name; return the path and the content hash."""
    digest = hashlib.sha256(data).hexdigest()[:HASH_CHARS]
    path = folder / f"{digest}{suffix}"
    path.write_bytes(data)
    return path, digest


def _image_files(
    folder: Path,
    source: Path,
    widths: tuple[int, ...],
    prefix: str,
    kind: str,
) -> list[PreparedFile]:
    files: list[PreparedFile] = []
    for rendered in images.render_images(source, widths):
        extension = images.EXTENSIONS[rendered.format]
        path, digest = _store_bytes(folder, rendered.data, f".{extension}")
        key = f"{prefix}-w{rendered.width}-{digest}.{extension}"
        files.append(
            PreparedFile(
                path=path,
                variant=Variant(
                    kind=kind,  # pyright: ignore[reportArgumentType]
                    format=rendered.format,
                    content_type=rendered.content_type,
                    key=key,
                    size_bytes=len(rendered.data),
                    width=rendered.width,
                    height=rendered.height,
                ),
            )
        )
    return files


def prepare_portrait(source: Path, folder: Path) -> Prepared:
    """Render the Portrait at several widths in AVIF, WebP and JPEG."""
    return Prepared(
        files=_image_files(folder, source, images.PORTRAIT_WIDTHS, "portrait", "image")
    )


def prepare_video(source: Path, folder: Path, poster_seconds: float) -> Prepared:
    """Encode the Video CV renditions and a poster frame.

    Args:
        source: The source video.
        folder: Scratch folder for the output.
        poster_seconds: Where the poster frame is taken.

    Raises:
        video.VideoError: If ffmpeg fails.
    """
    info = video.probe(source)
    logger.info(
        "video_encode_start",
        hdr=info.is_hdr,
        height=info.height,
        seconds=round(info.duration_seconds, 1),
    )
    files: list[PreparedFile] = []
    first_rendition: Path | None = None
    for height in video.rendition_heights(info.height):
        target = folder / f"video-{height}.mp4"
        video.encode_rendition(source, target, info, height)
        digest = sha256_of_file(target)[:HASH_CHARS]
        width, out_height = _dimensions(target)
        size = target.stat().st_size
        if height == 1080 and size > VIDEO_SIZE_BUDGET_BYTES:
            logger.warning("video_over_budget", height=height, size_bytes=size)
        files.append(
            PreparedFile(
                path=target,
                variant=Variant(
                    kind="video",
                    format="h264",
                    content_type="video/mp4",
                    key=f"video-cv-{height}p-{digest}.mp4",
                    size_bytes=size,
                    width=width,
                    height=out_height,
                ),
            )
        )
        first_rendition = first_rendition or target
    if first_rendition is None:
        raise video.VideoError("no rendition was produced")
    frame = folder / "poster.png"
    video.extract_frame(first_rendition, frame, info, poster_seconds)
    files.extend(
        _image_files(folder, frame, images.POSTER_WIDTHS, "video-cv-poster", "poster")
    )
    return Prepared(files=files, duration_seconds=info.duration_seconds)


def _dimensions(path: Path) -> tuple[int, int]:
    info = video.probe(path)
    return info.width, info.height


def prepare_document(source: Path, download_name: str) -> Prepared:
    """Describe the PDF as it is; it is stored byte for byte."""
    digest = sha256_of_file(source)[:HASH_CHARS]
    return Prepared(
        files=[
            PreparedFile(
                path=source,
                variant=Variant(
                    kind="document",
                    format="pdf",
                    content_type="application/pdf",
                    key=f"cv-{digest}.pdf",
                    size_bytes=source.stat().st_size,
                ),
                content_disposition=f'attachment; filename="{download_name}"',
            )
        ]
    )
