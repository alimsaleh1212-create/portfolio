"""Seed command tests against a real Postgres test database."""

import asyncio
from pathlib import Path

import pytest

from app.config import Settings
from app.content.loader import ContentError, PlaceholdersRemainError
from app.seed import main, seed_content
from tests.db_helpers import fetch_all, snapshot


def seed(url: str, content_dir: Path, *, strict: bool = False) -> None:
    asyncio.run(seed_content(content_dir, url, strict=strict))


def edit(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))


def test_seed_loads_profile_stages_and_projects(
    empty_database_url: str, content_dir: Path
) -> None:
    seed(empty_database_url, content_dir)

    stages = fetch_all(empty_database_url, "SELECT * FROM stages ORDER BY position")
    projects = fetch_all(empty_database_url, "SELECT * FROM projects ORDER BY position")
    profile = fetch_all(empty_database_url, "SELECT * FROM profile")
    assert [row["key"] for row in stages] == ["trailhead", "ridge"]
    assert [row["slug"] for row in projects] == ["alpha", "beta"]
    assert projects[0]["metrics"] == ["95% recall"]
    assert profile[0]["data"]["name"] == "Test Person"


def test_seed_splits_the_placeholder_marker_from_the_challenge(
    empty_database_url: str, content_dir: Path
) -> None:
    seed(empty_database_url, content_dir)

    stages = fetch_all(empty_database_url, "SELECT * FROM stages ORDER BY position")
    assert stages[0]["challenge"] == "Ali will write this Challenge."
    assert stages[0]["challenge_is_placeholder"] is True
    assert stages[1]["challenge"] == "A real challenge text."
    assert stages[1]["challenge_is_placeholder"] is False


def test_seed_twice_leaves_the_same_state_as_once(
    empty_database_url: str, content_dir: Path
) -> None:
    seed(empty_database_url, content_dir)
    once = snapshot(empty_database_url)

    seed(empty_database_url, content_dir)

    assert snapshot(empty_database_url) == once


def test_seed_updates_changed_rows_in_place(
    empty_database_url: str, content_dir: Path
) -> None:
    seed(empty_database_url, content_dir)
    before = fetch_all(empty_database_url, "SELECT id FROM projects ORDER BY id")
    edit(content_dir / "projects.yaml", "name: Alpha", "name: Alpha Renamed")
    edit(content_dir / "profile.yaml", "Test Person", "Renamed Person")
    edit(content_dir / "stages.yaml", "A real challenge text.", "Another text.")

    seed(empty_database_url, content_dir)

    after = fetch_all(empty_database_url, "SELECT id, name FROM projects ORDER BY id")
    assert [row["id"] for row in after] == [row["id"] for row in before]
    assert after[0]["name"] == "Alpha Renamed"
    profile = fetch_all(empty_database_url, "SELECT data FROM profile")
    assert profile[0]["data"]["name"] == "Renamed Person"
    challenge = fetch_all(
        empty_database_url, "SELECT challenge FROM stages WHERE key = 'ridge'"
    )
    assert challenge[0]["challenge"] == "Another text."


def test_seed_removes_rows_whose_content_was_deleted(
    empty_database_url: str, content_dir: Path
) -> None:
    seed(empty_database_url, content_dir)
    (content_dir / "projects.yaml").write_text(
        "projects:\n"
        "  - slug: alpha\n    name: Alpha\n    tagline: t\n"
        "    description: d\n    stack: []\n    metrics: []\n"
    )
    (content_dir / "stages.yaml").write_text(
        "stages:\n"
        "  - key: ridge\n    name: Ridge\n    period: null\n"
        "    body: b\n    challenge: c\n"
    )

    seed(empty_database_url, content_dir)

    projects = fetch_all(empty_database_url, "SELECT slug FROM projects")
    stages = fetch_all(empty_database_url, "SELECT key, position FROM stages")
    assert [row["slug"] for row in projects] == ["alpha"]
    assert stages == [{"key": "ridge", "position": 0}]


def test_seed_follows_a_reordering(empty_database_url: str, content_dir: Path) -> None:
    seed(empty_database_url, content_dir)
    (content_dir / "projects.yaml").write_text(
        "projects:\n"
        "  - slug: beta\n    name: Beta\n    tagline: t\n"
        "    description: d\n    stack: []\n    metrics: []\n"
        "  - slug: alpha\n    name: Alpha\n    tagline: t\n"
        "    description: d\n    stack: []\n    metrics: []\n"
    )

    seed(empty_database_url, content_dir)

    rows = fetch_all(empty_database_url, "SELECT slug FROM projects ORDER BY position")
    assert [row["slug"] for row in rows] == ["beta", "alpha"]


def test_non_strict_seed_loads_placeholders_as_they_are(
    empty_database_url: str, content_dir: Path
) -> None:
    seed(empty_database_url, content_dir, strict=False)

    flags = fetch_all(
        empty_database_url, "SELECT challenge_is_placeholder FROM stages ORDER BY id"
    )
    assert [row["challenge_is_placeholder"] for row in flags] == [True, False]


def test_strict_seed_fails_naming_every_placeholder_and_loads_nothing(
    empty_database_url: str, content_dir: Path
) -> None:
    edit(
        content_dir / "projects.yaml",
        "description: I built Beta.",
        'description: "PLACEHOLDER: todo"',
    )

    with pytest.raises(PlaceholdersRemainError) as raised:
        seed(empty_database_url, content_dir, strict=True)

    message = str(raised.value)
    assert "stages.yaml: stages[trailhead].challenge" in message
    assert "projects.yaml: projects[beta].description" in message
    assert fetch_all(empty_database_url, "SELECT * FROM stages") == []


def test_strict_seed_succeeds_when_no_placeholder_remains(
    empty_database_url: str, content_dir: Path
) -> None:
    edit(
        content_dir / "stages.yaml",
        "PLACEHOLDER: Ali will write this",
        "Real text for this",
    )

    seed(empty_database_url, content_dir, strict=True)

    assert len(fetch_all(empty_database_url, "SELECT * FROM stages")) == 2


def test_invalid_content_loads_nothing(
    empty_database_url: str, content_dir: Path
) -> None:
    edit(content_dir / "profile.yaml", "headline: Test Headline\n", "")

    with pytest.raises(ContentError):
        seed(empty_database_url, content_dir)

    assert fetch_all(empty_database_url, "SELECT * FROM profile") == []


def test_cli_exits_non_zero_in_strict_mode_and_names_placeholders(
    empty_database_url: str,
    content_dir: Path,
    settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    cli_settings = settings.model_copy(
        update={"database_url": empty_database_url, "content_dir": content_dir}
    )

    code = main(["--strict"], cli_settings)

    assert code == 1
    assert "stages[trailhead].challenge" in capsys.readouterr().err


def test_cli_exits_zero_without_strict(
    empty_database_url: str, content_dir: Path, settings: Settings
) -> None:
    cli_settings = settings.model_copy(
        update={"database_url": empty_database_url, "content_dir": content_dir}
    )

    assert main([], cli_settings) == 0


def test_cli_reports_invalid_content_with_file_and_field(
    empty_database_url: str,
    content_dir: Path,
    settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    edit(content_dir / "profile.yaml", "headline: Test Headline\n", "")
    cli_settings = settings.model_copy(
        update={"database_url": empty_database_url, "content_dir": content_dir}
    )

    code = main([], cli_settings)

    err = capsys.readouterr().err
    assert code == 1
    assert "profile.yaml" in err
    assert "headline" in err
