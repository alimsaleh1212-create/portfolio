"""The media pipeline against real MinIO and Postgres, with generated files."""

import asyncio
import urllib.error
import urllib.request
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.content.loader import ContentError
from app.data.db import create_engine, create_session_factory
from app.data.media_repo import MediaRepository
from app.data.storage import MediaStore, create_s3_client
from app.media import prepare, video
from app.media.manifest import (
    DocumentEntry,
    HikerEntry,
    MediaManifest,
    PortraitEntry,
    VideoEntry,
    load_manifest,
)
from app.media.pipeline import MediaMissingError, MediaPipeline, MediaReport
from tests.db_helpers import fetch_all
from tests.media_helpers import (
    drop_bucket,
    ffprobe_stream,
    make_pdf,
    make_photo,
    make_video,
    metadata_found,
    top_level_boxes,
)

MANIFEST = MediaManifest(
    portrait=PortraitEntry(file="photo.jpg", alt="A test portrait."),
    video_cv=VideoEntry(file="clip.mov", alt="A test clip.", poster_seconds=1),
    cv_pdf=DocumentEntry(file="cv.pdf", download_name="Test_CV.pdf"),
)


class Env:
    """One throwaway bucket, database and source folder."""

    def __init__(self, settings: Settings, database_url: str, source: Path) -> None:
        self.settings = settings
        self.database_url = database_url
        self.source = source
        self.content = source.parent / "content"
        self.content.mkdir(exist_ok=True)
        self.bucket = f"{settings.minio_bucket}-test-{uuid.uuid4().hex[:10]}"
        self.client = create_s3_client(
            settings.minio_endpoint,
            settings.minio_access_key,
            settings.minio_secret_key,
            60,
        )
        self.store = MediaStore(self.client, self.bucket)

    def sync(
        self, manifest: MediaManifest = MANIFEST, *, strict: bool = False
    ) -> MediaReport:
        async def run() -> MediaReport:
            engine = create_engine(self.database_url, 10)
            try:
                pipeline = MediaPipeline(
                    self.store,
                    MediaRepository(create_session_factory(engine)),
                    self.source,
                    self.content,
                )
                return await pipeline.sync(manifest, strict=strict)
            finally:
                await engine.dispose()

        return asyncio.run(run())

    def rows(self) -> dict[str, dict[str, Any]]:
        found = fetch_all(self.database_url, "SELECT * FROM media_items")
        return {row["role"]: row for row in found}

    def stored_keys(self) -> set[str]:
        return set(self.store.list_keys())

    def url(self, key: str) -> str:
        return f"{self.settings.minio_endpoint}/{self.bucket}/{key}"

    def variant_keys(self, role: str) -> set[str]:
        return {variant["key"] for variant in self.rows()[role]["variants"]}

    def cleanup(self) -> None:
        self.client.close()
        drop_bucket(self.settings, self.bucket)


@pytest.fixture
def env(settings: Settings, empty_database_url: str, tmp_path: Path) -> Iterator[Env]:
    source = tmp_path / "source"
    source.mkdir()
    environment = Env(settings, empty_database_url, source)
    yield environment
    environment.cleanup()


@pytest.fixture
def full_env(env: Env) -> Env:
    make_photo(env.source / "photo.jpg")
    make_video(env.source / "clip.mov", hdr=True)
    make_pdf(env.source / "cv.pdf")
    return env


def anonymous(url: str, method: str = "GET", data: bytes | None = None) -> int:
    request = urllib.request.Request(url, method=method, data=data)  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


def test_first_run_prepares_and_stores_every_role(full_env: Env) -> None:
    report = full_env.sync()

    assert report.processed == ["portrait", "video_cv", "cv_pdf"]
    rows = full_env.rows()
    assert set(rows) == {"portrait", "video_cv", "cv_pdf"}
    stored = full_env.stored_keys()
    for row in rows.values():
        assert {variant["key"] for variant in row["variants"]} <= stored
    assert stored == set().union(*(full_env.variant_keys(role) for role in rows))
    assert rows["portrait"]["alt"] == "A test portrait."
    assert rows["cv_pdf"]["download_name"] == "Test_CV.pdf"
    assert rows["video_cv"]["duration_seconds"] == pytest.approx(2.0, abs=0.3)


def test_keys_are_named_by_content(full_env: Env) -> None:
    full_env.sync()

    for variant in full_env.rows()["portrait"]["variants"]:
        data = urllib.request.urlopen(  # noqa: S310
            full_env.url(variant["key"]), timeout=10
        ).read()
        assert prepare.hashlib.sha256(data).hexdigest()[:16] in variant["key"]


