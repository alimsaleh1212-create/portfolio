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


def _content_path(name: str) -> str:
    """Reject absolute paths and any `..`, so a path stays inside the content folder."""
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or name in {"", "."}:
        raise ValueError("must be a path inside the content folder")
    return name


ContentPath = Annotated[str, AfterValidator(_content_path)]


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


class HikerEntry(_Strict):
    """The Hiker's 3D model.

    Unlike the others it is tracked in `content/`, because its licence (CC0)
    allows it, so `file` is a path inside the content folder.
    """

    file: ContentPath


class StillsEntry(_Strict):
    """The still tier's pictures of the scene.

    Tracked in `content/` like the Hiker's model: they are generated from the
    scene by a script, not personal. `folder` is a folder inside the content
    folder holding `<position>-<wide|narrow>.png` files.
    """

    folder: ContentPath


class MediaManifest(_Strict):
    """Every role the site can show. A role without a file is simply absent."""

    portrait: PortraitEntry
    video_cv: VideoEntry
    cv_pdf: DocumentEntry
    hiker: HikerEntry | None = None
    stills: StillsEntry | None = None


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
