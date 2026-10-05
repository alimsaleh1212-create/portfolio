"""The tracked media manifest: which source file plays which role."""

from pathlib import Path
from typing import Annotated, Any

import yaml
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from app.content.loader import ContentError

MANIFEST_FILE = "media.yaml"


def _plain_file_name(name: str) -> str:
    """Reject anything that is not a bare file name, so a role cannot escape."""
    if Path(name).name != name or name in {"", ".", ".."}:
        raise ValueError("must be a plain file name without folders")
    return name


FileName = Annotated[str, AfterValidator(_plain_file_name)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PortraitEntry(_Strict):
    """The Portrait: a photograph and its alternative text."""

    file: FileName
    alt: str


class VideoEntry(_Strict):
    """The Video CV: a video, the label announced for it and its poster frame."""

    file: FileName
    alt: str
    poster_seconds: float = Field(default=3.0, ge=0)
    """Where in the video the poster frame is taken, in seconds."""


class DocumentEntry(_Strict):
    """The CV PDF: the file and the name a download is saved under."""

    file: FileName
    download_name: FileName


class MediaManifest(_Strict):
    """Every role the site can show. A role without a file is simply absent."""

    portrait: PortraitEntry
    video_cv: VideoEntry
    cv_pdf: DocumentEntry


def load_manifest(content_dir: Path) -> MediaManifest:
    """Read and validate `media.yaml`.

    Args:
        content_dir: Folder holding the content files.

    Returns:
        The validated manifest.

    Raises:
        ContentError: If the file is missing, not YAML, or invalid.
    """
    path = content_dir / MANIFEST_FILE
    try:
        data: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ContentError(
            f"{MANIFEST_FILE}: file not found in {content_dir}"
        ) from None
    except yaml.YAMLError as exc:
        raise ContentError(f"{MANIFEST_FILE}: not valid YAML: {exc}") from exc
    try:
        return MediaManifest.model_validate(data)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
        raise ContentError(f"{MANIFEST_FILE}: {problems}") from exc
