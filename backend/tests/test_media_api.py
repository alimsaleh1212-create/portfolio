"""The media endpoint describes what the seed stored."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.media_helpers import make_pdf, make_photo
from tests.test_media_pipeline import MANIFEST, Env


@pytest.fixture
def media_client(
    make_client: Callable[..., TestClient], empty_database_url: str
) -> TestClient:
    return make_client(database_url=empty_database_url)


@pytest.fixture
def api_env(settings: Settings, empty_database_url: str, tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()
    env = Env(settings, empty_database_url, source)
    yield env
    env.cleanup()


def test_the_endpoint_describes_each_item_that_exists(
    media_client: TestClient, api_env: Env
) -> None:
    make_photo(api_env.source / "photo.jpg")
    make_pdf(api_env.source / "cv.pdf")
    api_env.sync()

    response = media_client.get("/api/v1/media")

    body = response.json()
    assert response.status_code == 200
    assert [item["role"] for item in body] == ["portrait", "cv_pdf"]
    portrait, pdf = body
    assert portrait["alt"] == MANIFEST.portrait.alt
    first = portrait["variants"][0]
    assert first["kind"] == "image"
    assert first["url"].startswith("/media/portrait-w")
    assert set(first) == {
        "kind",
        "format",
        "content_type",
        "url",
        "size_bytes",
        "width",
        "height",
    }
    assert {v["format"] for v in portrait["variants"]} == {"avif", "webp", "jpeg"}
    assert pdf["download_name"] == "Test_CV.pdf"
    assert pdf["variants"][0]["format"] == "pdf"
    assert pdf["variants"][0]["width"] is None


def test_the_endpoint_is_an_empty_list_when_nothing_was_seeded(
    media_client: TestClient,
) -> None:
    assert media_client.get("/api/v1/media").json() == []
