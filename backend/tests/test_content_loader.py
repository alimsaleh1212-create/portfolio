"""Content schema, loader and placeholder detection (no database needed)."""

from pathlib import Path

import pytest

from app.content.loader import ContentError, find_placeholders, load_content


def edit(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))


def test_fixture_content_loads(content_dir: Path) -> None:
    content = load_content(content_dir)

    assert content.profile.name == "Test Person"
    assert [stage.key for stage in content.stages] == ["trailhead", "ridge"]
    assert [project.slug for project in content.projects] == ["alpha", "beta"]


def test_missing_file_is_named(content_dir: Path) -> None:
    (content_dir / "projects.yaml").unlink()

    with pytest.raises(ContentError, match="projects.yaml"):
        load_content(content_dir)


def test_invalid_yaml_is_named(content_dir: Path) -> None:
    (content_dir / "stages.yaml").write_text("stages: [unclosed")

    with pytest.raises(ContentError, match="stages.yaml"):
        load_content(content_dir)


def test_missing_field_names_file_and_field(content_dir: Path) -> None:
    edit(content_dir / "profile.yaml", "headline: Test Headline\n", "")

    with pytest.raises(ContentError) as raised:
        load_content(content_dir)

    assert "profile.yaml" in str(raised.value)
    assert "headline" in str(raised.value)


def test_unknown_field_is_rejected(content_dir: Path) -> None:
    edit(
        content_dir / "projects.yaml",
        "    name: Alpha\n",
        "    name: Alpha\n    nme: x\n",
    )

    with pytest.raises(ContentError, match=r"projects\.yaml.*nme"):
        load_content(content_dir)


def test_unknown_stage_key_is_rejected(content_dir: Path) -> None:
    edit(content_dir / "stages.yaml", "key: ridge", "key: summit")

    with pytest.raises(ContentError, match=r"stages\.yaml.*key"):
        load_content(content_dir)


def test_stages_out_of_climb_order_are_rejected(content_dir: Path) -> None:
    edit(content_dir / "stages.yaml", "key: trailhead", "key: high-camp")

    with pytest.raises(ContentError, match=r"stages\.yaml.*order"):
        load_content(content_dir)


def test_duplicate_project_slug_is_rejected(content_dir: Path) -> None:
    edit(content_dir / "projects.yaml", "slug: beta", "slug: alpha")

    with pytest.raises(ContentError, match=r"projects\.yaml.*alpha"):
        load_content(content_dir)


def test_placeholders_are_found_in_any_text_field(content_dir: Path) -> None:
    edit(
        content_dir / "profile.yaml",
        "summary: I am a test profile. I write short sentences.",
        'summary: "PLACEHOLDER: fix. I am a test profile."',
    )
    edit(
        content_dir / "projects.yaml",
        "description: I built Beta.",
        'description: "PLACEHOLDER: todo"',
    )

    found = find_placeholders(load_content(content_dir))

    assert found == [
        "profile.yaml: summary",
        "stages.yaml: stages[trailhead].challenge",
        "projects.yaml: projects[beta].description",
    ]
