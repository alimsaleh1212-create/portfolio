"""Load and validate the content files; find placeholders that remain."""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

from app.content.schema import (
    PLACEHOLDER_MARKER,
    STAGE_KEYS,
    Profile,
    Project,
    ProjectsFile,
    StageContent,
    StagesFile,
)

PROFILE_FILE = "profile.yaml"
STAGES_FILE = "stages.yaml"
PROJECTS_FILE = "projects.yaml"


class ContentError(Exception):
    """A content file is missing, unreadable or does not match the schema."""


class PlaceholdersRemainError(ContentError):
    """Strict mode found placeholder text; the message names each one."""


@dataclass(frozen=True)
class Content:
    """Everything the seed loads, validated."""

    profile: Profile
    stages: list[StageContent]
    projects: list[Project]


def _read_yaml(directory: Path, name: str) -> Any:
    path = directory / name
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ContentError(f"{name}: file not found in {directory}") from None
    except yaml.YAMLError as exc:
        raise ContentError(f"{name}: not valid YAML: {exc}") from exc


def _validate[ModelT: BaseModel](
    model: type[ModelT], directory: Path, name: str
) -> ModelT:
    data = _read_yaml(directory, name)
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        lines = [
            f"{name}: {'.'.join(str(part) for part in error['loc']) or '(file)'}: "
            f"{error['msg']}"
            for error in exc.errors()
        ]
        raise ContentError("\n".join(lines)) from exc


def load_content(directory: Path) -> Content:
    """Read and validate the three content files.

    Args:
        directory: Folder holding profile.yaml, stages.yaml and projects.yaml.

    Returns:
        The validated content.

    Raises:
        ContentError: A file is missing or invalid; the message names the file
            and the field.
    """
    directory = Path(directory)
    profile = _validate(Profile, directory, PROFILE_FILE)
    stages = _validate(StagesFile, directory, STAGES_FILE).stages
    projects = _validate(ProjectsFile, directory, PROJECTS_FILE).projects

    keys = [stage.key for stage in stages]
    if len(set(keys)) != len(keys):
        raise ContentError(f"{STAGES_FILE}: stages.key: duplicate key in {keys}")
    if keys != sorted(keys, key=STAGE_KEYS.index):
        raise ContentError(
            f"{STAGES_FILE}: stages: keys {keys} are not in Climb order {STAGE_KEYS}"
        )
    slugs = [project.slug for project in projects]
    duplicates = sorted({slug for slug in slugs if slugs.count(slug) > 1})
    if duplicates:
        raise ContentError(
            f"{PROJECTS_FILE}: projects.slug: duplicate slug {', '.join(duplicates)}"
        )
    return Content(profile=profile, stages=stages, projects=projects)


def _walk_strings(value: Any, path: str) -> Iterator[tuple[str, str]]:
    """Yield (field path, text) for every string inside a dumped model."""
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for field, child in value.items():
            yield from _walk_strings(child, f"{path}.{field}" if path else field)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            label = index
            if isinstance(child, dict):
                label = child.get("key") or child.get("slug") or index
            yield from _walk_strings(child, f"{path}[{label}]")


def find_placeholders(content: Content) -> list[str]:
    """List every text field that still holds the placeholder marker.

    Args:
        content: Validated content.

    Returns:
        One "file: field" entry per placeholder, for example
        "stages.yaml: stages[trailhead].challenge".
    """
    documents = {
        PROFILE_FILE: content.profile.model_dump(),
        STAGES_FILE: {"stages": [s.model_dump() for s in content.stages]},
        PROJECTS_FILE: {"projects": [p.model_dump() for p in content.projects]},
    }
    return [
        f"{name}: {path}"
        for name, document in documents.items()
        for path, text in _walk_strings(document, "")
        if PLACEHOLDER_MARKER in text
    ]
