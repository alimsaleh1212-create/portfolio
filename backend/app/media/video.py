"""Video work with ffmpeg: probe, tone-map to SDR, encode H.264, grab a frame.

The source may be 10-bit HDR (HLG or PQ). Encoding it to 8-bit without tone
mapping gives washed-out colours, so HDR input is tone-mapped to SDR BT.709.
"""

import json
import subprocess  # noqa: S404
from dataclasses import dataclass
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)

RENDITION_HEIGHTS = (1080, 720)
# CRF sets the quality; the cap keeps the 1080p file under its size budget.
RENDITION_RATES: dict[int, tuple[int, str, str]] = {
    # height: (crf, maxrate, bufsize)
    1080: (24, "2200k", "4400k"),
    720: (24, "1200k", "2400k"),
}
X264_PRESET = "slow"
AUDIO_ARGS = ("-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000")
HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}
# Tone mapping: linear light at BT.709 primaries, Hable curve, back to BT.709.
TONEMAP_CHAIN = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
)
# Written on the frames so the encoder tags the stream, not just assumes it.
SDR_TAGS = "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"
FFMPEG_TIMEOUT_SECONDS = 3600


class VideoError(Exception):
    """ffmpeg or ffprobe failed, or the file is not a usable video."""


@dataclass(frozen=True)
class VideoInfo:
    """What the pipeline needs to know about a source video."""

    width: int
    height: int
    duration_seconds: float
    is_hdr: bool
    has_audio: bool


def _run(command: list[str]) -> str:
    try:
        result = subprocess.run(  # noqa: S603
            command,
            capture_output=True,
            text=True,
            check=True,
            timeout=FFMPEG_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        raise VideoError(f"{command[0]} is not installed") from None
    except subprocess.CalledProcessError as exc:
        tail = "\n".join(exc.stderr.strip().splitlines()[-8:])
        raise VideoError(f"{command[0]} failed:\n{tail}") from exc
    except subprocess.TimeoutExpired as exc:
        raise VideoError(f"{command[0]} timed out") from exc
    return result.stdout


def probe(source: Path) -> VideoInfo:
    """Read dimensions, duration, dynamic range and audio presence.

    Raises:
        VideoError: If the file has no video stream or ffprobe fails.
    """
    output = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(source),
        ]
    )
    data = json.loads(output)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise VideoError(f"{source.name} has no video stream")
    return VideoInfo(
        width=int(video["width"]),
        height=int(video["height"]),
        duration_seconds=float(data["format"]["duration"]),
        is_hdr=video.get("color_transfer") in HDR_TRANSFERS,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
    )


def rendition_heights(source_height: int) -> list[int]:
    """Heights to produce: 1080 and 720, never above the source.

    A source shorter than 720 gets one rendition at its own (even) height.
    """
    fitting = [h for h in RENDITION_HEIGHTS if h <= source_height]
    return fitting or [source_height - source_height % 2]


def _filter_graph(info: VideoInfo, height: int) -> str:
    scale = f"scale=-2:{height}:flags=lanczos"
    if info.is_hdr:
        return f"{scale},{TONEMAP_CHAIN},format=yuv420p,{SDR_TAGS}"
    # Convert to BT.709 limited range, whatever the source was.
    return f"{scale}:out_color_matrix=bt709:out_range=tv,format=yuv420p,{SDR_TAGS}"


def encode_rendition(source: Path, target: Path, info: VideoInfo, height: int) -> None:
    """Encode one H.264 + AAC MP4 with the index at the front of the file.

    Args:
        source: The source video.
        target: Where to write the MP4.
        info: Probe result for `source`.
        height: Output height in pixels.
    """
    crf, maxrate, bufsize = RENDITION_RATES.get(height, RENDITION_RATES[720])
    audio = list(AUDIO_ARGS) if info.has_audio else ["-an"]
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-map",
            "0:v:0",
            *(["-map", "0:a:0"] if info.has_audio else []),
            "-vf",
            _filter_graph(info, height),
            "-c:v",
            "libx264",
            "-preset",
            X264_PRESET,
            "-profile:v",
            "high",
            "-level:v",
            "4.1",
            "-crf",
            str(crf),
            "-maxrate",
            maxrate,
            "-bufsize",
            bufsize,
            "-pix_fmt",
            "yuv420p",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
            *audio,
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
            str(target),
        ]
    )


def extract_frame(video: Path, target: Path, info: VideoInfo, seconds: float) -> None:
    """Write one PNG frame from an encoded rendition, for the poster.

    Args:
        video: An encoded (already SDR) rendition.
        target: Where to write the PNG.
        info: Probe result of the *source*, for its duration.
        seconds: Where to take the frame; clamped to inside the video.
    """
    at = max(0.0, min(seconds, info.duration_seconds - 0.5))
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{at:.2f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(target),
        ]
    )