def test_served_images_have_no_metadata(full_env: Env) -> None:
    full_env.sync()

    images = [
        variant
        for role in ("portrait", "video_cv")
        for variant in full_env.rows()[role]["variants"]
        if variant["kind"] in {"image", "poster"}
    ]
    assert images
    for variant in images:
        with urllib.request.urlopen(full_env.url(variant["key"])) as response:  # noqa: S310
            assert metadata_found(response.read()) == [], variant["key"]


def test_the_video_is_sdr_h264_with_the_index_first(
    full_env: Env, tmp_path: Path
) -> None:
    full_env.sync()

    (rendition,) = [
        v for v in full_env.rows()["video_cv"]["variants"] if v["kind"] == "video"
    ]
    target = tmp_path / "served.mp4"
    target.write_bytes(urllib.request.urlopen(full_env.url(rendition["key"])).read())  # noqa: S310
    stream = ffprobe_stream(target)
    assert (stream["codec_name"], stream["pix_fmt"]) == ("h264", "yuv420p")
    assert stream["color_transfer"] == "bt709"
    boxes = top_level_boxes(target)
    assert boxes.index("moov") < boxes.index("mdat")
    assert rendition["content_type"] == "video/mp4"


def test_the_pdf_is_stored_as_is_and_downloads_under_its_name(
    full_env: Env,
) -> None:
    full_env.sync()

    (variant,) = full_env.rows()["cv_pdf"]["variants"]
    with urllib.request.urlopen(full_env.url(variant["key"])) as response:  # noqa: S310
        assert response.read() == (full_env.source / "cv.pdf").read_bytes()
        assert response.headers["Content-Type"] == "application/pdf"
        assert "Test_CV.pdf" in response.headers["Content-Disposition"]


def test_visitors_can_read_objects_but_not_list_or_write(full_env: Env) -> None:
    full_env.sync()
    key = next(iter(full_env.variant_keys("cv_pdf")))

    assert anonymous(full_env.url(key)) == 200
    assert anonymous(f"{full_env.settings.minio_endpoint}/{full_env.bucket}/") == 403
    assert (
        anonymous(f"{full_env.settings.minio_endpoint}/{full_env.bucket}?list-type=2")
        == 403
    )
    assert anonymous(full_env.url("planted.txt"), "PUT", b"x") == 403
    assert anonymous(full_env.url(key), "DELETE") == 403
    assert key in full_env.stored_keys()


