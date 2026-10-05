"""Video preparation with real ffmpeg on generated clips."""

from pathlib import Path

import pytest

from app.media import video
from tests.media_helpers import ffprobe_stream, make_video, top_level_boxes


def test_a_short_sdr_clip_is_probed(tmp_path: Path) -> None:
    info = video.probe(make_video(tmp_path / "sdr.mov"))

    assert (info.width, info.height) == (640, 360)
    assert info.is_hdr is False
    assert info.has_audio is True
    assert info.duration_seconds == pytest.approx(2.0, abs=0.2)


def test_hlg_source_is_detected_as_hdr(tmp_path: Path) -> None:
    assert video.probe(make_video(tmp_path / "hdr.mov", hdr=True)).is_hdr is True


def test_renditions_are_never_taller_than_the_source() -> None:
    assert video.rendition_heights(1080) == [1080, 720]
    assert video.rendition_heights(900) == [720]
    assert video.rendition_heights(361) == [360]


@pytest.mark.parametrize("hdr", [False, True])
def test_encode_gives_8_bit_h264_tagged_bt709_with_the_index_first(
    tmp_path: Path, hdr: bool
) -> None:
    source = make_video(tmp_path / "source.mov", hdr=hdr)
    target = tmp_path / "out.mp4"

    video.encode_rendition(source, target, video.probe(source), 360)

    stream = ffprobe_stream(target)
    assert stream["codec_name"] == "h264"
    assert stream["profile"] == "High"
    assert stream["pix_fmt"] == "yuv420p"
    assert stream["color_space"] == "bt709"
    assert stream["color_transfer"] == "bt709"
    assert stream["color_primaries"] == "bt709"
    boxes = top_level_boxes(target)
    assert boxes.index("moov") < boxes.index("mdat")


@pytest.mark.parametrize(("hdr", "expected"), [(True, True), (False, False)])
def test_only_hdr_sources_are_tone_mapped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, hdr: bool, expected: bool
) -> None:
    source = make_video(tmp_path / "source.mov", hdr=hdr)
    info = video.probe(source)
    commands: list[list[str]] = []
    monkeypatch.setattr(video, "_run", lambda command: commands.append(command) or "")

    video.encode_rendition(source, tmp_path / "out.mp4", info, 360)

    graph = commands[0][commands[0].index("-vf") + 1]
    assert ("tonemap" in graph) is expected


def test_poster_frame_is_written(tmp_path: Path) -> None:
    source = make_video(tmp_path / "source.mov")
    info = video.probe(source)
    frame = tmp_path / "poster.png"

    video.extract_frame(source, frame, info, seconds=99)

    assert frame.stat().st_size > 0


def test_a_file_without_video_is_rejected(tmp_path: Path) -> None:
    junk = tmp_path / "junk.mov"
    junk.write_bytes(b"not a video")

    with pytest.raises(video.VideoError):
        video.probe(junk)
