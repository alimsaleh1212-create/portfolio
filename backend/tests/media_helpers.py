"""Synthetic media for tests: a tagged photograph, a short video, a tiny PDF.

Nothing here reads a real source file; everything is generated on the spot.
"""

import io
import json
import struct
import subprocess  # noqa: S404
from pathlib import Path

from botocore.exceptions import ClientError
from PIL import Image, ImageCms, ImageDraw

from app.config import Settings
from app.data.storage import MediaStore, create_s3_client

# Strings planted in the metadata; none may survive into a served image.
PLANTED_OWNER = "Planted Photographer Name"
PLANTED_CAMERA = "PlantedCameraMake"


def make_photo(
    path: Path, size: tuple[int, int] = (800, 600), orientation: int = 6
) -> Path:
    """Write a JPEG with EXIF (orientation, owner, camera, GPS) and an ICC profile.

    The stored pixels are `size`; `orientation` 6 means a viewer rotates it a
    quarter turn, so the displayed picture is `size` swapped.
    """
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for x in range(size[0]):
        draw.line([(x, 0), (x, size[1])], fill=(x * 255 // size[0], 90, 160))
    draw.rectangle([10, 10, 80, 50], fill=(255, 255, 255))
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = PLANTED_CAMERA
    exif[0x013B] = PLANTED_OWNER
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (33.0, 53.0, 20.0)
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    image.save(path, "JPEG", exif=exif, icc_profile=icc)
    return path


def make_video(
    path: Path,
    *,
    hdr: bool = False,
    seconds: int = 2,
    size: tuple[int, int] = (640, 360),
) -> Path:
    """Generate a short test-pattern video with a tone, as MOV; HDR means 10-bit HLG."""
    tags = (
        [
            "-pix_fmt",
            "yuv420p10le",
            "-x264-params",
            "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
        ]
        if hdr
        else ["-pix_fmt", "yuv420p"]
    )
    subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc2=duration={seconds}:size={size[0]}x{size[1]}:rate=25",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:v",
            "libx264",
            *tags,
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
    )
    return path


def make_pdf(path: Path) -> Path:
    """Write a one-page PDF with no personal content."""
    path.write_bytes(
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    return path


def ffprobe_stream(path: Path) -> dict[str, str]:
    """Return the first video stream's codec, profile, pixel format and colour tags."""
    result = subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-print_format",
            "json",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)["streams"][0]


def top_level_boxes(path: Path) -> list[str]:
    """List an MP4's top-level box names in file order."""
    names: list[str] = []
    size_total = path.stat().st_size
    with path.open("rb") as handle:
        position = 0
        while position < size_total:
            handle.seek(position)
            header = handle.read(8)
            size, name = struct.unpack(">I4s", header)
            names.append(name.decode("latin-1"))
            if size == 1:
                size = struct.unpack(">Q", handle.read(8))[0]
            position += size or size_total
    return names


METADATA_MARKERS = (
    b"Exif",
    b"EXIF",
    b"XMP",
    b"ns.adobe.com",
    b"ICC_PROFILE",
    b"ICCP",
    b"icc ",
    b"GPS",
    PLANTED_OWNER.encode(),
    PLANTED_CAMERA.encode(),
)


def metadata_found(data: bytes) -> list[str]:
    """Name the metadata markers found in an encoded image, by bytes and by Pillow."""
    found = [marker.decode() for marker in METADATA_MARKERS if marker in data]
    with Image.open(io.BytesIO(data)) as image:
        if image.getexif():
            found.append("pillow-exif")
        if "icc_profile" in image.info:
            found.append("pillow-icc")
        if "xmp" in image.info:
            found.append("pillow-xmp")
    return found


def drop_bucket(settings: Settings, bucket: str) -> None:
    """Delete a throwaway bucket and everything in it; fine if it was never made."""
    client = create_s3_client(
        settings.minio_endpoint,
        settings.minio_access_key,
        settings.minio_secret_key,
        60,
    )
    try:
        store = MediaStore(client, bucket)
        try:
            store.delete(store.list_keys())
            client.delete_bucket(Bucket=bucket)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "NoSuchBucket":
                raise
    finally:
        client.close()