def test_unchanged_files_upload_and_encode_nothing(
    full_env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    full_env.sync()
    before = full_env.rows()
    # Any attempt to prepare or encode again would blow up.
    for name in ("prepare_portrait", "prepare_video", "prepare_document"):
        monkeypatch.setattr(prepare, name, _refuse)
    monkeypatch.setattr(video, "encode_rendition", _refuse)

    report = full_env.sync()

    assert report.processed == []
    assert report.unchanged == ["portrait", "video_cv", "cv_pdf"]
    assert (report.objects_uploaded, report.objects_deleted) == (0, 0)
    assert full_env.rows() == before


def _refuse(*_args: object, **_kwargs: object) -> None:
    raise AssertionError("unchanged media must not be prepared again")


def test_a_replaced_file_is_rebuilt_and_its_old_objects_removed(
    full_env: Env,
) -> None:
    full_env.sync()
    old_portrait = full_env.variant_keys("portrait")
    kept_video = full_env.variant_keys("video_cv")
    make_photo(full_env.source / "photo.jpg", size=(900, 900), orientation=1)

    report = full_env.sync()

    new_portrait = full_env.variant_keys("portrait")
    assert report.processed == ["portrait"]
    assert new_portrait.isdisjoint(old_portrait)
    stored = full_env.stored_keys()
    assert new_portrait <= stored
    assert old_portrait.isdisjoint(stored)
    assert kept_video <= stored


def test_changed_processing_settings_rebuild_the_role(
    full_env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    full_env.sync()
    monkeypatch.setattr("app.media.images.PORTRAIT_WIDTHS", (320,))

    report = full_env.sync()

    assert report.processed == ["portrait"]
    assert {v["width"] for v in full_env.rows()["portrait"]["variants"]} == {320}


def test_new_alt_text_is_saved_without_reprocessing(full_env: Env) -> None:
    full_env.sync()
    edited = MANIFEST.model_copy(
        update={"portrait": PortraitEntry(file="photo.jpg", alt="New words.")}
    )

    report = full_env.sync(edited)

    assert report.processed == []
    assert full_env.rows()["portrait"]["alt"] == "New words."


def test_an_object_missing_from_the_bucket_is_uploaded_again(full_env: Env) -> None:
    full_env.sync()
    key = next(iter(full_env.variant_keys("cv_pdf")))
    full_env.store.delete([key])

    report = full_env.sync()

    assert report.processed == ["cv_pdf"]
    assert key in full_env.stored_keys()


def test_objects_nothing_refers_to_are_swept(full_env: Env, tmp_path: Path) -> None:
    full_env.sync()
    stray = tmp_path / "stray.txt"
    stray.write_text("left behind")
    full_env.store.upload("stray.txt", stray, "text/plain")

    full_env.sync()

    assert "stray.txt" not in full_env.stored_keys()


def test_missing_files_are_skipped_with_a_warning_in_normal_mode(env: Env) -> None:
    make_pdf(env.source / "cv.pdf")

    report = env.sync()

    assert report.processed == ["cv_pdf"]
    assert report.skipped == ["portrait", "video_cv"]
    assert set(env.rows()) == {"cv_pdf"}


def test_an_empty_folder_stores_nothing_and_succeeds(env: Env) -> None:
    report = env.sync()

    assert report.skipped == ["portrait", "video_cv", "cv_pdf"]
    assert env.rows() == {}
    assert env.stored_keys() == set()


def test_strict_mode_fails_naming_each_missing_file(env: Env) -> None:
    make_pdf(env.source / "cv.pdf")

    with pytest.raises(MediaMissingError) as raised:
        env.sync(strict=True)

    message = str(raised.value)
    assert "photo.jpg" in message
    assert "clip.mov" in message
    assert "cv.pdf" not in message
    assert env.rows() == {}


def test_a_source_that_disappears_is_removed_from_site_and_bucket(
    full_env: Env,
) -> None:
    full_env.sync()
    gone = full_env.variant_keys("portrait")
    (full_env.source / "photo.jpg").unlink()

    report = full_env.sync()

    assert report.removed == ["portrait"]
    assert "portrait" not in full_env.rows()
    assert gone.isdisjoint(full_env.stored_keys())


def test_the_real_manifest_is_valid(settings: Settings) -> None:
    manifest = load_manifest(settings.content_dir)

    assert manifest.cv_pdf.download_name.endswith(".pdf")


def test_a_manifest_naming_a_folder_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "media.yaml").write_text(
        "portrait: {file: ../x.jpg, alt: a}\n"
        "video_cv: {file: v.mov, alt: a}\n"
        "cv_pdf: {file: c.pdf, download_name: c.pdf}\n"
    )

    with pytest.raises(ContentError, match="plain file name"):
        load_manifest(tmp_path)


def test_the_hiker_model_is_read_from_the_content_folder(env: Env) -> None:
    (env.content / "hiker").mkdir()
    (env.content / "hiker" / "model.glb").write_bytes(b"glTF" + bytes(60))
    manifest = MANIFEST.model_copy(update={"hiker": HikerEntry(file="hiker/model.glb")})

    report = env.sync(manifest)

    assert "hiker" in report.processed
    (variant,) = env.rows()["hiker"]["variants"]
    assert variant["kind"] == "model"
    assert variant["content_type"] == "model/gltf-binary"
    assert variant["key"].startswith("hiker-") and variant["key"].endswith(".glb")
    assert variant["size_bytes"] == 64
    assert anonymous(env.url(variant["key"])) == 200
    assert "hiker" in env.sync(manifest).unchanged


def test_a_hiker_file_that_is_not_a_glb_is_refused(env: Env) -> None:
    (env.content / "model.glb").write_bytes(b"not a model at all")
    manifest = MANIFEST.model_copy(update={"hiker": HikerEntry(file="model.glb")})

    with pytest.raises(prepare.ModelError):
        env.sync(manifest)


def test_a_missing_hiker_file_is_an_error_not_a_skip(env: Env) -> None:
    manifest = MANIFEST.model_copy(update={"hiker": HikerEntry(file="gone.glb")})

    with pytest.raises(ContentError, match="gone.glb"):
        env.sync(manifest)


def test_the_real_manifest_names_a_hiker_that_is_a_glb(settings: Settings) -> None:
    manifest = load_manifest(settings.content_dir)

    assert manifest.hiker is not None
    model = Path(settings.content_dir) / manifest.hiker.file
    assert model.read_bytes()[:4] == b"glTF"
    assert model.stat().st_size < 500_000


def test_a_hiker_path_outside_the_content_folder_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "media.yaml").write_text(
        "portrait: {file: p.jpg, alt: a}\n"
        "video_cv: {file: v.mov, alt: a}\n"
        "cv_pdf: {file: c.pdf, download_name: c.pdf}\n"
        "hiker: {file: ../x.glb}\n"
    )

    with pytest.raises(ContentError, match="inside the content folder"):
        load_manifest(tmp_path)
