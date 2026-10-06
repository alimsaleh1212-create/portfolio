"""Checks on the real `content/` directory that Compose mounts."""

import re
from pathlib import Path

from app.config import Settings
from app.content.loader import load_content

FIXED_STAGE_KEYS = ["trailhead", "long-approach", "steep-switch", "ridge", "high-camp"]
MIN_PHONE_DIGITS = 8
# Digits separated by spaces, dots, dashes or brackets, optionally after a plus.
# Not preceded by a letter or hyphen, so ids inside URLs do not match.
PHONE_SHAPE = re.compile(r"(?<![\w.-])\+?\(?\d[\d\s().-]{5,}\d(?![\w-])")


def looks_like_phone_number(text: str) -> bool:
    return any(
        sum(char.isdigit() for char in match.group()) >= MIN_PHONE_DIGITS
        for match in PHONE_SHAPE.finditer(text)
    )


def test_phone_detector_recognises_phone_shapes() -> None:
    assert looks_like_phone_number("call +44 20 7946 0958 now")
    assert looks_like_phone_number("(555) 010-9999")
    assert looks_like_phone_number("5550109999")
    assert looks_like_phone_number("+999 12 345 678")
    assert looks_like_phone_number("12 345 678")


def test_phone_detector_ignores_dates_and_percentages() -> None:
    assert not looks_like_phone_number("Jun 2026 – Present, 2019 – 2025, 95% recall")
    assert not looks_like_phone_number("linkedin.com/in/ali-saleh-422010386")


def test_real_content_validates(settings: Settings) -> None:
    content = load_content(settings.content_dir)

    assert content.profile.headline == (
        "AI Development Specialist | AI Automation, Agents & Integrations"
    )


def test_real_content_has_five_stages_in_climb_order(settings: Settings) -> None:
    content = load_content(settings.content_dir)

    assert [stage.key for stage in content.stages] == FIXED_STAGE_KEYS


def test_real_content_has_six_projects(settings: Settings) -> None:
    content = load_content(settings.content_dir)

    assert len(content.projects) == 6


def test_nothing_under_content_looks_like_a_phone_number(settings: Settings) -> None:
    # The Hiker's model and the stills are binary; every other file is text.
    files = [
        path
        for path in Path(settings.content_dir).rglob("*")
        if path.is_file() and path.suffix not in {".glb", ".png"}
    ]

    assert files
    offenders = [
        str(path) for path in files if looks_like_phone_number(path.read_text())
    ]
    assert offenders == []


def test_the_real_stills_are_the_fourteen_pictures(settings: Settings) -> None:
    from app.media.manifest import load_manifest
    from app.media.prepare import still_sources

    manifest = load_manifest(Path(settings.content_dir))
    assert manifest.stills is not None
    found = {
        name
        for _, name, _ in still_sources(
            Path(settings.content_dir) / manifest.stills.folder
        )
    }
    positions = [
        "opening",
        "trailhead",
        "long-approach",
        "steep-switch",
        "ridge",
        "high-camp",
        "summit",
    ]
    assert found == {f"{p}-{c}" for p in positions for c in ("wide", "narrow")}
