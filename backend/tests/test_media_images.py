"""Image preparation: widths, formats, orientation and stripped metadata."""

import io
from pathlib import Path

import pytest
from PIL import Image

from app.media.images import PORTRAIT_WIDTHS, render_images, widths_for
from tests.media_helpers import make_photo, metadata_found


def test_widths_never_exceed_the_source() -> None:
    assert widths_for(700, PORTRAIT_WIDTHS) == [320, 480, 640]


def test_a_source_narrower_than_every_width_keeps_its_own_width() -> None:
    assert widths_for(200, PORTRAIT_WIDTHS) == [200]


@pytest.fixture
def rendered(tmp_path: Path):
    photo = make_photo(tmp_path / "photo.jpg", size=(800, 600), orientation=6)
    return render_images(photo, PORTRAIT_WIDTHS)


def test_every_width_comes_in_avif_webp_and_jpeg(rendered) -> None:
    formats_by_width: dict[int, list[str]] = {}
    for item in rendered:
        formats_by_width.setdefault(item.width, []).append(item.format)

    assert formats_by_width == {
        320: ["avif", "webp", "jpeg"],
        480: ["avif", "webp", "jpeg"],
    }


def test_orientation_is_applied_before_sizing(rendered) -> None:
    # 800x600 stored with a quarter-turn flag is shown as 600x800.
    first = rendered[0]
    assert (first.width, first.height) == (320, 427)
    with Image.open(io.BytesIO(first.data)) as image:
        assert image.size == (first.width, first.height)


def test_no_metadata_survives_in_any_format(rendered) -> None:
    leaks = {item.format: metadata_found(item.data) for item in rendered}

    assert all(found == [] for found in leaks.values()), leaks


def test_output_is_decodable_in_each_format(rendered) -> None:
    for item in rendered:
        with Image.open(io.BytesIO(item.data)) as image:
            assert (
                image.format
                == {"avif": "AVIF", "webp": "WEBP", "jpeg": "JPEG"}[item.format]
            )
