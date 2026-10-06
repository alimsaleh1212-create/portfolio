"""Prepare each role's files: encode, name by content hash, describe.

Nothing here touches MinIO or Postgres; the output is files in a scratch
folder plus the `Variant` records that describe them.
"""

import hashlib
import json
import re
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
    elif role == "hiker":
        settings = {"format": "glb"}
    elif role == "stills":
        settings = {
            "widths": images.STILL_WIDTHS,
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
    name: str | None = None,
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
                    name=name,
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


STILL_FILE = re.compile(r"^([a-z][a-z-]*)-(wide|narrow)\.png$")


class StillsError(Exception):
    """The stills folder holds no picture, or a file that is not named for one."""


def still_sources(source: Path) -> list[tuple[Path, str, str]]:
    """The pictures in a stills folder: `(path, name, composition)`, sorted by name.

    Raises:
        StillsError: If a file is not `<position>-<wide|narrow>.png`, or there is none.
    """
    found: list[tuple[Path, str, str]] = []
    for path in sorted(source.iterdir()):
        if path.name.startswith(".") or not path.is_file():
            continue
        if path.suffix == ".json":
            continue  # stills.json: the capture script's record of what they came from
        match = STILL_FILE.match(path.name)
        if not match:
            raise StillsError(
                f"{path.name}: a still is named <position>-<wide|narrow>.png"
            )
        found.append((path, f"{match[1]}-{match[2]}", match[2]))
    if not found:
        raise StillsError(f"no pictures in {source.name}")
    return found


def stills_fingerprint(path: Path) -> str:
    """One hash for the whole folder: every file's name and content."""
    digest = hashlib.sha256()
    for item, name, _ in still_sources(path):
        digest.update(name.encode())
        digest.update(bytes.fromhex(sha256_of_file(item)))
    return digest.hexdigest()


def prepare_stills(source: Path, folder: Path) -> Prepared:
    """Render every still at its composition's widths in AVIF, WebP and JPEG.

    Args:
        source: Folder of `<position>-<wide|narrow>.png` files.
        folder: Scratch folder for the output.
    """
    files: list[PreparedFile] = []
    for path, name, composition in still_sources(source):
        files.extend(
            _image_files(
                folder,
                path,
                images.STILL_WIDTHS[composition],
                f"still-{name}",
                "still",
                name,
            )
        )
    return Prepared(files=files)


GLB_MAGIC = b"glTF"


class ModelError(Exception):
    """The model file is not a binary glTF."""


def prepare_model(source: Path) -> Prepared:
    """Describe the Hiker's model as it is; it is stored byte for byte.

    Raises:
        ModelError: If the file does not start with the binary glTF header.
    """
    with source.open("rb") as handle:
        if handle.read(len(GLB_MAGIC)) != GLB_MAGIC:
            raise ModelError(f"{source.name} is not a binary glTF (.glb) file")
    digest = sha256_of_file(source)[:HASH_CHARS]
    return Prepared(
        files=[
            PreparedFile(
                path=source,
                variant=Variant(
                    kind="model",
                    format="glb",
                    content_type="model/gltf-binary",
                    key=f"hiker-{digest}.glb",
                    size_bytes=source.stat().st_size,
                ),
            )
        ]
    )
