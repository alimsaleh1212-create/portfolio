"""Turn one picture into several widths in AVIF, WebP and JPEG.

Orientation is applied first and every piece of metadata is dropped, so a
served image never carries a camera, a place or a timestamp.
"""

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

PORTRAIT_WIDTHS = (320, 480, 640, 960, 1280)
POSTER_WIDTHS = (640, 960, 1280, 1920)
AVIF_QUALITY = 58
WEBP_QUALITY = 80
JPEG_QUALITY = 82

FORMATS: dict[str, tuple[str, str]] = {
    # name: (Pillow format, content type)
    "avif": ("AVIF", "image/avif"),
    "webp": ("WEBP", "image/webp"),
    "jpeg": ("JPEG", "image/jpeg"),
}
EXTENSIONS = {"avif": "avif", "webp": "webp", "jpeg": "jpg"}

_SRGB = ImageCms.createProfile("sRGB")


@dataclass(frozen=True)
class RenderedImage:
    """One encoded picture, held in memory."""

    format: str
    content_type: str
    width: int
    height: int
    data: bytes


def widths_for(source_width: int, wanted: tuple[int, ...]) -> list[int]:
    """Pick the widths to produce, never larger than the source.

    Args:
        source_width: Width of the (oriented) source.
        wanted: Desired widths, ascending.

    Returns:
        The wanted widths that fit; the source's own width if none do.
    """
    fitting = [width for width in wanted if width <= source_width]
    return fitting or [source_width]


def _to_srgb(image: Image.Image) -> Image.Image:
    """Convert to sRGB using the embedded profile, since the profile is dropped."""
    icc = image.info.get("icc_profile")
    if icc:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        converted = ImageCms.profileToProfile(
            image.convert("RGB"), source, _SRGB, outputMode="RGB"
        )
        image = converted or image
    clean = image.convert("RGB")
    # Some encoders fall back to `info`, which still names the profile just used.
    clean.info.clear()
    return clean


def _encode(image: Image.Image, name: str) -> bytes:
    pillow_format, _ = FORMATS[name]
    buffer = io.BytesIO()
    if name == "avif":
        image.save(buffer, pillow_format, quality=AVIF_QUALITY, speed=6)
    elif name == "webp":
        image.save(buffer, pillow_format, quality=WEBP_QUALITY, method=6)
    else:
        image.save(
            buffer,
            pillow_format,
            quality=JPEG_QUALITY,
            optimize=True,
            progressive=True,
        )
    return buffer.getvalue()


def render_images(source: Path, wanted_widths: tuple[int, ...]) -> list[RenderedImage]:
    """Produce every width in every format, with orientation applied and no metadata.

    Args:
        source: Path of the source picture.
        wanted_widths: Desired widths, ascending; larger-than-source are skipped.

    Returns:
        One entry per width and format, widths ascending.
    """
    with Image.open(source) as opened:
        oriented = ImageOps.exif_transpose(opened) or opened
        rgb = _to_srgb(oriented)
    results: list[RenderedImage] = []
    for width in widths_for(rgb.width, wanted_widths):
        height = round(rgb.height * width / rgb.width)
        resized = (
            rgb
            if width == rgb.width
            else rgb.resize((width, height), Image.Resampling.LANCZOS)
        )
        for name, (_, content_type) in FORMATS.items():
            results.append(
                RenderedImage(
                    format=name,
                    content_type=content_type,
                    width=width,
                    height=height,
                    data=_encode(resized, name),
                )
            )
    return results
