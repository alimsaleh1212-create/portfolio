"""Shared shapes: what a prepared media item looks like."""

from typing import Literal

from pydantic import BaseModel

MediaRole = Literal["portrait", "video_cv", "cv_pdf", "hiker"]
ROLE_ORDER: tuple[MediaRole, ...] = ("portrait", "video_cv", "cv_pdf", "hiker")
VariantKind = Literal["image", "video", "poster", "document", "model"]


class Variant(BaseModel):
    """One stored object: an image width, a video rendition or the PDF."""

    kind: VariantKind
    format: str
    """avif, webp, jpeg, h264, pdf or glb."""
    content_type: str
    key: str
    """The object's key in the bucket; Caddy serves it at `/media/<key>`."""
    size_bytes: int
    width: int | None = None
    height: int | None = None
